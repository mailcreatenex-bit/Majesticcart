import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Paise, formatInr, paiseToRupeeString, gstInclusiveComponent } from '../common/money';

/**
 * GST tax invoices.
 *
 * The arithmetic here is the part that has to be exactly right, because an
 * invoice is a statutory document: it is what the client files returns against
 * and what a buyer claims input credit on.
 *
 * ── Intra-state versus inter-state ───────────────────────────────────────
 * The single most common mistake in Indian e-commerce billing. GST at 18% is
 * NOT one line of 18%. Where the place of supply is the same state as the
 * seller it splits into CGST 9% + SGST 9%; where it differs it is IGST 18%.
 * Same total either way, but filed under different heads — and getting it
 * wrong means amended returns and a mismatch against the buyer's claim.
 *
 * The comparison is on the state code, not the state name: "West Bengal",
 * "west bengal" and "WB" are one place of supply.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Prices are GST-inclusive, so tax is extracted from the shelf price rather
 * than added to it, and every figure stays integer paise throughout.
 */

/** GST state codes, the first two digits of a GSTIN. */
import { stateCode, isIntraState } from '../common/gst-state';

// Re-exported: these moved to common/ so the order module could use them for
// the checkout quote without importing the invoice module. Callers that knew
// them here keep working.
export { STATE_CODES, stateCode, isIntraState } from '../common/gst-state';

export interface InvoiceLine {
  serial: number;
  description: string;
  hsn: string;
  quantity: number;
  unitPricePaise: Paise; // exclusive of GST
  taxableValuePaise: Paise;
  gstRateBp: number;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  totalPaise: Paise; // inclusive
}

export interface TaxRateSummary {
  gstRateBp: number;
  taxableValuePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
}

export interface Invoice {
  invoiceNo: string;
  invoiceDate: Date;
  orderNo: string;
  placeOfSupply: { state: string; code: string | null };
  intraState: boolean;
  seller: { legalName: string; address: string; gstin: string; stateCode: string | null };
  buyer: { name: string; memberCode: string; address: string; state: string; pincode: string; phone: string };
  lines: InvoiceLine[];
  rateSummary: TaxRateSummary[];
  taxableTotalPaise: Paise;
  cgstTotalPaise: Paise;
  sgstTotalPaise: Paise;
  igstTotalPaise: Paise;
  grandTotalPaise: Paise;
  roundOffPaise: Paise;
  payablePaise: Paise;
  amountInWords: string;
}

@Injectable()
export class InvoiceService {
  constructor(private readonly prisma: PrismaClient) {}

