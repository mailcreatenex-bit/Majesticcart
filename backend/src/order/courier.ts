/**
 * Couriers.
 *
 * Three ways a parcel can be tracked, all optional (the keys are entered by an admin
 * under Integrations in the console) so the store works on day one with nothing configured:
 *
 *   • Manual — the admin picks a courier and types the AWB / tracking number.
 *     The member gets a tracking link built from the courier's public page.
 *   • Live scans — if a Delhivery token or a Shiprocket email and password are set, the member's tracking page also shows the courier's own scan
 *     history (fetched on demand and cached briefly).
 *   • Webhook — the courier calls POST /webhooks/courier with the webhook secret
 *     and a delivered status moves the order to DELIVERED on its own.
 *
 * The live-scan calls follow each courier's published tracking API. They fail
 * soft: any error just means the page shows the order's own timeline instead.
 */

export interface CourierDef {
  key: string;
  label: string;
  /** Public tracking page for an AWB, so a member can follow the parcel without our help. */
  url: (awb: string) => string;
}

export const COURIERS: CourierDef[] = [
  { key: 'delhivery', label: 'Delhivery', url: (a) => `https://www.delhivery.com/track-v2/package/${encodeURIComponent(a)}` },
  { key: 'shiprocket', label: 'Shiprocket', url: (a) => `https://shiprocket.co/tracking/${encodeURIComponent(a)}` },
  { key: 'bluedart', label: 'Blue Dart', url: (a) => `https://www.bluedart.com/tracking?trackFor=0&trackNo=${encodeURIComponent(a)}` },
  { key: 'dtdc', label: 'DTDC', url: (a) => `https://www.dtdc.in/tracking.asp?strCnno=${encodeURIComponent(a)}` },
  { key: 'ecom', label: 'Ecom Express', url: (a) => `https://ecomexpress.in/tracking/?awb_field=${encodeURIComponent(a)}` },
  { key: 'indiapost', label: 'India Post', url: (a) => `https://www.indiapost.gov.in/_layouts/15/dop.portal.tracking/trackconsignment.aspx?id=${encodeURIComponent(a)}` },
  { key: 'other', label: 'Other courier', url: () => '' },
];

export const COURIER_KEYS = COURIERS.map((c) => c.key) as [string, ...string[]];

export function courierLabel(key: string | null | undefined): string | null {
  return COURIERS.find((c) => c.key === key)?.label ?? null;
}

export function trackingUrl(key: string | null | undefined, awb: string | null | undefined): string | null {
  if (!key || !awb) return null;
  const url = COURIERS.find((c) => c.key === key)?.url(awb) ?? '';
  return url || null;
}

export interface Scan {
  at: string | null;
  text: string;
  location: string | null;
}

export interface LiveTracking {
  status: string | null;
  scans: Scan[];
}

/** Whether a courier's own status text means the parcel has reached the customer. */
export function isDeliveredStatus(status: string | null | undefined): boolean {
  return /^\s*delivered\b/i.test(status ?? '');
}

/** The courier keys, as entered under Integrations (see integrations/integrations.service.ts). */
export interface CourierCreds {
  delhiveryToken: string;
  shiprocketEmail: string;
  shiprocketPassword: string;
}

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: LiveTracking | null }>();

let shiprocketToken: { token: string; at: number; who: string } | null = null;

async function getJson(url: string, headers: Record<string, string>): Promise<any> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`status ${res.status}`);
  return res.json();
}

async function delhivery(awb: string, creds: CourierCreds): Promise<LiveTracking | null> {
  const token = creds.delhiveryToken;
  if (!token) return null;
  const data = await getJson(
    `https://track.delhivery.com/api/v1/packages/json/?waybill=${encodeURIComponent(awb)}`,
    { Authorization: `Token ${token}` },
  );
  const shipment = data?.ShipmentData?.[0]?.Shipment;
  if (!shipment) return null;
  const scans: Scan[] = (shipment.Scans ?? [])
    .map((s: any) => s?.ScanDetail)
    .filter(Boolean)
    .map((d: any) => ({
      at: d.ScanDateTime ?? null,
      text: String(d.Instructions || d.Scan || '').trim(),
      location: d.ScannedLocation ?? null,
    }))
    .filter((s: Scan) => s.text)
    .reverse();
  return { status: shipment.Status?.Status ?? null, scans };
}

