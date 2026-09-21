import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { compile, parseDefinition, ReportDefinition, Caller, CompiledQuery, MAX_ROWS } from './compiler';
import { describeCatalog } from './catalog';
import { ALL_PRESETS, PRESET_GROUPS, validatePresets } from './presets';
import { money, volume, percent, MoneyView, VolumeView } from '../common/serialization';

/**
 * Report execution.
 *
 * The service never builds SQL itself — it delegates to the compiler, runs the
 * parameterised result, and formats the rows. Keeping those three concerns
 * apart is what lets the compiler be tested in isolation, which matters because
 * the compiler is the security boundary.
 */

export type CellValue = string | number | boolean | null | MoneyView | VolumeView | { bp: number; display: string };

export interface ReportResult {
  key: string;
  name: string;
  description?: string;
  chartType: string;
  columns: CompiledQuery['columns'];
  rows: Record<string, CellValue>[];
  rowCount: number;
  truncated: boolean;
  scopeApplied: string;
  generatedAt: string;
  elapsedMs: number;
}

@Injectable()
export class ReportService {
  private readonly log = new Logger(ReportService.name);

  constructor(private readonly prisma: PrismaClient) {
    // Fails the boot if any shipped preset references a catalog key that does
    // not exist, rather than failing for whoever opens that report first.
    validatePresets();
  }

  /** What the report builder UI renders as its field picker. */
  catalog() {
    return { datasets: describeCatalog(), presetGroups: PRESET_GROUPS.map((g) => ({ key: g.key, label: g.label, reports: g.reports.map((r) => ({ key: r.key, name: r.name, description: r.description, chartType: r.chartType, audience: r.audience })) })) };
  }

  /**
   * Saved definitions live in the database so the client's edits survive a
   * deploy; presets are the fallback. A saved definition with the same key
   * shadows the preset, which is how "edit a built-in report" works without
   * mutating shipped code.
   */
  async resolve(key: string): Promise<ReportDefinition> {
    const saved = await this.prisma.reportDefinition.findUnique({ where: { key } });
    if (saved) return parseDefinition(saved.definition);
    const preset = ALL_PRESETS.find((p) => p.key === key);
    if (!preset) throw new NotFoundException(`No report called "${key}"`);
    return preset;
  }

  async save(definition: unknown, actorId: string): Promise<ReportDefinition> {
    const parsed = parseDefinition(definition);
    // Compile once against a synthetic admin caller before persisting. A
    // definition that cannot compile should never reach the database.
    compile(parsed, { type: 'ADMIN', id: actorId, role: 'ADMIN' });

    await this.prisma.reportDefinition.upsert({
      where: { key: parsed.key },
      create: { key: parsed.key, name: parsed.name, definition: parsed as object, createdById: actorId },
      update: { name: parsed.name, definition: parsed as object, updatedById: actorId },
    });
    await this.prisma.auditLog.create({
      data: { actorType: 'ADMIN', actorId, action: 'report.save', detail: { key: parsed.key, dataset: parsed.dataset } },
    });
    return parsed;
  }

  async delete(key: string, actorId: string): Promise<void> {
    await this.prisma.reportDefinition.deleteMany({ where: { key } });
    await this.prisma.auditLog.create({
      data: { actorType: 'ADMIN', actorId, action: 'report.delete', detail: { key } },
    });
  }

  /**
   * Run a saved or preset report.
   *
   * `overrides` lets the UI apply a date range or an extra filter without
   * saving a new definition — but only fields the schema already validates, so
   * an override cannot smuggle in a dataset or a dimension of its own.
   */
  async run(key: string, caller: Caller, overrides: Partial<Pick<ReportDefinition, 'filters' | 'bucket' | 'limit' | 'sort'>> = {}): Promise<ReportResult> {
    const base = await this.resolve(key);
    const definition = parseDefinition({
      ...base,
      ...(overrides.bucket ? { bucket: overrides.bucket } : {}),
      ...(overrides.sort ? { sort: overrides.sort } : {}),
      ...(overrides.limit ? { limit: Math.min(overrides.limit, MAX_ROWS) } : {}),
      filters: [...base.filters, ...(overrides.filters ?? [])],
    });
    return this.execute(definition, caller);
  }

