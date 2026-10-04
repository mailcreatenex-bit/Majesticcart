import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchStatement, rowHasUtr, toPaise, type PendingRecharge } from '../recharge/statement';

const pending = (id: string, utr: string, rupees: number, flags: string[] = []): PendingRecharge => ({ id, utr, claimedPaise: BigInt(Math.round(rupees * 100)), flags });
const verdicts = (csv: string, p: PendingRecharge[]) => Object.fromEntries(matchStatement(csv, p).results.map((r) => [r.id, r.verdict]));

// A typical HDFC-style export, with the preamble banks put above the table.
const HDFC = `Account Statement,,,,,,
Customer Name: MAJESTIC CART,,,,,,
Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance
01/10/26,UPI-AMAL DEY-amal@okhdfc-HDFC0001-412345678901-NA,0000412345678901,01/10/26,,"1,000.00","51,000.00"
01/10/26,UPI-PRIYA S-priya@ybl-YESB0001-509876543210-NA,0000509876543210,01/10/26,,500.00,"51,500.00"
02/10/26,NEFT DR-SUPPLIER LTD-998877665544-PAYMENT,0000998877665544,02/10/26,"2,000.00",,"49,500.00"
`;

test('a UTR with exactly the claimed amount credited is a match', () => {
  assert.deepEqual(verdicts(HDFC, [pending('a', '412345678901', 1000), pending('b', '509876543210', 500)]), { a: 'MATCHED', b: 'MATCHED' });
});

test('a different amount is not matched, and the bank amount is reported', () => {
  const r = matchStatement(HDFC, [pending('a', '412345678901', 1200)]).results[0];
  assert.equal(r.verdict, 'AMOUNT_DIFFERS');
  assert.equal(r.bankPaise, 100000n);
});

test('a UTR that is a debit in the statement is never a match', () => {
  assert.equal(verdicts(HDFC, [pending('d', '998877665544', 2000)]).d, 'NOT_A_CREDIT');
});

test('a UTR that is not in the statement is left for a person', () => {
  assert.equal(verdicts(HDFC, [pending('x', '111111111111', 1000)]).x, 'NOT_FOUND');
});

test('a request carrying a fraud flag is never auto-matched, even if the statement agrees', () => {
  assert.equal(verdicts(HDFC, [pending('f', '412345678901', 1000, ['DUPLICATE_UTR'])]).f, 'FLAGGED');
});

test('a UTR that appears on two rows is ambiguous, not matched', () => {
  const csv = `${HDFC}03/10/26,UPI-SOMEONE-412345678901-NA,x,03/10/26,,1000.00,"50,500.00"\n`;
  assert.equal(verdicts(csv, [pending('a', '412345678901', 1000)]).a, 'SEEN_TWICE');
});

test('a UTR must be a whole token: a longer number that contains it does not count', () => {
  assert.equal(rowHasUtr('REF 9412345678901234', '412345678901'), false);
  assert.equal(rowHasUtr('UPI/412345678901/NAME', '412345678901'), true);
  assert.equal(rowHasUtr('upi-412345678901-na', '412345678901'), true);
});

test('SBI-style Debit / Credit columns work', () => {
  const sbi = `Txn Date,Value Date,Description,Ref No./Cheque No.,Debit,Credit,Balance\n01 Oct 2026,01 Oct 2026,UPI/CR/412345678901/AMAL,,,"2,500.00","9,999.00"\n`;
  assert.equal(verdicts(sbi, [pending('a', '412345678901', 2500)]).a, 'MATCHED');
});

test('a single Amount column with a Dr/Cr column works; without a way to tell, nothing is guessed', () => {
  const withType = `Date,Particulars,DR/CR,Amount,Balance\n01-10-2026,UPI 412345678901 AMAL,CR,750.00,1000\n01-10-2026,UPI 509876543210 PRIYA,DR,750.00,250\n`;
  assert.deepEqual(verdicts(withType, [pending('a', '412345678901', 750), pending('b', '509876543210', 750)]), { a: 'MATCHED', b: 'NOT_A_CREDIT' });
  const lone = `Date,Narration,Amount\n01-10-2026,UPI 412345678901 AMAL,750.00\n`;
  assert.equal(verdicts(lone, [pending('a', '412345678901', 750)]).a, 'NOT_A_CREDIT');
});

test('a file that is not a bank statement is reported as not understood, and nothing matches', () => {
  const r = matchStatement('hello,world\n1,2\n', [pending('a', '412345678901', 1000)]);
  assert.equal(r.understood, false);
  assert.equal(r.results[0].verdict, 'NOT_FOUND');
});

test('amounts in the usual written forms are read exactly', () => {
  assert.equal(toPaise('1,00,000.50'), 10000050n);
  assert.equal(toPaise('₹ 500'), 50000n);
  assert.equal(toPaise('500.00(Cr)'), 50000n);
  assert.equal(toPaise('-250.5'), -25050n);
  assert.equal(toPaise(''), null);
  assert.equal(toPaise('n/a'), null);
});
