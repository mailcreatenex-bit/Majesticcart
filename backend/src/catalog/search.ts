/**
 * Product search that forgives.
 *
 * What a shopper types is rarely what the catalogue says: "lipstik", "face
 * wash" for "Facewash", "kajal" in Devanagari, "सनस्क्रीन" for "Sun Shield Gel".
 * A SQL `contains` finds none of those. The catalogue is a few hundred rows, so
 * the whole thing is held in memory and scored in JavaScript, which keeps the
 * rules in one readable, unit-tested place instead of a database extension.
 *
 *   • every typed word must be found (so "red lipstick" does not return every
 *     red thing and every lipstick), but a word can be found as itself, as a
 *     prefix of a catalogue word ("lip" → "lipstick"), as a near-miss spelling
 *     (one slip for words of 4–7 letters, two for longer), or through the
 *     synonym table below, which carries the Hindi, Bengali and Hinglish names;
 *   • the name counts most, then brand and category, then SKU, then description;
 *   • this is pure: no database, no clock. `SearchIndex.build()` takes rows.
 */

/** Words that mean the same product, in English, Hinglish, Hindi and Bengali. First entry is the canonical English. */
export const SYNONYMS: string[][] = [
  ['lipstick', 'lipstik', 'lip stick', 'lip colour', 'lip color', 'लिपस्टिक', 'लिप स्टिक', 'লিপস্টিক', 'লিপ স্টিক'],
  ['kajal', 'kohl', 'kaajal', 'काजल', 'কাজল'],
  ['foundation', 'फाउंडेशन', 'फाउन्डेशन', 'ফাউন্ডেশন'],
  ['compact', 'compact powder', 'face powder', 'powder', 'कॉम्पैक्ट', 'पाउडर', 'কমপ্যাক্ট', 'পাউডার'],
  ['makeup', 'make up', 'cosmetics', 'मेकअप', 'मेक अप', 'कॉस्मेटिक्स', 'মেকআপ', 'মেক আপ', 'প্রসাধনী'],
  ['skin care', 'skincare', 'skin', 'त्वचा', 'स्किन केयर', 'स्किनकेयर', 'ত্বক', 'স্কিন কেয়ার', 'স্কিনকেয়ার'],
  ['body care', 'bodycare', 'body', 'बॉडी केयर', 'बॉडी', 'বডি কেয়ার', 'বডি'],
  ['hair care', 'haircare', 'hair', 'बाल', 'हेयर केयर', 'हेयर', 'চুল', 'হেয়ার কেয়ার', 'হেয়ার'],
  ['fragrance', 'perfume', 'scent', 'attar', 'इत्र', 'परफ्यूम', 'सुगंध', 'फ्रेगरेंस', 'ফ্র্যাগরেন্স', 'পারফিউম', 'আতর', 'সুগন্ধি'],
  ['serum', 'सीरम', 'সিরাম'],
  ['cream', 'creme', 'क्रीम', 'ক্রিম'],
  ['moisturiser', 'moisturizer', 'moisturising', 'moisturizing', 'मॉइस्चराइज़र', 'मॉइस्चराइजर', 'ময়েশ্চারাইজার'],
  ['lotion', 'लोशन', 'লোশন'],
  ['butter', 'body butter', 'बटर', 'বাটার'],
  ['sunscreen', 'sun screen', 'sun block', 'sunblock', 'sun shield', 'सनस्क्रीन', 'सन स्क्रीन', 'सनब्लॉक', 'সানস্ক্রিন', 'সান স্ক্রিন'],
  ['face wash', 'facewash', 'cleanser', 'फेस वॉश', 'फेसवॉश', 'क्लींज़र', 'ফেস ওয়াশ', 'ফেসওয়াশ', 'ক্লেনজার'],
  ['gel', 'जेल', 'জেল'],
  ['aloe', 'aloe vera', 'एलोवेरा', 'एलो', 'অ্যালো', 'অ্যালোভেরা'],
  ['mist', 'body mist', 'spray', 'मिस्ट', 'স্প্রে', 'মিস্ট'],
  ['shampoo', 'शैम्पू', 'शैंपू', 'শ্যাম্পু'],
  ['conditioner', 'कंडीशनर', 'কন্ডিশনার'],
  ['hair oil', 'oil', 'तेल', 'हेयर ऑयल', 'ऑयल', 'তেল', 'হেয়ার অয়েল'],
  ['soap', 'साबुन', 'সাবান'],
  ['vitamin c', 'vit c', 'विटामिन सी', 'ভিটামিন সি'],
  ['saffron', 'kesar', 'केसर', 'জাফরান', 'কেশর'],
  ['rose', 'gulab', 'गुलाब', 'গোলাপ'],
  ['jasmine', 'mogra', 'chameli', 'चमेली', 'मोगरा', 'জুঁই', 'বেলি', 'মোগরা'],
  ['lotus', 'kamal', 'कमल', 'পদ্ম'],
  ['glow', 'brightening', 'radiance', 'चमक', 'ग्लो', 'গ্লো', 'উজ্জ্বল'],
  ['night', 'रात', 'নাইট', 'রাত'],
  ['day cream', 'day', 'दिन'],
  ['matte', 'मैट', 'ম্যাট'],
  ['eye', 'eyes', 'आँख', 'आंख', 'आई', 'চোখ', 'আই'],
  ['nail', 'nail polish', 'नेल', 'नेल पॉलिश', 'নেইল', 'নেইল পলিশ'],
  ['lip care', 'lip balm', 'balm', 'लिप बाम', 'বাম', 'লিপ বাম'],
  ['dry skin', 'dry', 'रूखी त्वचा', 'रूखी', 'শুষ্ক'],
  ['shade', 'shades', 'tone', 'शेड', 'শেড'],
];

