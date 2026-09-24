'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { LOCALES, LOCALE_HTML_LANG, LOCALE_NAME, isLocale, translate, type Locale, type TKey } from '@/lib/i18n';

/**
 * The visitor's language, applied in the browser.
 *
 * Every page is server-rendered in English and cached, so the first paint is
 * English. After load the saved choice (per device, in localStorage) is read and
 * the text swaps. Doing it this way keeps pages static and fast for everyone; the
 * cost is a brief English flash for someone who chose another language.
 */

const KEY = 'mc-locale';

interface Ctx { locale: Locale; setLocale: (l: Locale) => void }
const LocaleContext = createContext<Ctx>({ locale: 'en', setLocale: () => undefined });

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (isLocale(saved)) setLocaleState(saved);
    } catch { /* storage blocked: stay in English */ }
  }, []);

  useEffect(() => {
    document.documentElement.lang = LOCALE_HTML_LANG[locale];
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try { localStorage.setItem(KEY, l); } catch { /* nothing to do */ }
  }, []);

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export const useLocale = () => useContext(LocaleContext);

/** `useT()('nav.login')` in client components. */
export function useT() {
  const { locale } = useLocale();
  return useCallback((key: TKey) => translate(key, locale), [locale]);
}

/** `<T k="nav.login" />` in server components: English in the HTML, swapped after load. */
export function T({ k }: { k: TKey }) {
  const { locale } = useLocale();
  return <>{translate(k, locale)}</>;
}

export function LanguageSwitcher() {
  const { locale, setLocale } = useLocale();
  const t = useT();
  return (
    <label className="inline-flex items-center">
      <span className="sr-only">{t('lang.label')}</span>
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
        aria-label={t('lang.label')}
        className="cursor-pointer rounded-full border border-[var(--line-strong)] bg-transparent px-2 py-1.5 text-xs text-[var(--muted)] hover:text-[var(--ink)] focus:outline-none"
      >
        {LOCALES.map((l) => <option key={l} value={l} className="text-black">{LOCALE_NAME[l]}</option>)}
      </select>
    </label>
  );
}