  async build(orderId: string): Promise<Invoice> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, member: { select: { memberCode: true, name: true, phone: true } } },
    });
    if (!order) throw new NotFoundException('Order not found.');
    if (!order.invoiceNo) throw new NotFoundException('No invoice has been raised for this order yet. Invoices are issued on delivery.');

    const settings = await this.prisma.storeSetting.findUnique({ where: { key: 'store' } });
    const store = (settings?.value ?? {}) as Record<string, string>;
    const sellerState = store.state ?? 'West Bengal';
    const intraState = isIntraState(sellerState, order.shipState);

    const lines: InvoiceLine[] = order.items.map((item: any, i: number) => {
      const qty = BigInt(item.quantity);
      const lineInclusive: Paise = item.pricePaise * qty;
      const gstPaise = gstInclusiveComponent(lineInclusive, item.gstBp);
      const taxable = lineInclusive - gstPaise;

      // The split must add back to exactly the tax charged. Halving and
      // rounding each half independently can lose a paise, so SGST takes the
      // remainder rather than being computed separately.
      const cgst = intraState ? gstPaise / 2n : 0n;
      const sgst = intraState ? gstPaise - cgst : 0n;
      const igst = intraState ? 0n : gstPaise;

      return {
        serial: i + 1,
        description: item.nameSnapshot,
        hsn: item.hsnSnapshot || '3304',
        quantity: item.quantity,
        unitPricePaise: (item.pricePaise * 10_000n) / BigInt(10_000 + item.gstBp),
        taxableValuePaise: taxable,
        gstRateBp: item.gstBp,
        cgstPaise: cgst,
        sgstPaise: sgst,
        igstPaise: igst,
        totalPaise: lineInclusive,
      };
    });

    // Returns are filed by rate, not by line.
    const byRate = new Map<number, TaxRateSummary>();
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

    // Section 170: the invoice total is rounded to the nearest rupee, and the
    // adjustment is shown as its own line rather than absorbed silently.
    const remainder = grandTotal % 100n;
    const roundOff = remainder === 0n ? 0n : remainder < 50n ? -remainder : 100n - remainder;
    const payable = grandTotal + roundOff;

    return {
      invoiceNo: order.invoiceNo,
      invoiceDate: order.invoicedAt ?? order.deliveredAt ?? order.createdAt,
      orderNo: order.orderNo,
      placeOfSupply: { state: order.shipState, code: stateCode(order.shipState) },
      intraState,
      seller: {
        legalName: store.legalName ?? store.name ?? 'Majestic Cart',
        address: store.registeredAddress ?? '',
        gstin: store.gstin ?? '',
        stateCode: stateCode(sellerState),
      },
      buyer: {
        name: order.shipName, memberCode: order.member.memberCode,
        address: order.shipLine, state: order.shipState,
        pincode: order.shipPincode, phone: order.shipPhone,
      },
      lines,
      rateSummary: [...byRate.values()].sort((a, b) => a.gstRateBp - b.gstRateBp),
      taxableTotalPaise: taxableTotal,
      cgstTotalPaise: cgstTotal,
      sgstTotalPaise: sgstTotal,
      igstTotalPaise: igstTotal,
      grandTotalPaise: grandTotal,
      roundOffPaise: roundOff,
      payablePaise: payable,
      amountInWords: amountInWords(payable),
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
  async renderHtml(orderId: string): Promise<string> {
    const inv = await this.build(orderId);
    const rs = (p: Paise) => paiseToRupeeString(p);
    const esc = (s: string) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

    const taxColumns = inv.intraState
      ? `<th class="r">CGST</th><th class="r">SGST</th>`
      : `<th class="r">IGST</th>`;

    const lineRows = inv.lines.map((l) => `
      <tr>
        <td>${l.serial}</td>
        <td>${esc(l.description)}</td>
        <td class="c">${esc(l.hsn)}</td>
        <td class="c">${l.quantity}</td>
        <td class="r">${rs(l.unitPricePaise)}</td>
        <td class="r">${rs(l.taxableValuePaise)}</td>
        <td class="c">${l.gstRateBp / 100}%</td>
        ${inv.intraState
          ? `<td class="r">${rs(l.cgstPaise)}</td><td class="r">${rs(l.sgstPaise)}</td>`
          : `<td class="r">${rs(l.igstPaise)}</td>`}
        <td class="r b">${rs(l.totalPaise)}</td>
      </tr>`).join('');

    const summaryRows = inv.rateSummary.map((s) => `
      <tr>
        <td class="c">${s.gstRateBp / 100}%</td>
        <td class="r">${rs(s.taxableValuePaise)}</td>
        ${inv.intraState
          ? `<td class="r">${rs(s.cgstPaise)}</td><td class="r">${rs(s.sgstPaise)}</td>`
          : `<td class="r">${rs(s.igstPaise)}</td>`}
      </tr>`).join('');

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
      <div><span class="muted">Date</span> ${inv.invoiceDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
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
      <div>Place of supply: ${esc(inv.placeOfSupply.state)}${inv.placeOfSupply.code ? ` (${inv.placeOfSupply.code})` : ''}</div>
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
    ${inv.intraState
      ? `<tr><td>CGST</td><td class="r">${rs(inv.cgstTotalPaise)}</td></tr>
         <tr><td>SGST</td><td class="r">${rs(inv.sgstTotalPaise)}</td></tr>`
      : `<tr><td>IGST</td><td class="r">${rs(inv.igstTotalPaise)}</td></tr>`}
    ${inv.roundOffPaise !== 0n ? `<tr><td>Round off</td><td class="r">${rs(inv.roundOffPaise)}</td></tr>` : ''}
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
}

/* ------------------------------------------------------------ in words */

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`;
}

/**
 * Amount in words, on the Indian scale — lakh and crore, not million.
 * An invoice reading "Two Million Rupees" would be read as an error here.
 */
export function amountInWords(paise: Paise): string {
  const negative = paise < 0n;
  const abs = negative ? -paise : paise;
  const rupees = Number(abs / 100n);
  const paiseLeft = Number(abs % 100n);

  const parts: string[] = [];
  const crore = Math.floor(rupees / 10_000_000);
  const lakh = Math.floor((rupees % 10_000_000) / 100_000);
  const thousand = Math.floor((rupees % 100_000) / 1000);
  const hundred = Math.floor((rupees % 1000) / 100);
  const rest = rupees % 100;

  if (crore) parts.push(`${twoDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (hundred) parts.push(`${ONES[hundred]} Hundred`);
  if (rest) parts.push(twoDigits(rest));

  const rupeeWords = parts.length ? parts.join(' ') : 'Zero';
  const sign = negative ? 'Minus ' : '';
  return paiseLeft
    ? `${sign}${rupeeWords} Rupees and ${twoDigits(paiseLeft)} Paise Only`
    : `${sign}${rupeeWords} Rupees Only`;
}