  /** Run an unsaved definition — the builder's preview button. */
  async preview(definition: unknown, caller: Caller): Promise<ReportResult> {
    const parsed = parseDefinition(definition);
    return this.execute({ ...parsed, limit: Math.min(parsed.limit, 200) }, caller);
  }

  private async execute(definition: ReportDefinition, caller: Caller): Promise<ReportResult> {
    const compiled = compile(definition, caller);
    const started = Date.now();

    let raw: Record<string, unknown>[];
    try {
      raw = await this.prisma.$queryRawUnsafe<Record<string, unknown>[]>(compiled.sql, ...compiled.params);
    } catch (e) {
      // The SQL text is safe to log — it contains no member data, only
      // placeholders. The parameters are not logged for exactly that reason.
      this.log.error(`Report "${definition.key}" failed:\n${compiled.sql}`, e instanceof Error ? e.stack : undefined);
      throw new BadRequestException('That report could not be run. Check the filters and try again.');
    }

    const elapsedMs = Date.now() - started;
    if (elapsedMs > 3_000) {
      this.log.warn(`Report "${definition.key}" took ${elapsedMs}ms — consider narrowing the range or adding an index`);
    }

    const rows = raw.map((row) => this.formatRow(row, compiled.columns));
    return {
      key: definition.key,
      name: definition.name,
      description: definition.description,
      chartType: definition.chartType,
      columns: compiled.columns,
      rows,
      rowCount: rows.length,
      truncated: rows.length >= definition.limit,
      scopeApplied: compiled.scopeApplied,
      generatedAt: new Date().toISOString(),
      elapsedMs,
    };
  }

  /**
   * Typed formatting.
   *
   * Money becomes a MoneyView rather than a bare number, so a client never has
   * to guess whether a field is rupees or paise. Bigints never become JS
   * numbers: SUM over a money column can comfortably exceed MAX_SAFE_INTEGER
   * once the platform has real volume.
   */
  private formatRow(row: Record<string, unknown>, columns: CompiledQuery['columns']): Record<string, CellValue> {
    const out: Record<string, CellValue> = {};
    for (const col of columns) {
      const value = row[col.key];
      if (value === null || value === undefined) {
        out[col.key] = null;
        continue;
      }
      switch (col.type) {
        case 'money':
          out[col.key] = money(this.toBigInt(value));
          break;
        case 'volume':
          out[col.key] = volume(Number(value));
          break;
        case 'percent':
          out[col.key] = percent(Number(value));
          break;
        case 'duration':
          out[col.key] = Math.round(Number(value) * 100) / 100;
          break;
        case 'date':
          out[col.key] = value instanceof Date ? value.toISOString() : String(value);
          break;
        case 'number':
          out[col.key] = typeof value === 'bigint' ? Number(value) : Number(value);
          break;
        default:
          out[col.key] = typeof value === 'boolean' ? value : String(value);
      }
    }
    return out;
  }

  /** Postgres returns SUM over bigint as NUMERIC, which arrives as a string. */
  private toBigInt(value: unknown): bigint {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number') return BigInt(Math.round(value));
    const s = String(value);
    return BigInt(s.includes('.') ? s.split('.')[0] : s);
  }

  /**
   * CSV export.
   *
   * Fields are quoted and a leading =, +, - or @ is prefixed with a quote. That
   * last part is not cosmetic: without it a member name like "=cmd|..." becomes
   * an executable formula when the finance team opens the file in Excel.
   */
  toCsv(result: ReportResult): string {
    const header = result.columns.map((c) => this.csvCell(c.label)).join(',');
    const lines = result.rows.map((row) =>
      result.columns
        .map((col) => {
          const v = row[col.key];
          if (v === null) return '';
          if (typeof v === 'object' && 'paise' in v) return this.csvCell((v as MoneyView).amount);
          if (typeof v === 'object' && 'centi' in v) return this.csvCell((v as VolumeView).bv);
          if (typeof v === 'object' && 'bp' in v) return this.csvCell(String((v as { bp: number }).bp / 100));
          return this.csvCell(String(v));
        })
        .join(','),
    );
    return [header, ...lines].join('\n');
  }

  private csvCell(value: string): string {
    const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return `"${safe.replace(/"/g, '""')}"`;
  }
}
