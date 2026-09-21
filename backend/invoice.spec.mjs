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

// src/__tests__/invoice.spec.ts
import assert from "node:assert/strict";
import { test } from "node:test";

// src/invoice/invoice.service.ts
import { Injectable, NotFoundException } from "@nestjs/common";

// src/common/money.ts
var BP_DENOMINATOR = 1e4;
var PAISE_PER_RUPEE = 100n;
var CENTI_PER_BV = 100;
function rupeesToPaise(rupees2) {
  const s = String(rupees2).trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) {
    throw new Error(`"${rupees2}" is not a rupee amount with at most 2 decimals`);
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
function gstInclusiveComponent(inclusivePaise, gstBp) {
  const denom = BigInt(BP_DENOMINATOR + gstBp);
  return inclusivePaise * BigInt(gstBp) / denom;
}

// src/invoice/invoice.service.ts
var STATE_CODES = {
  "jammu and kashmir": "01",
  "himachal pradesh": "02",
  "punjab": "03",
  "chandigarh": "04",
  "uttarakhand": "05",
  "haryana": "06",
  "delhi": "07",
  "rajasthan": "08",
  "uttar pradesh": "09",
  "bihar": "10",
  "sikkim": "11",
  "arunachal pradesh": "12",
  "nagaland": "13",
  "manipur": "14",
  "mizoram": "15",
  "tripura": "16",
  "meghalaya": "17",
  "assam": "18",
  "west bengal": "19",
  "jharkhand": "20",
  "odisha": "21",
  "chhattisgarh": "22",
  "madhya pradesh": "23",
  "gujarat": "24",
  "maharashtra": "27",
  "karnataka": "29",
  "goa": "30",
  "lakshadweep": "31",
  "kerala": "32",
  "tamil nadu": "33",
  "puducherry": "34",
  "andaman and nicobar islands": "35",
  "telangana": "36",
  "andhra pradesh": "37",
  "ladakh": "38"
};
var ALIASES = {
  wb: "west bengal",
  up: "uttar pradesh",
  mp: "madhya pradesh",
  tn: "tamil nadu",
  ap: "andhra pradesh",
  hp: "himachal pradesh",
  jk: "jammu and kashmir",
  mh: "maharashtra",
  ka: "karnataka",
  kl: "kerala",
  gj: "gujarat",
  rj: "rajasthan",
  pb: "punjab",
  hr: "haryana",
  br: "bihar",
  od: "odisha",
  or: "odisha",
  tg: "telangana",
  ts: "telangana",
  "orissa": "odisha",
  "pondicherry": "puducherry",
  "nct of delhi": "delhi",
  "new delhi": "delhi"
};
function stateCode(state) {
  const clean = (state ?? "").trim().toLowerCase().replace(/[^a-z\s&]/g, "").replace(/\s+/g, " ");
  const resolved = ALIASES[clean] ?? clean;
  return STATE_CODES[resolved] ?? null;
}
var isIntraState = (sellerState, buyerState) => {
  const a = stateCode(sellerState);
  const b = stateCode(buyerState);
  return a !== null && b !== null && a === b;
};
var InvoiceService = class {
  constructor(prisma) {
    this.prisma = prisma;
  }
  prisma;
  async build(orderId) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, member: { select: { memberCode: true, name: true, phone: true } } }
    });
    if (!order) throw new NotFoundException("Order not found.");
    if (!order.invoiceNo) throw new NotFoundException("No invoice has been raised for this order yet. Invoices are issued on delivery.");
    const settings = await this.prisma.storeSetting.findUnique({ where: { key: "store" } });
    const store = settings?.value ?? {};
    const sellerState = store.state ?? "West Bengal";
    const intraState = isIntraState(sellerState, order.shipState);
    const lines = order.items.map((item, i) => {
      const qty = BigInt(item.quantity);
      const lineInclusive = item.pricePaise * qty;
      const gstPaise = gstInclusiveComponent(lineInclusive, item.gstBp);
      const taxable = lineInclusive - gstPaise;
      const cgst = intraState ? gstPaise / 2n : 0n;
      const sgst = intraState ? gstPaise - cgst : 0n;
      const igst = intraState ? 0n : gstPaise;
      return {
        serial: i + 1,
        description: item.nameSnapshot,
        hsn: item.hsnSnapshot || "3304",
        quantity: item.quantity,
        unitPricePaise: item.pricePaise * 10000n / BigInt(1e4 + item.gstBp),
        taxableValuePaise: taxable,
        gstRateBp: item.gstBp,
        cgstPaise: cgst,
        sgstPaise: sgst,
        igstPaise: igst,
        totalPaise: lineInclusive
      };
    });
    const byRate = /* @__PURE__ */ new Map();
    for (const l of lines) {
      const s = byRate.get(l.gstRateBp) ?? { gstRateBp: l.gstRateBp, taxableValuePaise: 0n, cgstPaise: 0n, sgstPaise: 0n, igstPaise: 0n };
      s.taxableValuePaise += l.taxableValuePaise;
      s.cgstPaise += l.cgstPaise;
      s.sgstPaise += l.sgstPaise;
      s.igstPaise += l.igstPaise;
      byRate.set(l.gstRateBp, s);
    }
    const taxableTotal = lines.reduce((a, l) => a + l.taxableValuePaise, 0n);
    const cgstTotal = lines.reduce((a, l) => a + l.cgstPaise, 0n);
    const sgstTotal = lines.reduce((a, l) => a + l.sgstPaise, 0n);
    const igstTotal = lines.reduce((a, l) => a + l.igstPaise, 0n);
    const grandTotal = taxableTotal + cgstTotal + sgstTotal + igstTotal;
    const remainder = grandTotal % 100n;
    const roundOff2 = remainder === 0n ? 0n : remainder < 50n ? -remainder : 100n - remainder;
    const payable = grandTotal + roundOff2;
    return {
      invoiceNo: order.invoiceNo,
      invoiceDate: order.invoicedAt ?? order.deliveredAt ?? order.createdAt,
      orderNo: order.orderNo,
      placeOfSupply: { state: order.shipState, code: stateCode(order.shipState) },
      intraState,
      seller: {
        legalName: store.legalName ?? store.name ?? "Majestic Cart",
        address: store.registeredAddress ?? "",
        gstin: store.gstin ?? "",
        stateCode: stateCode(sellerState)
      },
      buyer: {
        name: order.shipName,
        memberCode: order.member.memberCode,
        address: order.shipLine,
        state: order.shipState,
        pincode: order.shipPincode,
        phone: order.shipPhone
      },
      lines,
      rateSummary: [...byRate.values()].sort((a, b) => a.gstRateBp - b.gstRateBp),
      taxableTotalPaise: taxableTotal,
      cgstTotalPaise: cgstTotal,
      sgstTotalPaise: sgstTotal,
      igstTotalPaise: igstTotal,
      grandTotalPaise: grandTotal,
      roundOffPaise: roundOff2,
      payablePaise: payable,
      amountInWords: amountInWords(payable)
    };
  }
  /**
   * Render as HTML.
   *
   * HTML rather than a PDF library: it prints to PDF from any browser, renders
   * in an email, and needs no font packaging for the rupee sign. If the client
   * later wants server-side PDFs, this same markup goes through a headless
   * Chromium without the layout being rewritten.
   */
  async renderHtml(orderId) {
    const inv = await this.build(orderId);
    const rs = (p) => paiseToRupeeString(p);
    const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    const taxColumns = inv.intraState ? `<th class="r">CGST</th><th class="r">SGST</th>` : `<th class="r">IGST</th>`;
    const lineRows = inv.lines.map((l) => `
      <tr>
        <td>${l.serial}</td>
        <td>${esc(l.description)}</td>
        <td class="c">${esc(l.hsn)}</td>
        <td class="c">${l.quantity}</td>
        <td class="r">${rs(l.unitPricePaise)}</td>
        <td class="r">${rs(l.taxableValuePaise)}</td>
        <td class="c">${l.gstRateBp / 100}%</td>
        ${inv.intraState ? `<td class="r">${rs(l.cgstPaise)}</td><td class="r">${rs(l.sgstPaise)}</td>` : `<td class="r">${rs(l.igstPaise)}</td>`}
        <td class="r b">${rs(l.totalPaise)}</td>
      </tr>`).join("");
    const summaryRows = inv.rateSummary.map((s) => `
      <tr>
        <td class="c">${s.gstRateBp / 100}%</td>
        <td class="r">${rs(s.taxableValuePaise)}</td>
        ${inv.intraState ? `<td class="r">${rs(s.cgstPaise)}</td><td class="r">${rs(s.sgstPaise)}</td>` : `<td class="r">${rs(s.igstPaise)}</td>`}
      </tr>`).join("");
    return `<!doctype html>
<html lang="en-IN"><head><meta charset="utf-8">
<title>Tax Invoice ${esc(inv.invoiceNo)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; color: #1a1a1a; font-size: 12px; line-height: 1.45; }
  h1 { font-size: 17px; margin: 0 0 2px; letter-spacing: .04em; }
  .muted { color: #666; }
  .head { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #1a1a1a; padding-bottom: 12px; }
  .parties { display: flex; gap: 24px; margin: 16px 0; }
  .parties > div { flex: 1; }
  .label { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #666; margin-bottom: 3px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { border: 1px solid #d4d4d4; padding: 6px 8px; }
  th { background: #f4f4f4; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; text-align: left; }
  .r { text-align: right; font-variant-numeric: tabular-nums; }
  .c { text-align: center; }
  .b { font-weight: 600; }
  .totals { margin-left: auto; width: 320px; margin-top: 10px; }
  .totals td { border: none; padding: 3px 8px; }
  .totals tr.grand td { border-top: 2px solid #1a1a1a; font-weight: 700; font-size: 14px; padding-top: 7px; }
  .words { margin-top: 10px; padding: 8px 10px; background: #f8f8f8; border-left: 3px solid #1a1a1a; }
  footer { margin-top: 26px; display: flex; justify-content: space-between; align-items: flex-end; font-size: 10px; }
  .sign { text-align: right; }
  .sign .line { margin-top: 38px; border-top: 1px solid #1a1a1a; padding-top: 4px; width: 190px; }
</style></head>
<body>
  <div class="head">
    <div>
      <h1>TAX INVOICE</h1>
      <div class="muted">Original for recipient</div>
    </div>
    <div class="r">
      <div><span class="muted">Invoice no.</span> <strong>${esc(inv.invoiceNo)}</strong></div>
      <div><span class="muted">Date</span> ${inv.invoiceDate.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</div>
      <div><span class="muted">Order</span> ${esc(inv.orderNo)}</div>
    </div>
  </div>

  <div class="parties">
    <div>
      <div class="label">Sold by</div>
      <div class="b">${esc(inv.seller.legalName)}</div>
      <div class="muted">${esc(inv.seller.address)}</div>
      <div>GSTIN ${esc(inv.seller.gstin)}</div>
    </div>
    <div>
      <div class="label">Billed and shipped to</div>
      <div class="b">${esc(inv.buyer.name)} <span class="muted">(${esc(inv.buyer.memberCode)})</span></div>
      <div class="muted">${esc(inv.buyer.address)}, ${esc(inv.buyer.state)} ${esc(inv.buyer.pincode)}</div>
      <div class="muted">${esc(inv.buyer.phone)}</div>
      <div>Place of supply: ${esc(inv.placeOfSupply.state)}${inv.placeOfSupply.code ? ` (${inv.placeOfSupply.code})` : ""}</div>
    </div>
  </div>

  <table>
    <thead><tr>
      <th>#</th><th>Description</th><th class="c">HSN</th><th class="c">Qty</th>
      <th class="r">Rate</th><th class="r">Taxable</th><th class="c">GST</th>
      ${taxColumns}<th class="r">Total</th>
    </tr></thead>
    <tbody>${lineRows}</tbody>
  </table>

  <table style="width:auto;margin-top:14px">
    <thead><tr>
      <th class="c">Rate</th><th class="r">Taxable value</th>
      ${inv.intraState ? '<th class="r">CGST</th><th class="r">SGST</th>' : '<th class="r">IGST</th>'}
    </tr></thead>
    <tbody>${summaryRows}</tbody>
  </table>

  <table class="totals">
    <tr><td>Taxable value</td><td class="r">${rs(inv.taxableTotalPaise)}</td></tr>
    ${inv.intraState ? `<tr><td>CGST</td><td class="r">${rs(inv.cgstTotalPaise)}</td></tr>
         <tr><td>SGST</td><td class="r">${rs(inv.sgstTotalPaise)}</td></tr>` : `<tr><td>IGST</td><td class="r">${rs(inv.igstTotalPaise)}</td></tr>`}
    ${inv.roundOffPaise !== 0n ? `<tr><td>Round off</td><td class="r">${rs(inv.roundOffPaise)}</td></tr>` : ""}
    <tr class="grand"><td>Amount payable</td><td class="r">${formatInr(inv.payablePaise)}</td></tr>
  </table>

  <div class="words"><span class="muted">In words:</span> <strong>${esc(inv.amountInWords)}</strong></div>

  <footer>
    <div class="muted">
      Paid from the member's shopping wallet. This is a computer-generated<br>
      invoice and does not require a physical signature.
    </div>
    <div class="sign">
      <div>For ${esc(inv.seller.legalName)}</div>
      <div class="line">Authorised signatory</div>
    </div>
  </footer>
</body></html>`;
  }
};
InvoiceService = __decorateClass([
  Injectable()
], InvoiceService);
var ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen"
];
var TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function twoDigits(n) {
  if (n < 20) return ONES[n];
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
}
function amountInWords(paise) {
  const negative = paise < 0n;
  const abs = negative ? -paise : paise;
  const rupees2 = Number(abs / 100n);
  const paiseLeft = Number(abs % 100n);
  const parts = [];
  const crore = Math.floor(rupees2 / 1e7);
  const lakh = Math.floor(rupees2 % 1e7 / 1e5);
  const thousand = Math.floor(rupees2 % 1e5 / 1e3);
  const hundred = Math.floor(rupees2 % 1e3 / 100);
  const rest = rupees2 % 100;
  if (crore) parts.push(`${twoDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (hundred) parts.push(`${ONES[hundred]} Hundred`);
  if (rest) parts.push(twoDigits(rest));
  const rupeeWords = parts.length ? parts.join(" ") : "Zero";
  const sign = negative ? "Minus " : "";
  return paiseLeft ? `${sign}${rupeeWords} Rupees and ${twoDigits(paiseLeft)} Paise Only` : `${sign}${rupeeWords} Rupees Only`;
}

// src/catalog/catalog.service.ts
import { Injectable as Injectable2, BadRequestException, ConflictException, NotFoundException as NotFoundException2 } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { z } from "zod";
var rupees = z.string().regex(/^\d+(\.\d{1,2})?$/, "Enter an amount with at most two decimals");
var ProductInputSchema = z.object({
  sku: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{2,23}$/, "SKU: 3 to 24 letters, digits or hyphens"),
  name: z.string().trim().min(3, "Product name is too short").max(120),
  description: z.string().trim().max(2e3).optional(),
  categoryId: z.string().min(1, "Choose a category"),
  mrp: rupees,
  price: rupees,
  bv: z.string().regex(/^\d+(\.\d{1,2})?$/, "Enter a BV value"),
  gstBp: z.number().int().min(0).max(4e3),
  hsnCode: z.string().trim().regex(/^\d{4,8}$/, "HSN must be 4 to 8 digits \u2014 a GST invoice is invalid without it"),
  countryOfOrigin: z.string().trim().min(2).max(60).default("India"),
  stock: z.number().int().min(0),
  isActive: z.boolean().default(true),
  imageUrl: z.string().trim().max(500).optional()
});
var StockAdjustSchema = z.object({
  delta: z.number().int().refine((n) => n !== 0, "Enter a non-zero adjustment"),
  reason: z.string().trim().min(4, "Record why stock is being adjusted")
});
var CatalogService = class {
  constructor(prisma) {
    this.prisma = prisma;
  }
  prisma;
  /**
   * Check a product's economics against the commission plan.
   *
   * Returns rather than throws for the warning cases, so the admin console can
   * show the consequence and let a human decide. Only the arithmetically
   * impossible case is an error.
   */
  async priceCheck(pricePaise, bvCenti) {
    const out = [];
    if (bvCenti < 0) return [{ level: "error", message: "BV cannot be negative." }];
    const bvAsPaise = BigInt(bvCenti);
    if (bvAsPaise > pricePaise) {
      out.push({
        level: "error",
        message: `BV of ${centiToBvString(bvCenti)} is higher than the selling price of ${formatInr(pricePaise)}. Commission would exceed the revenue from the sale.`
      });
      return out;
    }
    const planRow = await this.prisma.planVersion.findFirst({ orderBy: { version: "desc" } });
    if (!planRow || bvAsPaise === 0n) return out;
    const plan = planRow.config;
    const topSelfBp = Math.max(...plan.ranks.map((r) => r.selfPctBp));
    const genBp = plan.generation?.enabled ? (plan.generation.levelsBp ?? []).reduce((a, b) => a + b, 0) : 0;
    const directBp = plan.direct?.enabled ? plan.direct.pctBp : 0;
    const royaltyBp = (plan.royalty?.funds ?? []).reduce((a, f) => a + f.poolPctBp, 0);
    const totalBp = topSelfBp + genBp + directBp + royaltyBp;
    const worstCasePayout = bvAsPaise * BigInt(totalBp) / 10000n;
    if (worstCasePayout > pricePaise) {
      out.push({
        level: "error",
        message: `At ${totalBp / 100}% of BV, the worst-case payout on this product is ${formatInr(worstCasePayout)} against a selling price of ${formatInr(pricePaise)}.`
      });
    } else {
      const marginLeft = pricePaise - worstCasePayout;
      if (marginLeft * 5n < pricePaise) {
        out.push({
          level: "warning",
          message: `Only ${formatInr(marginLeft)} of the ${formatInr(pricePaise)} price is left after worst-case commission. Check this covers cost of goods, GST and delivery.`
        });
      }
    }
    return out;
  }
  async list(opts = {}) {
    const where = {};
    if (!opts.includeInactive) where.isActive = true;
    if (opts.categoryId) where.categoryId = opts.categoryId;
    if (opts.search?.trim()) {
      where.OR = [
        { name: { contains: opts.search.trim(), mode: "insensitive" } },
        { sku: { contains: opts.search.trim().toUpperCase() } }
      ];
    }
    const rows = await this.prisma.product.findMany({
      where,
      include: { category: { select: { id: true, name: true } } },
      orderBy: [{ isActive: "desc" }, { sku: "asc" }],
      take: 51,
      ...opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}
    });
    const page = rows.slice(0, 50);
    return { items: page, nextCursor: rows.length > 50 ? page[page.length - 1].id : null };
  }
  async bySlug(slug) {
    const product = await this.prisma.product.findFirst({
      where: { slug, isActive: true },
      include: { category: { select: { id: true, name: true } } }
    });
    if (!product) throw new NotFoundException2("That product is not available.");
    return product;
  }
  async create(input, actorId) {
    const pricePaise = rupeesToPaise(input.price);
    const mrpPaise = rupeesToPaise(input.mrp);
    const bvCenti = bvToCenti(input.bv);
    if (pricePaise > mrpPaise) throw new BadRequestException("Selling price cannot be above MRP.");
    if (pricePaise <= 0n) throw new BadRequestException("Selling price must be more than zero.");
    const problems = (await this.priceCheck(pricePaise, bvCenti)).filter((p) => p.level === "error");
    if (problems.length) throw new BadRequestException(problems[0].message);
    await this.prisma.category.findUniqueOrThrow({ where: { id: input.categoryId } }).catch(() => {
      throw new BadRequestException("That category does not exist.");
    });
    try {
      const product = await this.prisma.product.create({
        data: {
          sku: input.sku,
          slug: await this.uniqueSlug(input.name),
          name: input.name,
          description: input.description ?? null,
          categoryId: input.categoryId,
          mrpPaise,
          pricePaise,
          bvCenti,
          gstBp: input.gstBp,
          hsnCode: input.hsnCode,
          countryOfOrigin: input.countryOfOrigin,
          stock: input.stock,
          isActive: input.isActive,
          imageUrl: input.imageUrl ?? null
        }
      });
      await this.audit(actorId, "product.create", { sku: product.sku, name: product.name, price: input.price, bv: input.bv });
      return product;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException(`SKU ${input.sku} is already used.`);
      }
      throw e;
    }
  }
  /**
   * Update a product.
   *
   * The slug is deliberately NOT regenerated on a rename. It is the public URL:
   * changing it silently 404s every link a member has already shared, and those
   * links are how this business gets traffic.
   */
  async update(id, input, actorId) {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException2("Product not found.");
    const pricePaise = rupeesToPaise(input.price);
    const mrpPaise = rupeesToPaise(input.mrp);
    const bvCenti = bvToCenti(input.bv);
    if (pricePaise > mrpPaise) throw new BadRequestException("Selling price cannot be above MRP.");
    const problems = (await this.priceCheck(pricePaise, bvCenti)).filter((p) => p.level === "error");
    if (problems.length) throw new BadRequestException(problems[0].message);
    const product = await this.prisma.product.update({
      where: { id },
      data: {
        sku: input.sku,
        name: input.name,
        description: input.description ?? null,
        categoryId: input.categoryId,
        mrpPaise,
        pricePaise,
        bvCenti,
        gstBp: input.gstBp,
        hsnCode: input.hsnCode,
        countryOfOrigin: input.countryOfOrigin,
        stock: input.stock,
        isActive: input.isActive,
        imageUrl: input.imageUrl ?? null
      }
    });
    if (existing.bvCenti !== bvCenti) {
      await this.audit(actorId, "product.bv_change", {
        sku: product.sku,
        from: centiToBvString(existing.bvCenti),
        to: centiToBvString(bvCenti)
      });
    }
    await this.audit(actorId, "product.update", { sku: product.sku, price: input.price, stock: input.stock });
    return product;
  }
  /**
   * Products are never deleted, only deactivated.
   *
   * Order lines reference them for history, and a deleted row would break every
   * past invoice and every commission record that cites the sale.
   */
  async setActive(id, isActive, actorId) {
    const product = await this.prisma.product.update({ where: { id }, data: { isActive } });
    await this.audit(actorId, isActive ? "product.activate" : "product.deactivate", { sku: product.sku });
    return product;
  }
  /**
   * Adjust stock by a delta, never by setting an absolute value.
   *
   * An absolute set is a lost update waiting to happen: two admins reading 40
   * and writing 45 and 38 leave whichever wrote last, silently discarding the
   * other's count. A delta composes.
   */
  async adjustStock(id, delta, reason, actorId) {
    const updated = await this.prisma.product.updateMany({
      where: { id, ...delta < 0 ? { stock: { gte: -delta } } : {} },
      data: { stock: { increment: delta } }
    });
    if (updated.count === 0) {
      const current = await this.prisma.product.findUnique({ where: { id }, select: { stock: true } });
      throw new ConflictException(`Only ${current?.stock ?? 0} in stock; cannot remove ${-delta}.`);
    }
    const product = await this.prisma.product.findUniqueOrThrow({ where: { id }, select: { sku: true, stock: true } });
    await this.audit(actorId, "product.stock_adjust", { sku: product.sku, delta, reason, newStock: product.stock });
    return product;
  }
  async lowStock(threshold = 10) {
    return this.prisma.product.findMany({
      where: { isActive: true, stock: { lte: threshold } },
      select: { id: true, sku: true, name: true, stock: true, sold: true },
      orderBy: { stock: "asc" },
      take: 50
    });
  }
  /* ----------------------------------------------------------- categories */
  async categories() {
    return this.prisma.category.findMany({ orderBy: { sortkey: "asc" } });
  }
  async createCategory(name, actorId) {
    const clean = name.trim();
    if (clean.length < 2) throw new BadRequestException("Category name is too short.");
    try {
      const cat = await this.prisma.category.create({ data: { name: clean, slug: slugify(clean) } });
      await this.audit(actorId, "category.create", { name: clean });
      return cat;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException(`A category called "${clean}" already exists.`);
      }
      throw e;
    }
  }
  /** Refuses to remove a category that still holds products. */
  async deleteCategory(id, actorId) {
    const count = await this.prisma.product.count({ where: { categoryId: id } });
    if (count > 0) {
      throw new ConflictException(`${count} product${count === 1 ? "" : "s"} still use this category. Move them first.`);
    }
    const cat = await this.prisma.category.delete({ where: { id } });
    await this.audit(actorId, "category.delete", { name: cat.name });
    return { ok: true };
  }
  /* -------------------------------------------------------------- helpers */
  /** Feed for the sitemap. Only what is indexable. */
  async sitemapEntries() {
    return this.prisma.product.findMany({
      where: { isActive: true },
      select: { slug: true, updatedAt: true },
      orderBy: { updatedAt: "desc" }
    });
  }
  async uniqueSlug(name) {
    const base = slugify(name);
    for (let i = 0; i < 50; i++) {
      const candidate = i === 0 ? base : `${base}-${i + 1}`;
      const clash = await this.prisma.product.findFirst({ where: { slug: candidate }, select: { id: true } });
      if (!clash) return candidate;
    }
    return `${base}-${Date.now().toString(36)}`;
  }
  audit(actorId, action, detail) {
    return this.prisma.auditLog.create({ data: { actorType: "ADMIN", actorId, action, detail } });
  }
};
CatalogService = __decorateClass([
  Injectable2()
], CatalogService);
var slugify = (s) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

// src/__tests__/invoice.spec.ts
test("state names resolve to their GST codes", () => {
  assert.equal(stateCode("West Bengal"), "19");
  assert.equal(stateCode("Maharashtra"), "27");
  assert.equal(stateCode("Delhi"), "07");
  assert.equal(stateCode("Tamil Nadu"), "33");
});
test("casing, spacing, abbreviations and old names all resolve to one code", () => {
  for (const variant of ["west bengal", "WEST BENGAL", "  West   Bengal  ", "WB", "wb", "West Bengal."]) {
    assert.equal(stateCode(variant), "19", `"${variant}" did not resolve`);
  }
  assert.equal(stateCode("Orissa"), stateCode("Odisha"));
  assert.equal(stateCode("Pondicherry"), stateCode("Puducherry"));
  assert.equal(stateCode("New Delhi"), "07");
});
test("an unrecognised state is null rather than a wrong guess", () => {
  assert.equal(stateCode("Atlantis"), null);
  assert.equal(stateCode(""), null);
  assert.equal(stateCode(void 0), null);
});
test("same state is intra-state, different state is inter-state", () => {
  assert.equal(isIntraState("West Bengal", "West Bengal"), true);
  assert.equal(isIntraState("West Bengal", "WB"), true);
  assert.equal(isIntraState("West Bengal", "Bihar"), false);
  assert.equal(isIntraState("West Bengal", "Maharashtra"), false);
});
test("an unknown state falls back to inter-state, which is the safer error", () => {
  assert.equal(isIntraState("West Bengal", "Atlantis"), false);
  assert.equal(isIntraState("Atlantis", "Atlantis"), false);
});
function splitTax(inclusivePaise, gstBp, intra) {
  const gst = gstInclusiveComponent(inclusivePaise, gstBp);
  const taxable = inclusivePaise - gst;
  const cgst = intra ? gst / 2n : 0n;
  const sgst = intra ? gst - cgst : 0n;
  const igst = intra ? 0n : gst;
  return { taxable, gst, cgst, sgst, igst };
}
test("an 18% intra-state sale splits into 9% CGST and 9% SGST", () => {
  const { taxable, cgst, sgst, igst } = splitTax(rupeesToPaise(599), 1800, true);
  assert.equal(taxable, rupeesToPaise("507.63"));
  assert.equal(cgst, rupeesToPaise("45.68"));
  assert.equal(sgst, rupeesToPaise("45.69"));
  assert.equal(igst, 0n);
  assert.equal(taxable + cgst + sgst, rupeesToPaise(599));
});
test("the same sale inter-state is one IGST line", () => {
  const { taxable, cgst, sgst, igst } = splitTax(rupeesToPaise(599), 1800, false);
  assert.equal(cgst, 0n);
  assert.equal(sgst, 0n);
  assert.equal(igst, rupeesToPaise("91.37"));
  assert.equal(taxable + igst, rupeesToPaise(599));
});
test("intra and inter-state charge the buyer exactly the same total", () => {
  for (const price of [249, 599, 1099, 1599]) {
    const intra = splitTax(rupeesToPaise(price), 1800, true);
    const inter = splitTax(rupeesToPaise(price), 1800, false);
    assert.equal(intra.cgst + intra.sgst, inter.igst, `totals differ at \u20B9${price}`);
    assert.equal(intra.taxable, inter.taxable);
  }
});
test("CGST plus SGST always reconstructs the tax exactly, across every price", () => {
  let oddCases = 0;
  for (let rupees2 = 1; rupees2 <= 2e3; rupees2++) {
    for (const gstBp of [500, 1200, 1800, 2800]) {
      const inclusive = rupeesToPaise(rupees2);
      const { taxable, gst, cgst, sgst } = splitTax(inclusive, gstBp, true);
      assert.equal(cgst + sgst, gst, `\u20B9${rupees2} at ${gstBp}bp: halves do not sum to the tax`);
      assert.equal(taxable + cgst + sgst, inclusive, `\u20B9${rupees2} at ${gstBp}bp: does not reconcile to the price`);
      if (gst % 2n === 1n) oddCases++;
    }
  }
  assert.ok(oddCases > 0, "no odd-paise cases were exercised, so the remainder rule was never tested");
});
test("a multi-rate cart taxes each line at its own rate", () => {
  const oil = splitTax(rupeesToPaise(379), 500, true);
  const lotion = splitTax(rupeesToPaise(599), 1800, true);
  assert.equal(oil.gst, rupeesToPaise("18.04"));
  assert.equal(lotion.gst, rupeesToPaise("91.37"));
  assert.equal(oil.taxable + oil.gst + lotion.taxable + lotion.gst, rupeesToPaise(978));
});
function roundOff(grandTotal) {
  const remainder = grandTotal % 100n;
  const adj = remainder === 0n ? 0n : remainder < 50n ? -remainder : 100n - remainder;
  return { adj, payable: grandTotal + adj };
}
test("the invoice total rounds to the nearest rupee, and the adjustment is shown", () => {
  assert.deepEqual(roundOff(rupeesToPaise("978.40")), { adj: -40n, payable: rupeesToPaise(978) });
  assert.deepEqual(roundOff(rupeesToPaise("978.60")), { adj: 40n, payable: rupeesToPaise(979) });
  assert.deepEqual(roundOff(rupeesToPaise("978.50")), { adj: 50n, payable: rupeesToPaise(979) });
  assert.deepEqual(roundOff(rupeesToPaise(978)), { adj: 0n, payable: rupeesToPaise(978) });
});
test("rounding never moves the total by more than fifty paise", () => {
  for (let p = 1; p <= 1e3; p++) {
    const { adj } = roundOff(BigInt(p));
    assert.ok(adj >= -49n && adj <= 50n, `adjustment of ${adj} at ${p} paise`);
  }
});
test("amounts render on the Indian scale, not the international one", () => {
  assert.equal(amountInWords(rupeesToPaise(2e6)), "Twenty Lakh Rupees Only");
  assert.equal(amountInWords(rupeesToPaise(1e7)), "One Crore Rupees Only");
  assert.equal(amountInWords(rupeesToPaise(1234567)), "Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven Rupees Only");
});
test("common invoice amounts read correctly", () => {
  assert.equal(amountInWords(rupeesToPaise(599)), "Five Hundred Ninety Nine Rupees Only");
  assert.equal(amountInWords(rupeesToPaise(1599)), "One Thousand Five Hundred Ninety Nine Rupees Only");
  assert.equal(amountInWords(rupeesToPaise(3997)), "Three Thousand Nine Hundred Ninety Seven Rupees Only");
  assert.equal(amountInWords(rupeesToPaise(100)), "One Hundred Rupees Only");
  assert.equal(amountInWords(0n), "Zero Rupees Only");
});
test("the teens and the tens boundary are right", () => {
  assert.equal(amountInWords(rupeesToPaise(11)), "Eleven Rupees Only");
  assert.equal(amountInWords(rupeesToPaise(19)), "Nineteen Rupees Only");
  assert.equal(amountInWords(rupeesToPaise(20)), "Twenty Rupees Only");
  assert.equal(amountInWords(rupeesToPaise(21)), "Twenty One Rupees Only");
  assert.equal(amountInWords(rupeesToPaise(90)), "Ninety Rupees Only");
});
test("paise are spelled out when present", () => {
  assert.equal(amountInWords(rupeesToPaise("599.50")), "Five Hundred Ninety Nine Rupees and Fifty Paise Only");
  assert.equal(amountInWords(rupeesToPaise("0.99")), "Zero Rupees and Ninety Nine Paise Only");
});
test("a credit note amount renders as negative rather than silently positive", () => {
  assert.match(amountInWords(-rupeesToPaise(500)), /^Minus Five Hundred Rupees Only$/);
});
test("product slugs are URL-safe and stable", () => {
  assert.equal(slugify("Rose Gold Radiance Body Lotion"), "rose-gold-radiance-body-lotion");
  assert.equal(slugify("Velvet Matte Lipstick, Royal Rose"), "velvet-matte-lipstick-royal-rose");
  assert.equal(slugify("Onion & Bhringraj Hair Oil"), "onion-bhringraj-hair-oil");
  assert.equal(slugify("  Extra   Spaces  "), "extra-spaces");
  assert.equal(slugify("SPF 50 Gel"), "spf-50-gel");
});
test("a slug never starts or ends with a hyphen", () => {
  for (const name of ["---Leading", "Trailing---", "!!!Symbols!!!", "  "]) {
    const slug = slugify(name);
    assert.equal(slug.startsWith("-"), false, `"${name}" -> "${slug}"`);
    assert.equal(slug.endsWith("-"), false, `"${name}" -> "${slug}"`);
  }
});
test("a realistic two-line intra-state invoice reconciles completely", () => {
  const lines = [
    { inclusive: rupeesToPaise(1599) * 2n, gstBp: 1800 },
    // Oud Royale x2
    { inclusive: rupeesToPaise(379), gstBp: 500 }
    // Hair oil x1
  ].map((l) => splitTax(l.inclusive, l.gstBp, true));
  const taxable = lines.reduce((a, l) => a + l.taxable, 0n);
  const cgst = lines.reduce((a, l) => a + l.cgst, 0n);
  const sgst = lines.reduce((a, l) => a + l.sgst, 0n);
  const grand = taxable + cgst + sgst;
  assert.equal(grand, rupeesToPaise(3577), "the invoice total does not match what the buyer paid");
  const { payable } = roundOff(grand);
  assert.equal(formatInr(payable), "\u20B93,577");
  assert.equal(amountInWords(payable), "Three Thousand Five Hundred Seventy Seven Rupees Only");
});
