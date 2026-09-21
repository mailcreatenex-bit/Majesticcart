/**
 * UPI payment QR codes.
 *
 * The QR encodes a UPI intent URI (NPCI's `upi://pay` scheme) and is rendered
 * as an SVG on the server.
 *
 * Why server-side matters here rather than being a preference: this QR is where
 * the member's money goes. Generated in the browser from a string the client
 * holds, a tampered bundle, a malicious extension or an injected script could
 * repoint it at another account — and the member would scan it, pay, and have
 * a screenshot proving they paid *someone*. Rendering it on the server means
 * the bytes the member scans were produced where the payee account is known.
 */

/** Fields NPCI defines for the intent URI. Order is not significant. */
export interface UpiPayee {
  /** Virtual payment address, e.g. majesticcart@hdfcbank. */
  vpa: string;
  /** Payee name as it should appear in the member's UPI app. */
  name: string;
  /** Optional fixed amount in rupees, as a two-decimal string. */
  amountRupees?: string;
  /** Free text shown as the payment note. */
  note?: string;
}

export const VPA_RE = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/;

export function upiIntentUri(payee: UpiPayee): string {
  if (!VPA_RE.test(payee.vpa)) {
    throw new Error(`"${payee.vpa}" is not a valid UPI ID`);
  }

  const params = new URLSearchParams({
    pa: payee.vpa,
    pn: payee.name,
    cu: 'INR',
  });
  // Omitted rather than sent empty: an `am=` with no value makes some UPI apps
  // reject the intent outright instead of prompting for an amount.
  if (payee.amountRupees) params.set('am', payee.amountRupees);
  if (payee.note) params.set('tn', payee.note);

  // URLSearchParams encodes a space as "+", which several UPI apps show
  // literally in the payee name. %20 is what the scheme expects.
  return `upi://pay?${params.toString().replace(/\+/g, '%20')}`;
}

/**
 * The intent URI as an SVG QR code.
 *
 * SVG rather than PNG: it is a fraction of the bytes, it stays sharp when a
 * member zooms in to scan it from another phone's screen, and it needs no
 * canvas. Error correction level M — enough to survive a scratched screen,
 * without inflating the module count so far that the QR becomes dense enough
 * to be slow to scan on a cheap camera.
 */
export async function upiQrSvg(payee: UpiPayee): Promise<string> {
  const { toString } = await import('qrcode');
  return toString(upiIntentUri(payee), {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 512,
    color: { dark: '#34172B', light: '#FFFFFF' },
  });
}
