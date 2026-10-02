import type { Phrase } from './types';
import { UI } from './ui';
import { MEMBER } from './member';
import { PAGES } from './pages';
import { MISC } from './misc';

/**
 * Phrase lookup for the page translator (components/PageTranslator.tsx).
 *
 * The site has hundreds of strings spread across dozens of components, plus
 * copy an admin edits in the console. Threading a translation key through every
 * one of them would mean touching every file and still leaving every newly
 * edited sentence in English, so translation works the other way round: the
 * rendered text is matched, as a whole, against this table. A string that is
 * not in the table simply stays in English.
 *
 * Two kinds of entry:
 *   - plain text, matched exactly (after collapsing whitespace and straightening
 *     curly quotes);
 *   - text containing `{name}`-style tokens, matched as a pattern, with whatever
 *     the token matched carried across into the translation (`{n}` and `{m}`
 *     match numbers only, so a pattern like "{n} off" cannot swallow other text). This is how a
 *     sentence with a member's name or a rupee amount in it is handled.
 */
export type Lang = 'hi' | 'bn';

const norm = (s: string) => s.replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();

interface Template { re: RegExp; tokens: string[]; to: Record<Lang, string> }

let exact: Map<string, Record<Lang, string>> | null = null;
let templates: Template[] = [];

function build() {
  exact = new Map();
  templates = [];
  for (const [en, hi, bn] of [...UI, ...MEMBER, ...PAGES, ...MISC] as Phrase[]) {
    const key = norm(en);
    if (/\{\w+\}/.test(key)) {
      const tokens: string[] = [];
      const source = key
        .split(/(\{\w+\})/)
        .map((part) => {
          const m = /^\{(\w+)\}$/.exec(part);
          if (m) { tokens.push(m[1]); return m[1] === 'n' || m[1] === 'm' ? '([\\d,.+₹]+)' : '(.*?)'; }
          return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('');
      templates.push({ re: new RegExp(`^${source}$`), tokens, to: { hi, bn } });
    } else if (!exact.has(key)) {
      exact.set(key, { hi, bn });
    }
  }
}

/** The translation of a piece of rendered text, or null if there is none (so it stays as it is). */
export function translatePhrase(text: string, lang: Lang): string | null {
  if (!exact) build();
  const key = norm(text);
  if (!key) return null;
  const hit = exact!.get(key);
  if (hit) return hit[lang];
  for (const t of templates) {
    const m = t.re.exec(key);
    if (!m) continue;
    let out = t.to[lang];
    t.tokens.forEach((name, i) => {
      const captured = m[i + 1] ?? '';
      // `{x}` is itself phrase text (a category name inside a search hint), so
      // translate it too; names, numbers and amounts are carried across as-is.
      out = out.split(`{${name}}`).join(name === 'x' ? translatePhrase(captured, lang) ?? captured : captured);
    });
    return out;
  }
  return null;
}
