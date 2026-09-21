/**
 * Indian states and union territories, with their GST state codes.
 *
 * GENERATED from the backend's STATE_CODES table (src/common/gst-state.ts)
 * and checked against it by a test. It is not hand-maintained.
 *
 * Why it matters that these match exactly: the delivery state decides whether
 * an order is taxed CGST+SGST (within the state) or IGST (across it). The
 * backend resolves a state name through a lookup with a small alias table —
 * "wb", "orissa" and so on — and a name it cannot resolve is treated as
 * inter-state, because IGST filed where CGST+SGST was due is correctable while
 * the reverse leaves the buyer unable to claim credit at all.
 *
 * So the checkout form offers a fixed list rather than a text field. A member
 * typing "W.B." must not become a different tax treatment from one typing
 * "West Bengal".
 */

export interface IndianState {
  /** The GST state code, as it appears in the first two digits of a GSTIN. */
  code: string;
  /** Exactly the spelling the backend resolves. Do not reword. */
  name: string;
}

export const INDIAN_STATES: readonly IndianState[] = [
  { code: '35', name: 'Andaman and Nicobar Islands' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '18', name: 'Assam' },
  { code: '10', name: 'Bihar' },
  { code: '04', name: 'Chandigarh' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '07', name: 'Delhi' },
  { code: '30', name: 'Goa' },
  { code: '24', name: 'Gujarat' },
  { code: '06', name: 'Haryana' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '01', name: 'Jammu and Kashmir' },
  { code: '20', name: 'Jharkhand' },
  { code: '29', name: 'Karnataka' },
  { code: '32', name: 'Kerala' },
  { code: '38', name: 'Ladakh' },
  { code: '31', name: 'Lakshadweep' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '27', name: 'Maharashtra' },
  { code: '14', name: 'Manipur' },
  { code: '17', name: 'Meghalaya' },
  { code: '15', name: 'Mizoram' },
  { code: '13', name: 'Nagaland' },
  { code: '21', name: 'Odisha' },
  { code: '34', name: 'Puducherry' },
  { code: '03', name: 'Punjab' },
  { code: '08', name: 'Rajasthan' },
  { code: '11', name: 'Sikkim' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '36', name: 'Telangana' },
  { code: '16', name: 'Tripura' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '19', name: 'West Bengal' },
] as const;

/** Case-insensitive lookup, matching how the backend normalises a name. */
export function stateCodeFor(name: string): string | null {
  const clean = (name ?? '').trim().toLowerCase();
  return INDIAN_STATES.find((s) => s.name.toLowerCase() === clean)?.code ?? null;
}
