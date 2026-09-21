import { Injectable, Logger } from '@nestjs/common';
import puppeteer from 'puppeteer';

/**
 * Live operator plan browsing.
 *
 * There is no public API for "what plans does Jio/Airtel/Vi/BSNL sell right
 * now" — recharge aggregators that offer one require a merchant account we
 * don't have here. This instead renders each operator's own public plans
 * page in a headless browser and reads the same numbers a visitor would see,
 * which is the only data source that needs no account and stays current
 * without us maintaining it by hand.
 *
 * That also makes it the fragile option: a redesign of any of these four
 * pages can silently break its parser here. Every scrape is therefore
 * best-effort — a failure serves the last good result if there is one, and
 * an empty list otherwise, so the member always still has the plain amount
 * field in MobileRechargeView as a fallback rather than a broken screen.
 */

export type PlanOperator = 'JIO' | 'AIRTEL' | 'VI' | 'BSNL';

export interface RechargePlan {
  amountPaise: number;
  validity: string;
  data: string;
}

interface CacheEntry {
  plans: RechargePlan[];
  fetchedAt: number;
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const TTL_MS = 12 * 60 * 60 * 1000; // 12 hours — plans don't change hour to hour, and every refresh costs a real page load.
const NAV_TIMEOUT_MS = 30_000;
const MAX_PLANS = 12;

@Injectable()
export class RechargePlansService {
  private readonly logger = new Logger(RechargePlansService.name);
  private readonly cache = new Map<PlanOperator, CacheEntry>();
  private readonly inFlight = new Map<PlanOperator, Promise<RechargePlan[]>>();

  async getPlans(operator: PlanOperator): Promise<RechargePlan[]> {
    const cached = this.cache.get(operator);
    if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached.plans;

    // Two members opening the recharge page in the same minute must not
    // launch two browsers for the same operator — the second one waits on
    // the first's result instead.
    const pending = this.inFlight.get(operator);
    if (pending) return pending;

    const task = this.scrape(operator)
      .then((plans) => {
        if (plans.length > 0) this.cache.set(operator, { plans, fetchedAt: Date.now() });
        return plans.length > 0 ? plans : (cached?.plans ?? []);
      })
      .catch((err) => {
        this.logger.warn(`Plan scrape failed for ${operator}: ${(err as Error).message}`);
        return cached?.plans ?? [];
      })
      .finally(() => this.inFlight.delete(operator));

    this.inFlight.set(operator, task);
    return task;
  }

  private async scrape(operator: PlanOperator): Promise<RechargePlan[]> {
    switch (operator) {
      case 'JIO':
        // The heaviest of the four SPAs — plan cards mount noticeably later
        // than Airtel's or Vi's, so this one gets a longer settle time.
        return this.withPage('https://www.jio.com/selfcare/plans/mobility/prepaid-plans-home/', parseJio, 4500);
      case 'AIRTEL':
        return this.scrapeAirtel();
      case 'VI':
        return this.withPage('https://www.myvi.in/prepaid/best-prepaid-plans', parseVi);
      case 'BSNL':
        return this.withPage('https://www.bsnl.co.in/opencms/bsnl/BSNL/services/mobile/prepaid_plans.html', parseBsnl);
    }
  }

  /** Text-based operators: render, read `body.innerText`, hand the raw text to a parser. */
  private async withPage(url: string, parse: (text: string) => RechargePlan[], settleMs = 2500): Promise<RechargePlan[]> {
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.setUserAgent(USER_AGENT);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      await new Promise((r) => setTimeout(r, settleMs)); // client-rendered plan lists finish mounting after this
      const text: string = await page.evaluate(() => (globalThis as any).document.body.innerText);
      return dedupeAndCap(parse(text));
    } finally {
      await browser.close();
    }
  }