// Normalising ------------------------------------------------------------

/** Lower case, one script-insensitive spelling for the marks that vary, no punctuation. */
export function normalise(s: string): string {
  return s
    .normalize('NFC')
    .toLowerCase()
    .replace(/[‌‍]/g, '') // zero-width joiners
    .replace(/़/g, '') // devanagari nukta: क़ → क
    .replace(/ँ/g, 'ं') // chandrabindu → anusvara
    .replace(/়/g, '') // bengali nukta
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim();
}

export function words(s: string): string[] {
  const n = normalise(s);
  return n ? n.split(' ') : [];
}

/** Edits allowed in a word of this length. Short words get none: one slip in "gel" is a different word. */
export function allowedEdits(len: number): number {
  return len <= 3 ? 0 : len <= 7 ? 1 : 2;
}

/** Optimal-string-alignment distance (insert, delete, substitute, swap neighbours), bailing out past `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2 = new Array<number>(b.length + 1).fill(0);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let cur = new Array<number>(b.length + 1).fill(0);
  let p2 = prev2;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, p2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    p2 = prev;
    prev = cur;
    cur = new Array<number>(b.length + 1).fill(0);
  }
  return prev[b.length];
}

// The synonym table, indexed -----------------------------------------------

interface Group { variants: string[][] } // each variant is a list of words that must all be present

const GROUPS: Group[] = SYNONYMS.map((g) => ({ variants: g.map((v) => words(v)).filter((w) => w.length) }));
/** "face wash" → group index, keyed by the normalised phrase. */
const PHRASE_TO_GROUP = new Map<string, number>();
GROUPS.forEach((g, i) => g.variants.forEach((v) => { if (!PHRASE_TO_GROUP.has(v.join(' '))) PHRASE_TO_GROUP.set(v.join(' '), i); }));
const LATIN_SINGLES = [...PHRASE_TO_GROUP.keys()].filter((k) => /^[a-z]{5,}$/.test(k));

/** The group a typed phrase belongs to — exactly, or (for a Latin word of 5+ letters) one slip away. */
function groupFor(phrase: string): number | null {
  const hit = PHRASE_TO_GROUP.get(phrase);
  if (hit !== undefined) return hit;
  if (/^[a-z]{5,}$/.test(phrase)) {
    const max = allowedEdits(phrase.length);
    for (const k of LATIN_SINGLES) if (editDistance(phrase, k, max) <= max) return PHRASE_TO_GROUP.get(k)!;
  }
  return null;
}

// The index ------------------------------------------------------------------

export interface SearchRow {
  id: string;
  name: string;
  sku: string;
  description: string | null;
  sold: number;
  brand: string | null;
  category: string | null;
  parentCategory: string | null;
}

interface Doc {
  id: string;
  sold: number;
  /** [weight, words, allowFuzzy] */
  fields: [number, string[], boolean][];
}

const W_NAME = 5;
const W_TAXON = 3; // brand and category
const W_SKU = 1.5;
const W_DESC = 1;

