import { z } from 'zod';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CATALOG, Dataset, Dimension, Measure, getDataset } from './catalog';

/**
 * Report definitions and the compiler that turns them into SQL.
 *
 * The compiler is the security boundary. Two rules hold absolutely:
 *
 *  1. No user-supplied string ever reaches the SQL text. Dimensions, measures,
 *     operators, buckets and sort directions are all resolved against the
 *     catalog or a whitelist; filter *values* become bound parameters.
 *
 *  2. Scoping is applied by the compiler, not by the definition. A definition
 *     cannot opt out of row-level security by claiming to be GLOBAL — the
 *     caller's identity decides, and a member request always gets the
 *     ancestorPath predicate appended.
 */

export const FILTER_OPS = ['eq', 'neq', 'in', 'notIn', 'gt', 'gte', 'lt', 'lte', 'between', 'contains', 'isNull', 'notNull'] as const;
export const BUCKETS = ['day', 'week', 'month', 'quarter', 'year'] as const;
export const CHART_TYPES = ['table', 'line', 'bar', 'stackedBar', 'area', 'pie', 'funnel', 'histogram', 'heatmap', 'sankey', 'scorecard'] as const;
export const AUDIENCES = ['ADMIN', 'FINANCE', 'SUPPORT', 'MEMBER'] as const;

export const MAX_ROWS = 5_000;
const MAX_DIMENSIONS = 4;
const MAX_MEASURES = 8;

export const FilterSchema = z.object({
  dimension: z.string().min(1),
  op: z.enum(FILTER_OPS),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]).optional(),
});

export const ReportDefinitionSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9_]+$/, 'Use lowercase letters, numbers and underscores'),
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(400).optional(),
    dataset: z.string().min(1),
    dimensions: z.array(z.string()).max(MAX_DIMENSIONS),
    /** Applied to the first bucketable dimension. */
    bucket: z.enum(BUCKETS).optional(),
    measures: z.array(z.string()).min(1).max(MAX_MEASURES),
    filters: z.array(FilterSchema).max(12).default([]),
    sort: z.object({ field: z.string(), direction: z.enum(['asc', 'desc']) }).optional(),
    limit: z.number().int().min(1).max(MAX_ROWS).default(500),
    chartType: z.enum(CHART_TYPES).default('table'),
    audience: z.array(z.enum(AUDIENCES)).min(1),
    /**
     * Advisory only. A MEMBER caller is scoped to their own downline whatever
     * this says; see compile().
     */
    scope: z.enum(['GLOBAL', 'OWN_DOWNLINE', 'OWN_ROWS']).default('GLOBAL'),
    schedule: z
      .object({ cron: z.string().min(5).max(60), recipients: z.array(z.string().email()).max(20) })
      .optional(),
  })
  .superRefine((def, ctx) => {
    const fail = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });

    const ds = getDataset(def.dataset);
    if (!ds) {
      fail(['dataset'], `Unknown dataset "${def.dataset}". Available: ${Object.keys(CATALOG).join(', ')}`);
      return;
    }
    def.dimensions.forEach((d, i) => {
      if (!ds.dimensions[d]) fail(['dimensions', i], `"${d}" is not a dimension of ${ds.key}`);
    });
    def.measures.forEach((m, i) => {
      if (!ds.measures[m]) fail(['measures', i], `"${m}" is not a measure of ${ds.key}`);
    });
    def.filters.forEach((f, i) => {
      if (!ds.dimensions[f.dimension]) fail(['filters', i, 'dimension'], `"${f.dimension}" is not a dimension of ${ds.key}`);
      const needsValue = !['isNull', 'notNull'].includes(f.op);
      if (needsValue && f.value === undefined) fail(['filters', i, 'value'], `"${f.op}" needs a value`);
      if (f.op === 'between' && (!Array.isArray(f.value) || f.value.length !== 2)) {
        fail(['filters', i, 'value'], '"between" needs exactly two values');
      }
      if ((f.op === 'in' || f.op === 'notIn') && (!Array.isArray(f.value) || f.value.length === 0)) {
        fail(['filters', i, 'value'], `"${f.op}" needs a non-empty list`);
      }
    });
    if (def.sort && !ds.dimensions[def.sort.field] && !ds.measures[def.sort.field] && !def.measures.includes(def.sort.field)) {
      fail(['sort', 'field'], `"${def.sort.field}" is neither a dimension nor a selected measure`);
    }
    if (def.bucket && !def.dimensions.some((d) => ds.dimensions[d]?.bucketable)) {
      fail(['bucket'], 'A bucket needs a date dimension in the report');
    }
    // A dataset with no scoping cannot be exposed to members at all.
    if (def.audience.includes('MEMBER') && !ds.scoping) {
      fail(['audience'], `${ds.label} has no member scoping and cannot be shown to members`);
    }
  });

