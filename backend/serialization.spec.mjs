var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __decorateClass = (decorators, target, key, kind) => {
  var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc(target, key) : target;
  for (var i = decorators.length - 1, decorator; i >= 0; i--)
    if (decorator = decorators[i])
      result = (kind ? decorator(target, key, result) : decorator(result)) || result;
  if (kind && result) __defProp(target, key, result);
  return result;
};

// src/__tests__/serialization.spec.ts
import assert from "node:assert/strict";
import { test } from "node:test";

// src/common/serialization.ts
import { Injectable } from "@nestjs/common";
import { map } from "rxjs";

// src/common/money.ts
var PAISE_PER_RUPEE = 100n;
var CENTI_PER_BV = 100;
function rupeesToPaise(rupees) {
  const s = String(rupees).trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) {
    throw new Error(`"${rupees}" is not a rupee amount with at most 2 decimals`);
  }
  const negative = s.startsWith("-");
  const [whole, frac = ""] = (negative ? s.slice(1) : s).split(".");
  const paise = BigInt(whole) * PAISE_PER_RUPEE + BigInt(frac.padEnd(2, "0"));
  return negative ? -paise : paise;
}
function paiseToRupeeString(paise) {
  const negative = paise < 0n;
  const abs = negative ? -paise : paise;
  const whole = abs / PAISE_PER_RUPEE;
  const frac = abs % PAISE_PER_RUPEE;
  return `${negative ? "-" : ""}${whole}.${frac.toString().padStart(2, "0")}`;
}
function formatInr(paise) {
  const negative = paise < 0n;
  const abs = negative ? -paise : paise;
  const whole = (abs / PAISE_PER_RUPEE).toString();
  const frac = (abs % PAISE_PER_RUPEE).toString().padStart(2, "0");
  const [last3, ...rest] = [whole.slice(-3), whole.slice(0, -3)].filter(Boolean);
  const head = rest.length ? rest[0].replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," : "";
  return `\u20B9${head}${last3}${frac === "00" ? "" : "." + frac}`;
}
function bvToCenti(bv) {
  const s = String(bv).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error(`"${bv}" is not a valid BV`);
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * CENTI_PER_BV + Number(frac.padEnd(2, "0"));
}
function centiToBvString(centi) {
  const whole = Math.trunc(centi / CENTI_PER_BV);
  const frac = Math.abs(centi % CENTI_PER_BV);
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, "0")}`;
}

// src/common/serialization.ts
var BigIntSerializerInterceptor = class {
  intercept(_ctx, next) {
    return next.handle().pipe(map((body) => serializeBigInts(body)));
  }
};
BigIntSerializerInterceptor = __decorateClass([
  Injectable()
], BigIntSerializerInterceptor);
function serializeBigInts(value, seen = /* @__PURE__ */ new WeakSet()) {
  if (typeof value === "bigint") return value.toString();
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString("base64");
  if (seen.has(value)) return void 0;
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => serializeBigInts(v, seen));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = serializeBigInts(v, seen);
  }
  return out;
}
var money = (paise) => ({
  paise: paise.toString(),
  amount: paiseToRupeeString(paise),
  display: formatInr(paise)
});
var volume = (bvCenti) => ({
  centi: bvCenti,
  bv: centiToBvString(bvCenti),
  display: `${centiToBvString(bvCenti)} BV`
});
var percent = (bp) => ({ bp, display: `${bp / 100}%` });
function parseMoneyInput(raw, field = "amount") {
  if (typeof raw === "number") {
    throw new TypeError(`${field} must be sent as a string, not a number, so the value cannot lose precision in transit`);
  }
  const s = String(raw ?? "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    throw new TypeError(`${field} must be a rupee amount with at most two decimals`);
  }
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole) * 100n + BigInt(frac.padEnd(2, "0"));
}

// src/__tests__/serialization.spec.ts
test("a bigint in a response becomes a decimal string, not a number", () => {
  const out = serializeBigInts({ totalPaise: 59950n });
  assert.equal(out.totalPaise, "59950");
  assert.equal(typeof out.totalPaise, "string");
});
test("the naive fix would have failed silently past 90 crore", () => {
  const huge = 9007199254740993n;
  assert.notEqual(Number(huge).toString(), huge.toString());
  assert.equal(serializeBigInts(huge), huge.toString());
});
test("JSON.stringify works on a serialized payload, and throws without it", () => {
  const payload = { order: { totalPaise: 59950n, items: [{ bv: 3e4, pricePaise: 19990n }] } };
  assert.throws(() => JSON.stringify(payload), /BigInt/);
  assert.doesNotThrow(() => JSON.stringify(serializeBigInts(payload)));
});
test("dates, buffers, null and undefined survive intact", () => {
  const when = /* @__PURE__ */ new Date("2026-09-12T10:00:00.000Z");
  const out = serializeBigInts({ when, blob: Buffer.from("hi"), nothing: null, missing: void 0 });
  assert.equal(out.when, "2026-09-12T10:00:00.000Z");
  assert.equal(out.blob, Buffer.from("hi").toString("base64"));
  assert.equal(out.nothing, null);
  assert.equal(out.missing, void 0);
});
test("nested arrays and objects are walked all the way down", () => {
  const out = serializeBigInts({ a: [{ b: [{ c: 1n }] }] });
  assert.equal(out.a[0].b[0].c, "1");
});
test("a self-referencing graph does not blow the stack", () => {
  const node = { amountPaise: 100n };
  node.self = node;
  assert.doesNotThrow(() => serializeBigInts(node));
});
test("money views carry an exact value and a display string", () => {
  const view = money(rupeesToPaise("599.50"));
  assert.deepEqual(view, { paise: "59950", amount: "599.50", display: "\u20B9599.50" });
});
test("volume and percent views never make the client guess the scale", () => {
  assert.deepEqual(volume(bvToCenti(300)), { centi: 3e4, bv: "300", display: "300 BV" });
  assert.deepEqual(percent(1900), { bp: 1900, display: "19%" });
});
test("money arriving as a float is rejected outright", () => {
  assert.throws(() => parseMoneyInput(599.5), /must be sent as a string/);
  assert.throws(() => parseMoneyInput(1e3), /must be sent as a string/);
});
test("money arriving as a decimal string parses exactly", () => {
  assert.equal(parseMoneyInput("599.50"), 59950n);
  assert.equal(parseMoneyInput("0.01"), 1n);
  assert.equal(parseMoneyInput("2000"), 200000n);
  assert.throws(() => parseMoneyInput("10.999"), /at most two decimals/);
  assert.throws(() => parseMoneyInput("-5"), /at most two decimals/);
  assert.throws(() => parseMoneyInput("abc"), /at most two decimals/);
});
