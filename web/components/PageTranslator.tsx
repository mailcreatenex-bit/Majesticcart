'use client';

import { useEffect } from 'react';
import { translatePhrase, type Lang } from '@/lib/phrases';

/**
 * Applies the chosen language to everything on the page — text, and the
 * placeholder / aria-label / title / alt attributes — by matching rendered
 * text against the phrase table (lib/phrases). Renders nothing itself.
 *
 * Pages are server-rendered in English and cached, so this runs in the browser
 * after load, and again whenever the page changes (a route change, a list that
 * loads, a panel that opens) via a MutationObserver. The original English is
 * remembered per node so switching back to English restores it exactly, and so
 * a node React later rewrites with fresh English is translated afresh rather
 * than trusted as already done.
 *
 * Skipped on purpose: anything inside `[data-no-translate]` or `translate="no"`
 * (brand names, user-entered text), scripts and styles, and form values.
 */
const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'] as const;
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'CODE', 'PRE', 'SVG']);

const textOriginal = new WeakMap<Text, string>();
const textApplied = new WeakMap<Text, string>();
const attrOriginal = new WeakMap<Element, Map<string, string>>();
const attrApplied = new WeakMap<Element, Map<string, string>>();

const skipped = (el: Element | null) => !!el && (SKIP.has(el.tagName.toUpperCase()) || !!el.closest('[data-no-translate],[translate="no"]'));

function leadTrail(s: string): [string, string] {
  return [/^\s*/.exec(s)![0], /\s*$/.exec(s)![0]];
}

function run(lang: Lang | null) {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    if (skipped(n.parentElement)) continue;
    const current = n.nodeValue ?? '';
    // The value is not what we last wrote: React (or something else) changed it, so it is a new original.
    if (textApplied.has(n) && textApplied.get(n) !== current) textOriginal.set(n, current);
    const original = textOriginal.get(n) ?? current;
    if (!lang) {
      if (textOriginal.has(n) && current !== original) { n.nodeValue = original; }
      textApplied.delete(n);
      continue;
    }
    const translated = translatePhrase(original, lang);
    if (translated === null) {
      if (textOriginal.has(n) && current !== original) n.nodeValue = original;
      continue;
    }
    const [lead, trail] = leadTrail(original);
    const next = lead + translated + trail;
    if (current !== next) {
      if (!textOriginal.has(n)) textOriginal.set(n, original);
      n.nodeValue = next;
    }
    textApplied.set(n, next);
  }

  for (const el of document.body.querySelectorAll<HTMLElement>(ATTRS.map((a) => `[${a}]`).join(','))) {
    if (skipped(el)) continue;
    const originals = attrOriginal.get(el) ?? new Map<string, string>();
    const applied = attrApplied.get(el) ?? new Map<string, string>();
    for (const a of ATTRS) {
      const current = el.getAttribute(a);
      if (current === null) continue;
      if (applied.has(a) && applied.get(a) !== current) originals.set(a, current);
      const original = originals.get(a) ?? current;
      if (!lang) {
        if (originals.has(a) && current !== original) el.setAttribute(a, original);
        applied.delete(a);
        continue;
      }
      const translated = translatePhrase(original, lang);
      if (translated === null) continue;
      if (!originals.has(a)) originals.set(a, original);
      if (current !== translated) el.setAttribute(a, translated);
      applied.set(a, translated);
    }
    attrOriginal.set(el, originals);
    attrApplied.set(el, applied);
  }
}

export function PageTranslator({ locale }: { locale: 'en' | Lang }) {
  useEffect(() => {
    const lang: Lang | null = locale === 'en' ? null : locale;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let observer: MutationObserver | undefined;

    const schedule = (delay: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        // Our own writes trigger the observer; pause it so a pass does not feed itself.
        observer?.disconnect();
        run(lang);
        observer?.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
      }, delay);
    };

    observer = new MutationObserver(() => schedule(60));
    // First pass a beat after mount so React has finished hydrating the regions
    // it is about to touch; rewriting text under a region still hydrating makes
    // React discard and rebuild it.
    schedule(lang ? 400 : 0);
    return () => {
      clearTimeout(timer);
      observer?.disconnect();
    };
  }, [locale]);

  return null;
}