/** How well one typed word matches one catalogue word, 0 for not at all. */
function wordScore(q: string, w: string, fuzzy: boolean): number {
  if (q === w) return 1;
  if (q.length >= 2 && w.startsWith(q)) return 0.85;
  // A plural or "-es" on what was typed: "serums", "lotions".
  if (w.length >= 4 && q.length - w.length >= 1 && q.length - w.length <= 2 && q.startsWith(w)) return 0.8;
  if (q.length >= 4 && w.length >= 4 && w.includes(q)) return 0.5;
  if (fuzzy && q.length >= 4) {
    const max = allowedEdits(q.length);
    if (max > 0 && editDistance(q, w, max) <= max) return 0.6;
  }
  return 0;
}

export interface SearchResult {
  ids: string[];
  /** The query with misspelt words fixed, when that differs from what was typed. */
  didYouMean: string | null;
}

export class SearchIndex {
  private constructor(private readonly docs: Doc[], private readonly vocab: string[]) {}

  static build(rows: SearchRow[]): SearchIndex {
    const vocab = new Set<string>();
    const docs = rows.map((r): Doc => {
      const fields: Doc['fields'] = [
        [W_NAME, words(r.name), true],
        [W_TAXON, [...words(r.brand ?? ''), ...words(r.category ?? ''), ...words(r.parentCategory ?? '')], true],
        [W_SKU, words(r.sku), false],
        [W_DESC, words(r.description ?? ''), false],
      ];
      for (const f of fields.slice(0, 2)) f[1].forEach((w) => w.length >= 4 && vocab.add(w));
      return { id: r.id, sold: r.sold, fields };
    });
    return new SearchIndex(docs, [...vocab]);
  }

  /** The best score of an alternative (all its words must be present) against a doc, 0 if any is missing. */
  private altScore(alt: string[], doc: Doc): number {
    let total = 0;
    for (const q of alt) {
      let best = 0;
      for (const [weight, ws, fuzzy] of doc.fields) {
        for (const w of ws) {
          const s = wordScore(q, w, fuzzy);
          if (s > 0 && s * weight > best) best = s * weight;
        }
      }
      if (best === 0) return 0;
      total += best;
    }
    return total / alt.length;
  }

  /**
   * Break the query into terms. A run of words that is a known synonym phrase
   * ("face wash", "लिपस्टिक") becomes one term with every spelling of it as an
   * alternative; any other word is a term of its own.
   */
  private terms(query: string): string[][][] {
    const ws = words(query);
    const out: string[][][] = [];
    for (let i = 0; i < ws.length; ) {
      let took = 0;
      for (let n = Math.min(3, ws.length - i); n >= 1 && !took; n--) {
        const g = groupFor(ws.slice(i, i + n).join(' '));
        if (g !== null) {
          // The typed form first, then every spelling in the group.
          out.push([ws.slice(i, i + n), ...GROUPS[g].variants]);
          took = n;
        }
      }
      if (!took) out.push([[ws[i]]]);
      i += took || 1;
    }
    return out;
  }

  search(query: string): SearchResult {
    const terms = this.terms(query);
    if (terms.length === 0) return { ids: [], didYouMean: null };

    const scored: { id: string; score: number; sold: number }[] = [];
    for (const doc of this.docs) {
      let total = 0;
      for (const term of terms) {
        let best = 0;
        for (const alt of term) best = Math.max(best, this.altScore(alt, doc));
        if (best === 0) { total = 0; break; }
        total += best;
      }
      if (total > 0) scored.push({ id: doc.id, score: total, sold: doc.sold });
    }
    scored.sort((a, b) => b.score - a.score || b.sold - a.sold);
    return { ids: scored.map((s) => s.id), didYouMean: this.correction(query) };
  }

  /** "lipstik red" → "lipstick red": each word not found as typed, replaced by its nearest catalogue word. */
  private correction(query: string): string | null {
    const ws = words(query);
    let changed = false;
    const fixed = ws.map((w) => {
      if (w.length < 4 || !/^[a-z]+$/.test(w)) return w;
      if (groupFor(w) !== null && PHRASE_TO_GROUP.has(w)) return w;
      let exact = false;
      let best: string | null = null;
      let bestD = allowedEdits(w.length) + 1;
      for (const v of this.vocab) {
        if (v === w || v.startsWith(w)) { exact = true; break; }
        const d = editDistance(w, v, allowedEdits(w.length));
        if (d < bestD) { bestD = d; best = v; }
      }
      if (exact || !best) return w;
      changed = true;
      return best;
    });
    return changed ? fixed.join(' ') : null;
  }
}