async function shiprocketAuth(creds: CourierCreds): Promise<string | null> {
  const email = creds.shiprocketEmail;
  const password = creds.shiprocketPassword;
  if (!email || !password) return null;
  // Shiprocket tokens last days; refresh well inside that.
  if (shiprocketToken && shiprocketToken.who === email && Date.now() - shiprocketToken.at < 24 * 3600 * 1000) return shiprocketToken.token;
  const res = await fetch('https://apiv2.shiprocket.in/v1/external/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`status ${res.status}`);
  const body = (await res.json()) as { token?: string };
  if (!body.token) return null;
  shiprocketToken = { token: body.token, at: Date.now(), who: email };
  return body.token;
}

async function shiprocket(awb: string, creds: CourierCreds): Promise<LiveTracking | null> {
  const token = await shiprocketAuth(creds);
  if (!token) return null;
  const data = await getJson(
    `https://apiv2.shiprocket.in/v1/external/courier/track/awb/${encodeURIComponent(awb)}`,
    { Authorization: `Bearer ${token}` },
  );
  const t = data?.tracking_data;
  if (!t) return null;
  const scans: Scan[] = (t.shipment_track_activities ?? [])
    .map((a: any) => ({ at: a.date ?? null, text: String(a['sr-status-label'] || a.activity || '').trim(), location: a.location ?? null }))
    .filter((s: Scan) => s.text);
  const status = t.shipment_track?.[0]?.current_status ?? null;
  return { status, scans };
}

/** The courier's own scan history, or null when none is configured / reachable. Cached for ten minutes. */
export async function liveTracking(courier: string | null, awb: string | null, creds: CourierCreds): Promise<LiveTracking | null> {
  if (!courier || !awb) return null;
  const key = `${courier}:${awb}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  let value: LiveTracking | null = null;
  try {
    if (courier === 'delhivery') value = await delhivery(awb, creds);
    else if (courier === 'shiprocket') value = await shiprocket(awb, creds);
  } catch {
    value = null;
  }
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 500) cache.delete(cache.keys().next().value as string);
  return value;
}

/** Pulls an AWB and a status out of the shapes Shiprocket and Delhivery post to a webhook. */
export function parseWebhook(body: any): { awb: string; status: string } | null {
  if (!body || typeof body !== 'object') return null;
  const awb = body.awb ?? body.AWB ?? body.Shipment?.AWB ?? body.waybill ?? body.Waybill;
  const status = body.current_status ?? body.status ?? body.Shipment?.Status?.Status ?? body.Status?.Status ?? body.Status;
  if (typeof awb !== 'string' && typeof awb !== 'number') return null;
  if (typeof status !== 'string') return null;
  return { awb: String(awb).trim(), status: status.trim() };
}

/** Whether a pincode is one the courier delivers to (prepaid), or null when no courier is set up to ask. */
const pinCache = new Map<string, { at: number; value: boolean | null }>();
export async function pincodeServiceable(pincode: string, creds: CourierCreds): Promise<boolean | null> {
  if (!creds.delhiveryToken) return null;
  const hit = pinCache.get(pincode);
  if (hit && Date.now() - hit.at < 6 * 3600 * 1000) return hit.value;
  let value: boolean | null = null;
  try {
    const data = await getJson(
      `https://track.delhivery.com/c/api/pin-codes/json/?filter_codes=${encodeURIComponent(pincode)}`,
      { Authorization: `Token ${creds.delhiveryToken}` },
    );
    const rows: any[] = data?.delivery_codes ?? [];
    value = rows.length > 0 && rows.some((r) => String(r?.postal_code?.pre_paid ?? 'Y').toUpperCase() !== 'N');
  } catch {
    value = null;
  }
  pinCache.set(pincode, { at: Date.now(), value });
  if (pinCache.size > 2000) pinCache.delete(pinCache.keys().next().value as string);
  return value;
}

/** For the console's "Test connection" button: says in plain words whether each configured courier accepted its keys. */
export async function testCourierKeys(creds: CourierCreds): Promise<{ courier: string; ok: boolean; message: string }[]> {
  const out: { courier: string; ok: boolean; message: string }[] = [];
  if (creds.delhiveryToken) {
    try {
      await getJson('https://track.delhivery.com/c/api/pin-codes/json/?filter_codes=110001', { Authorization: `Token ${creds.delhiveryToken}` });
      out.push({ courier: 'Delhivery', ok: true, message: 'Delhivery accepted the token.' });
    } catch (e) {
      out.push({ courier: 'Delhivery', ok: false, message: `Delhivery did not accept the token (${e instanceof Error ? e.message : 'error'}).` });
    }
  }
  if (creds.shiprocketEmail && creds.shiprocketPassword) {
    try {
      shiprocketToken = null;
      const t = await shiprocketAuth(creds);
      out.push(t ? { courier: 'Shiprocket', ok: true, message: 'Shiprocket accepted the email and password.' } : { courier: 'Shiprocket', ok: false, message: 'Shiprocket did not return a login.' });
    } catch (e) {
      out.push({ courier: 'Shiprocket', ok: false, message: `Shiprocket did not accept the login (${e instanceof Error ? e.message : 'error'}).` });
    }
  }
  if (out.length === 0) out.push({ courier: 'None', ok: false, message: 'No delivery company keys are saved yet.' });
  return out;
}
