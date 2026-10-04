import { parse as parseCsv } from 'csv-parse/sync';

/**
 * Matching a bank statement against pending recharge requests.
 *
 * The admin uploads the statement their bank lets them download (a CSV). For each
 * pending request, this looks for the member's UTR in the statement and checks the
 * bank really received that exact amount. Only a clean match is offered for automatic
 * approval; anything else (amount differs, UTR not found, shown twice, a debit, or a
 * request carrying a fraud flag) is left for a person, with the reason.
 *
 * Pure: it reads text and returns a verdict. It approves nothing.
 */

export type Verdict =
  | 'MATCHED'
  | 'AMOUNT_DIFFERS'
  | 'NOT_A_CREDIT'
  | 'NOT_FOUND'
  | 'SEEN_TWICE'
  | 'FLAGGED';

export interface PendingRecharge {
  id: string;
  utr: string;
  claimedPaise: bigint;
  flags: string[];
}

export interface MatchResult {
  id: string;
  utr: string;
  verdict: Verdict;
  claimedPaise: bigint;
  /** What the bank shows for that row, when it was found and readable. */
  bankPaise: bigint | null;
}

export interface StatementReport {
  rowsRead: number;
  /** False when no header naming a credit / deposit column could be found, so nothing can be trusted. */
  understood: boolean;
  results: MatchResult[];
}

interface Columns { credit: number; amount: number; drcr: number }

const HEADER_HINT = /narration|description|particulars|remarks|details|transaction/i;

function findHeader(rows: string[][]): { index: number; cols: Columns } | null {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const cells = rows[i].map((c) => c.trim());
    if (!cells.some((c) => HEADER_HINT.test(c))) continue;
    const credit = cells.findIndex((c) => /deposit|credit|\bcr\b/i.test(c) && !/debit|withdraw|\bdr\b/i.test(c));
    const amount = cells.findIndex((c) => /^amount|amount\s*\(/i.test(c) && !/balance/i.test(c));
    const drcr = cells.findIndex((c) => /^(dr\s*\/\s*cr|cr\s*\/\s*dr|type|dr or cr)$/i.test(c));
    if (credit >= 0 || amount >= 0) return { index: i, cols: { credit, amount, drcr } };
  }
  return null;
}

/** "12,345.50", "₹ 500", "500.00(Cr)" -> paise; null if there is no number. */
export function toPaise(raw: string | undefined): bigint | null {
  if (!raw) return null;
  const m = /-?\d[\d,]*(?:\.\d{1,2})?/.exec(raw.replace(/[₹\s]/g, ''));
  if (!m) return null;
  const clean = m[0].replace(/,/g, '');
  const negative = clean.startsWith('-');
  const [whole, frac = ''] = clean.replace('-', '').split('.');
  const paise = BigInt(whole) * 100n + BigInt((frac + '00').slice(0, 2));
  return negative ? -paise : paise;
}

/** The credited amount of a row, or null when the row is not a credit (or cannot be read as one). */
function creditOf(cells: string[], cols: Columns): bigint | null {
  if (cols.credit >= 0) {
    const p = toPaise(cells[cols.credit]);
    return p !== null && p > 0n ? p : null;
  }
  if (cols.amount >= 0) {
    const cell = cells[cols.amount] ?? '';
    const p = toPaise(cell);
    if (p === null || p <= 0n) return null;
    if (cols.drcr >= 0) return /^\s*cr/i.test(cells[cols.drcr] ?? '') ? p : null;
    if (/\bcr\b/i.test(cell)) return p;
    return null; // a lone amount column with no sign: cannot tell a credit from a debit, so do not guess
  }
  return null;
}

/** Does the row's text contain this UTR as a whole token (not as part of a longer number)? */
export function rowHasUtr(rowText: string, utr: string): boolean {
  const u = utr.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (u.length < 12) return false;
  const re = new RegExp(`(?<![A-Z0-9])${u}(?![A-Z0-9])`);
  return re.test(rowText.toUpperCase());
}

export function matchStatement(csvText: string, pending: PendingRecharge[]): StatementReport {
  let rows: string[][];
  try {
    rows = parseCsv(csvText.replace(/^﻿/, ''), { relax_column_count: true, skip_empty_lines: true, relax_quotes: true, bom: true }) as string[][];
  } catch {
    return { rowsRead: 0, understood: false, results: pending.map((p) => notFound(p)) };
  }

  const header = findHeader(rows);
  if (!header) return { rowsRead: rows.length, understood: false, results: pending.map((p) => notFound(p)) };

  const data = rows.slice(header.index + 1).map((cells) => ({ cells, text: cells.join(' | ') }));

  const results: MatchResult[] = pending.map((p) => {
    if (p.flags.length > 0) return { id: p.id, utr: p.utr, verdict: 'FLAGGED', claimedPaise: p.claimedPaise, bankPaise: null };

    const hits = data.filter((r) => rowHasUtr(r.text, p.utr));
    if (hits.length === 0) return notFound(p);
    if (hits.length > 1) return { id: p.id, utr: p.utr, verdict: 'SEEN_TWICE', claimedPaise: p.claimedPaise, bankPaise: null };

    const bank = creditOf(hits[0].cells, header.cols);
    if (bank === null) return { id: p.id, utr: p.utr, verdict: 'NOT_A_CREDIT', claimedPaise: p.claimedPaise, bankPaise: null };
    // Exactly the amount claimed, to the paisa. A bank that received less is a person's call.
    if (bank !== p.claimedPaise) return { id: p.id, utr: p.utr, verdict: 'AMOUNT_DIFFERS', claimedPaise: p.claimedPaise, bankPaise: bank };
    return { id: p.id, utr: p.utr, verdict: 'MATCHED', claimedPaise: p.claimedPaise, bankPaise: bank };
  });

  return { rowsRead: data.length, understood: true, results };
}

function notFound(p: PendingRecharge): MatchResult {
  return { id: p.id, utr: p.utr, verdict: 'NOT_FOUND', claimedPaise: p.claimedPaise, bankPaise: null };
}
