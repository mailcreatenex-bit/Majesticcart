

/**
 * GST place-of-supply resolution.
 *
 * Lives in common/ rather than with the invoice because three callers need it
 * and none of them is the invoice: the checkout quote (to show the right tax
 * split before an order exists), the invoice (to raise it), and the storefront
 * (to offer a state list that resolves). Keeping it in the invoice module made
 * the order module import the invoice module for one pure function.
 */

export const STATE_CODES: Record<string, string> = {
  'jammu and kashmir': '01', 'himachal pradesh': '02', 'punjab': '03', 'chandigarh': '04',
  'uttarakhand': '05', 'haryana': '06', 'delhi': '07', 'rajasthan': '08', 'uttar pradesh': '09',
  'bihar': '10', 'sikkim': '11', 'arunachal pradesh': '12', 'nagaland': '13', 'manipur': '14',
  'mizoram': '15', 'tripura': '16', 'meghalaya': '17', 'assam': '18', 'west bengal': '19',
  'jharkhand': '20', 'odisha': '21', 'chhattisgarh': '22', 'madhya pradesh': '23', 'gujarat': '24',
  'maharashtra': '27', 'karnataka': '29', 'goa': '30', 'lakshadweep': '31', 'kerala': '32',
  'tamil nadu': '33', 'puducherry': '34', 'andaman and nicobar islands': '35', 'telangana': '36',
  'andhra pradesh': '37', 'ladakh': '38',
};

const ALIASES: Record<string, string> = {
  wb: 'west bengal', up: 'uttar pradesh', mp: 'madhya pradesh', tn: 'tamil nadu',
  ap: 'andhra pradesh', hp: 'himachal pradesh', jk: 'jammu and kashmir', mh: 'maharashtra',
  ka: 'karnataka', kl: 'kerala', gj: 'gujarat', rj: 'rajasthan', pb: 'punjab',
  hr: 'haryana', br: 'bihar', od: 'odisha', or: 'odisha', tg: 'telangana', ts: 'telangana',
  'orissa': 'odisha', 'pondicherry': 'puducherry', 'nct of delhi': 'delhi', 'new delhi': 'delhi',
};

export function stateCode(state: string): string | null {
  const clean = (state ?? '').trim().toLowerCase().replace(/[^a-z\s&]/g, '').replace(/\s+/g, ' ');
  const resolved = ALIASES[clean] ?? clean;
  return STATE_CODES[resolved] ?? null;
}

export const isIntraState = (sellerState: string, buyerState: string): boolean => {
  const a = stateCode(sellerState);
  const b = stateCode(buyerState);
  // Unknown state: treat as inter-state. IGST filed where CGST+SGST was due is
  // correctable; the reverse leaves the buyer unable to claim credit at all.
  return a !== null && b !== null && a === b;
};
