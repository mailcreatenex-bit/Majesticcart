import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { Paise, BvCenti, formatInr, paiseToRupeeString, centiToBvString } from './money';

/**
 * BigInt does not survive JSON.
 *
 *   JSON.stringify({ total: 59950n })
 *   -> TypeError: Do not know how to serialize a BigInt
 *
 * Every money field in this codebase is a bigint, so without this interceptor
 * the first endpoint that returns an order 500s. The obvious fix — a global
 * `BigInt.prototype.toJSON = function () { return Number(this) }` — is worse
 * than the bug: Number.MAX_SAFE_INTEGER is about ₹90 crore in paise, and the
 * failure past it is silent rounding rather than an exception.
 *
 * So bigints are rendered as decimal strings. Clients parse them with a decimal
 * library or keep them as strings for display. They are never JS numbers.
 */
@Injectable()
export class BigIntSerializerInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((body) => serializeBigInts(body)));
  }
}

/**
 * Walks the response and converts bigints to strings. Dates, Buffers and null
 * are passed through untouched; a naive recursive clone would mangle all three.
 */
export function serializeBigInts<T>(value: T, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') return value;

  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString('base64');

  // Prisma can return self-referencing graphs through relation includes.
  if (seen.has(value as object)) return undefined;
  seen.add(value as object);

  if (Array.isArray(value)) return value.map((v) => serializeBigInts(v, seen));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = serializeBigInts(v, seen);
  }
  return out;
}

/* ------------------------------------------------------------ money views */

export interface MoneyView {
  /** Exact value for arithmetic. Parse as a decimal, never as a float. */
  paise: string;
  /** Rupees with two decimals: "599.50". */
  amount: string;
  /** Ready to print: "₹599.50". */
  display: string;
}

export const money = (paise: Paise): MoneyView => ({
  paise: paise.toString(),
  amount: paiseToRupeeString(paise),
  display: formatInr(paise),
});

export interface VolumeView {
  centi: number;
  bv: string;
  display: string;
}

export const volume = (bvCenti: BvCenti): VolumeView => ({
  centi: bvCenti,
  bv: centiToBvString(bvCenti),
  display: `${centiToBvString(bvCenti)} BV`,
});

/**
 * Percentages travel as basis points plus a rendered label, so a client never
 * has to guess whether 5 means 5% or 0.05%.
 */
export const percent = (bp: number) => ({ bp, display: `${bp / 100}%` });

/**
 * Money arriving from a client.
 *
 * Accepts a decimal string, never a float. A rupee amount that has been through
 * a JS number is already potentially wrong by the time it reaches us, and there
 * is no way to tell from the value itself.
 */
export function parseMoneyInput(raw: unknown, field = 'amount'): Paise {
  if (typeof raw === 'number') {
    throw new TypeError(`${field} must be sent as a string, not a number, so the value cannot lose precision in transit`);
  }
  const s = String(raw ?? '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    throw new TypeError(`${field} must be a rupee amount with at most two decimals`);
  }
  const [whole, frac = ''] = s.split('.');
  return BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0'));
}