  /**
   * Airtel repeats each plan's price as the visible label of its own "Buy"
   * button, so a plain price-then-price regex over the page text pairs a
   * card with its neighbour half the time. Anchoring on the DOM element that
   * is the price *heading* (excluding the one inside a `<button>`) and
   * walking up to its own "Additional Benefit(s)" ancestor keeps each card's
   * text isolated before any text parsing happens.
   */
  private async scrapeAirtel(): Promise<RechargePlan[]> {
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.setUserAgent(USER_AGENT);
      await page.goto('https://www.airtel.in/recharge-online/', { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      await new Promise((r) => setTimeout(r, 2500));
      // This callback runs in the page's own browser context, not Node — it
      // has no access to this project's tsconfig `lib`, so DOM globals are
      // typed `any` here rather than pulled in as real TS DOM types.
      const cardTexts: string[] = await page.evaluate(() => {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const doc: any = (globalThis as any).document;
        const priceEls = Array.from(doc.querySelectorAll('*')).filter(
          (el: any) => el.children.length === 0 && /^₹\d{2,5}$/.test((el.textContent || '').trim()) && !el.closest('button'),
        );
        const out: string[] = [];
        for (const el of priceEls as any[]) {
          let node: any = el.parentElement;
          let best: any = null;
          for (let i = 0; i < 10 && node; i++, node = node.parentElement) {
            if (/Additional Benefit/i.test(node.textContent || '') && (node.textContent || '').length < 700) best = node;
          }
          if (best) out.push((best.textContent || '').replace(/\s+/g, ' ').trim());
        }
        return out;
        /* eslint-enable @typescript-eslint/no-explicit-any */
      });
      return dedupeAndCap(cardTexts.map(parseAirtelCard).filter((p): p is RechargePlan => p !== null));
    } finally {
      await browser.close();
    }
  }
}

function parseJio(text: string): RechargePlan[] {
  const re = /₹(\d{2,5})\n([\s\S]*?)\+\d+\s*more/gi;
  const out: RechargePlan[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const amountRupees = Number(m[1]);
    if (amountRupees < 10 || amountRupees > 5000) continue;
    const block = m[2];
    // Jio's own label order is "Validity\n365 Days", not "365 Days\nvalidity".
    const validityMatch = block.match(/validity\s*\n\s*(\d+\.?\d*\s*(?:Days?|Months?))/i);
    if (!validityMatch) continue;
    const dataLabelMatch = block.match(/\bData\b\s*\n([\s\S]*)/i);
    const data = dataLabelMatch ? dataLabelMatch[1].replace(/\n/g, ' ').trim() : '';
    out.push({ amountPaise: amountRupees * 100, validity: validityMatch[1].trim(), data });
  }
  return out;
}

function parseAirtelCard(card: string): RechargePlan | null {
  const priceMatch = card.match(/^₹(\d{2,5})/);
  const validityMatch = card.match(/(\d+\.?\d*\s*(?:Days?|Months?|MONTH))\s*validity/i);
  if (!priceMatch || !validityMatch) return null;
  const amountRupees = Number(priceMatch[1]);
  if (amountRupees < 10 || amountRupees > 5000) return null;
  const validityIdx = card.indexOf(validityMatch[0]);
  // Airtel's own DOM has no whitespace between adjacent elements' text (e.g.
  // "...Calls2GBdata"), since `.textContent` on the card's container just
  // concatenates them — this reinserts a space at the two boundaries that
  // pattern actually produces.
  const data = card
    .slice(priceMatch[0].length, validityIdx)
    .replace(/Calls(?=[A-Z0-9])/, 'Calls ')
    .replace(/(GB|MB)(?=data)/i, '$1 ')
    .trim();
  return { amountPaise: amountRupees * 100, validity: validityMatch[1].trim(), data };
}

function parseVi(text: string): RechargePlan[] {
  const re = /₹\s*\n+(\d{2,5})\s*\n+((?:unlimited|[\d.]+\s*(?:GB|MB)))\s*\n+data\s*\n+(\d+)\s*\n+days\s*\n+validity/gi;
  const out: RechargePlan[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const amountRupees = Number(m[1]);
    if (amountRupees < 10 || amountRupees > 5000) continue;
    out.push({ amountPaise: amountRupees * 100, validity: `${m[3]} Days`, data: m[2].trim() });
  }
  return out;
}

function parseBsnl(text: string): RechargePlan[] {
  const re = /₹(\d{2,5})\s*\nVALIDITY:\s*(\d+)\s*DAYS\s*\n\s*\n([^\n]+)/gi;
  const out: RechargePlan[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const amountRupees = Number(m[1]);
    if (amountRupees < 10 || amountRupees > 5000) continue;
    out.push({ amountPaise: amountRupees * 100, validity: `${m[2]} Days`, data: m[3].trim().slice(0, 140) });
  }
  return out;
}

function dedupeAndCap(plans: RechargePlan[]): RechargePlan[] {
  const seen = new Set<number>();
  const out: RechargePlan[] = [];
  for (const p of plans.sort((a, b) => a.amountPaise - b.amountPaise)) {
    if (seen.has(p.amountPaise)) continue;
    seen.add(p.amountPaise);
    out.push(p);
    if (out.length >= MAX_PLANS) break;
  }
  return out;
}