export type ReportDefinition = z.infer<typeof ReportDefinitionSchema>;
export type ReportFilter = z.infer<typeof FilterSchema>;

export interface MemberContext {
  memberId: string;
  ancestorPath: string;
}

export interface Caller {
  type: 'ADMIN' | 'MEMBER';
  id: string;
  role?: string;
  /** Required for MEMBER callers: used to build the downline prefix. */
  memberId?: string;
  ancestorPath?: string;
  /**
   * Support impersonation. An admin answering "why does my income look wrong"
   * needs the member's own figures, so they run the member's report *as* that
   * member. Without it an admin running a member report would get company-wide
   * data under a heading that says "my income" — not a leak, but a wrong number
   * in exactly the conversation where the number is being disputed.
   */
  onBehalfOf?: MemberContext;
}

export interface CompiledQuery {
  sql: string;
  params: unknown[];
  columns: { key: string; label: string; type: string; role: 'dimension' | 'measure' }[];
  scopeApplied: 'GLOBAL' | 'OWN_DOWNLINE' | 'OWN_ROWS';
}

/** Parameter collector. Values only ever enter SQL as $1, $2, … placeholders. */
class Params {
  readonly values: unknown[] = [];
  bind(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

export function compile(def: ReportDefinition, caller: Caller): CompiledQuery {
  const ds = getDataset(def.dataset);
  if (!ds) throw new BadRequestException(`Unknown dataset "${def.dataset}"`);

  if (caller.type === 'MEMBER' && !def.audience.includes('MEMBER')) {
    throw new ForbiddenException('This report is not available to members.');
  }
  if (caller.type === 'ADMIN') {
    const staffAudiences = def.audience.filter((a) => a !== 'MEMBER');
    const isMemberOnly = staffAudiences.length === 0;
    if (isMemberOnly && !caller.onBehalfOf) {
      throw new ForbiddenException('This is a member report. Choose which member to view it for.');
    }
    if (!isMemberOnly && caller.role && !staffAudiences.includes(caller.role as never)) {
      throw new ForbiddenException('Your role does not have access to this report.');
    }
  }

  const p = new Params();
  const selects: string[] = [];
  const groupBys: string[] = [];
  const columns: CompiledQuery['columns'] = [];

  // ---- dimensions -----------------------------------------------------
  for (const key of def.dimensions) {
    const dim = ds.dimensions[key];
    if (!dim) throw new BadRequestException(`"${key}" is not a dimension of ${ds.key}`);
    // date_trunc's first argument is a literal, so the bucket comes from the
    // BUCKETS whitelist and never from the request body.
    const expr = dim.bucketable && def.bucket ? `date_trunc('${assertBucket(def.bucket)}', ${dim.sql})` : dim.sql;
    selects.push(`${expr} AS ${quoteIdent(key)}`);
    groupBys.push(expr);
    columns.push({ key, label: dim.label, type: dim.type, role: 'dimension' });
  }

  // ---- measures -------------------------------------------------------
  for (const key of def.measures) {
    const measure = ds.measures[key];
    if (!measure) throw new BadRequestException(`"${key}" is not a measure of ${ds.key}`);
    selects.push(`${measure.sql} AS ${quoteIdent(key)}`);
    columns.push({ key, label: measure.label, type: measure.type, role: 'measure' });
  }

  // ---- where ----------------------------------------------------------
  const wheres: string[] = [];
  if (ds.baseWhere) wheres.push(`(${ds.baseWhere})`);
  for (const f of def.filters) {
    const dim = ds.dimensions[f.dimension];
    if (!dim) throw new BadRequestException(`"${f.dimension}" is not a dimension of ${ds.key}`);
    wheres.push(renderFilter(dim, f, p));
  }

  // ---- scoping, decided by the caller and not by the definition --------
  const scopeApplied = applyScope(ds, def, caller, wheres, p);

  const sql = [
    `SELECT ${selects.join(', ')}`,
    `FROM ${ds.from}`,
    wheres.length ? `WHERE ${wheres.join(' AND ')}` : '',
    groupBys.length ? `GROUP BY ${groupBys.join(', ')}` : '',
    renderOrderBy(def, ds),
    `LIMIT ${Math.min(def.limit ?? 500, MAX_ROWS)}`,
  ]
    .filter(Boolean)
    .join('\n');

  return { sql, params: p.values, columns, scopeApplied };
}

function applyScope(
  ds: Dataset,
  def: ReportDefinition,
  caller: Caller,
  wheres: string[],
  p: Params,
): CompiledQuery['scopeApplied'] {
  // An admin without an impersonation context runs company-wide.
  if (caller.type === 'ADMIN' && !caller.onBehalfOf) {
    return def.scope === 'GLOBAL' ? 'GLOBAL' : def.scope;
  }

  // Everything below is scoped to one member: either the member themselves, or
  // an admin explicitly viewing on that member's behalf.
  const subject: { memberId?: string; ancestorPath?: string } =
    caller.type === 'ADMIN' ? caller.onBehalfOf! : { memberId: caller.memberId, ancestorPath: caller.ancestorPath };

  // Never trust def.scope here: a definition claiming GLOBAL must not hand one
  // member the whole company's data.
  if (!ds.scoping) throw new ForbiddenException('This data is not available to members.');
  if (!subject.memberId || subject.ancestorPath === undefined) {
    throw new ForbiddenException('Member context is missing; refusing to run an unscoped query.');
  }

  if (def.scope === 'OWN_ROWS') {
    wheres.push(`(${ds.scoping.ownRows.replace('$memberId', p.bind(subject.memberId))})`);
    return 'OWN_ROWS';
  }
  // Default and OWN_DOWNLINE both collapse to the downline predicate, so a
  // mislabelled definition fails closed rather than open.
  const prefix = `${subject.ancestorPath}${subject.memberId}/%`;
  const predicate = ds.scoping.downline
    .replace('$memberId', p.bind(subject.memberId))
    .replace('$pathPrefix', p.bind(prefix));
  wheres.push(`(${predicate})`);
  return 'OWN_DOWNLINE';
}

function renderFilter(dim: Dimension, f: ReportFilter, p: Params): string {
  const col = dim.sql;
  switch (f.op) {
    case 'eq':
      return `${col} = ${p.bind(coerce(dim, f.value))}`;
    case 'neq':
      return `${col} <> ${p.bind(coerce(dim, f.value))}`;
    case 'gt':
      return `${col} > ${p.bind(coerce(dim, f.value))}`;
    case 'gte':
      return `${col} >= ${p.bind(coerce(dim, f.value))}`;
    case 'lt':
      return `${col} < ${p.bind(coerce(dim, f.value))}`;
    case 'lte':
      return `${col} <= ${p.bind(coerce(dim, f.value))}`;
    case 'between': {
      const [a, b] = f.value as (string | number)[];
      return `${col} BETWEEN ${p.bind(coerce(dim, a))} AND ${p.bind(coerce(dim, b))}`;
    }
    case 'in': {
      const list = (f.value as (string | number)[]).map((v) => p.bind(coerce(dim, v)));
      return `${col} IN (${list.join(', ')})`;
    }
    case 'notIn': {
      const list = (f.value as (string | number)[]).map((v) => p.bind(coerce(dim, v)));
      return `${col} NOT IN (${list.join(', ')})`;
    }
    case 'contains':
      // The wildcards are added here, around a bound parameter. The value
      // itself is never concatenated into the SQL text.
      return `${col}::text ILIKE ${p.bind(`%${String(f.value)}%`)}`;
    case 'isNull':
      return `${col} IS NULL`;
    case 'notNull':
      return `${col} IS NOT NULL`;
    default: {
      // Unreachable via the schema, but a compiler that silently ignores an
      // unknown operator would drop a filter and widen the result set.
      const never: never = f.op;
      throw new BadRequestException(`Unsupported filter operator "${never}"`);
    }
  }
}

/** Enum dimensions carry booleans as strings; Postgres needs the real type. */
function coerce(dim: Dimension, value: unknown): unknown {
  if (dim.enumValues && (value === 'true' || value === 'false')) return value === 'true';
  if (dim.type === 'date' && typeof value === 'string') {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) throw new BadRequestException(`"${value}" is not a valid date`);
    return d;
  }
  return value;
}

function renderOrderBy(def: ReportDefinition, ds: Dataset): string {
  if (def.sort) {
    const known = ds.dimensions[def.sort.field] ?? ds.measures[def.sort.field];
    if (!known) throw new BadRequestException(`Cannot sort by "${def.sort.field}"`);
    // asc/desc comes from a zod enum, so it is safe to inline.
    return `ORDER BY ${quoteIdent(def.sort.field)} ${def.sort.direction === 'asc' ? 'ASC' : 'DESC'}`;
  }
  if (def.dimensions.length) return `ORDER BY ${quoteIdent(def.dimensions[0])} ASC`;
  return '';
}

function assertBucket(bucket: string): string {
  if (!(BUCKETS as readonly string[]).includes(bucket)) throw new BadRequestException(`Unsupported bucket "${bucket}"`);
  return bucket;
}

/**
 * Identifiers here always come from catalog keys, which the schema restricts to
 * [a-z0-9_]. Escaping doubled quotes anyway costs nothing and means a future
 * catalog entry with an odd key cannot break out.
 */
function quoteIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new BadRequestException(`Unsafe identifier "${name}"`);
  return `"${name.replace(/"/g, '""')}"`;
}

export function parseDefinition(raw: unknown): ReportDefinition {
  return ReportDefinitionSchema.parse(raw);
}
