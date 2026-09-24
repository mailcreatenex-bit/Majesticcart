import { jsPDF } from 'jspdf';

/**
 * Draws the income statement as an A4 PDF.
 *
 * Kept in its own module so jsPDF is only downloaded when someone asks for the
 * file (the page imports this dynamically). The built-in PDF fonts have no rupee
 * sign, so amounts are written "Rs. 1,234.00" rather than with a glyph that would
 * come out as a stray character.
 */

interface Money { amount: string }
interface StatementData {
  period: string;
  generatedAt: string;
  member: { code: string; name: string; location: string | null };
  income: { label: string; count: number; amount: Money }[];
  totalIncome: Money;
  credits: { at: string; label: string; amount: Money; note: string | null }[];
  creditsTruncated: boolean;
  withdrawals: { at: string; status: string; requested: Money; deduction: Money; deductionPct: number; net: Money }[];
  withdrawalTotals: { requested: Money; deduction: Money; net: Money };
  openingBalance: Money;
  closingBalance: Money;
}

const rs = (m: Money) => `Rs. ${Number(m.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

export function buildStatementPdf(d: StatementData, monthLabel: string): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, L = 15, R = W - 15;
  let y = 18;

  const ensure = (need: number) => {
    if (y + need > 282) { doc.addPage(); y = 18; }
  };
  const text = (s: string, x: number, opts: { size?: number; bold?: boolean; align?: 'left' | 'right' | 'center'; color?: number } = {}) => {
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    doc.setFontSize(opts.size ?? 10);
    doc.setTextColor(opts.color ?? 30);
    doc.text(s, x, y, { align: opts.align ?? 'left' });
  };
  const rule = () => { doc.setDrawColor(210); doc.line(L, y, R, y); };

  text('MAJESTIC CART', L, { size: 16, bold: true });
  text('Income statement', R, { size: 12, bold: true, align: 'right' });
  y += 7;
  text(monthLabel, R, { size: 11, align: 'right', color: 90 });
  y += 4; rule(); y += 7;

  text(d.member.name, L, { size: 11, bold: true });
  y += 5;
  text(`Member ID ${d.member.code}${d.member.location ? `  |  ${d.member.location}` : ''}`, L, { color: 90 });
  y += 5;
  text(`Generated ${day(d.generatedAt)}`, L, { size: 9, color: 120 });
  y += 10;

  // Income by kind
  text('Income earned', L, { size: 11, bold: true }); y += 6;
  for (const r of d.income) {
    text(r.label + (r.count ? `  (${r.count})` : ''), L);
    text(rs(r.amount), R, { align: 'right' });
    y += 5.5;
  }
  rule(); y += 6;
  text('Total income', L, { bold: true });
  text(rs(d.totalIncome), R, { bold: true, align: 'right' });
  y += 11;

  // Withdrawals and TDS
  ensure(30);
  text('Withdrawals and deduction (TDS)', L, { size: 11, bold: true }); y += 6;
  if (d.withdrawals.length === 0) {
    text('No withdrawals were requested this month.', L, { color: 90 }); y += 8;
  } else {
    const cols = { date: L, req: 60, ded: 100, net: 140, st: 172 };
    text('Date', cols.date, { size: 8, bold: true, color: 110 });
    text('Requested', cols.req, { size: 8, bold: true, color: 110 });
    text('Deduction', cols.ded, { size: 8, bold: true, color: 110 });
    text('Paid to you', cols.net, { size: 8, bold: true, color: 110 });
    text('Status', cols.st, { size: 8, bold: true, color: 110 });
    y += 2; rule(); y += 5;
    for (const w of d.withdrawals) {
      ensure(8);
      text(day(w.at), cols.date, { size: 9 });
      text(rs(w.requested), cols.req, { size: 9 });
      text(`${rs(w.deduction)} (${w.deductionPct}%)`, cols.ded, { size: 9 });
      text(rs(w.net), cols.net, { size: 9 });
      text(w.status === 'REJECTED' ? 'Returned' : w.status === 'PAID' ? 'Paid' : 'Pending', cols.st, { size: 9 });
      y += 5.5;
    }
    rule(); y += 6;
    text('Total (rejected withdrawals excluded)', cols.date, { size: 9, bold: true });
    text(rs(d.withdrawalTotals.requested), cols.req, { size: 9, bold: true });
    text(rs(d.withdrawalTotals.deduction), cols.ded, { size: 9, bold: true });
    text(rs(d.withdrawalTotals.net), cols.net, { size: 9, bold: true });
    y += 10;
  }

  ensure(24);
  text('Income wallet, start of month', L); text(rs(d.openingBalance), R, { align: 'right' }); y += 6;
  text('Income wallet, end of month', L, { bold: true }); text(rs(d.closingBalance), R, { bold: true, align: 'right' }); y += 12;

  // Individual credits
  if (d.credits.length > 0) {
    ensure(20);
    text('Credits in detail', L, { size: 11, bold: true }); y += 6;
    for (const c of d.credits) {
      ensure(7);
      text(day(c.at), L, { size: 9, color: 90 });
      text(c.label, 45, { size: 9 });
      text(rs(c.amount), R, { size: 9, align: 'right' });
      y += 5;
    }
    if (d.creditsTruncated) { y += 2; text('Showing the first 500 credits of the month.', L, { size: 8, color: 120 }); y += 5; }
  }

  ensure(20);
  y += 4; rule(); y += 5;
  const note = 'This statement is generated from Majestic Cart\'s records for the month shown. The deduction is the amount withheld from each withdrawal and accounted for as tax deducted at source; it is not a fee for using the service. Keep this statement with your tax records.';
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(120);
  doc.text(doc.splitTextToSize(note, R - L), L, y);

  return doc.output('blob');
}
