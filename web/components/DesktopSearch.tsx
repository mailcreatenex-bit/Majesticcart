'use client';

import { useState } from 'react';
import { SuggestPanel, useSuggestions } from './SearchSuggest';

/** The desktop header's search box, with suggestions as you type. Still a plain GET form, so it works before hydration. */
export function DesktopSearch() {
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const data = useSuggestions(value);

  return (
    <form
      action="/search"
      method="get"
      role="search"
      className="relative flex max-w-xs flex-1"
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false); }}
    >
      <label className="relative w-full">
        <span className="sr-only">Search</span>
        <input
          type="search"
          name="q"
          value={value}
          onChange={(e) => { setValue(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search products, brands…"
          autoComplete="off"
          className="w-full rounded-full border border-[var(--line-strong)] bg-[var(--page)] py-2 pl-4 pr-9 text-sm text-[var(--ink)] outline-none focus:border-[#B8862B]"
        />
        <button
          type="submit"
          aria-label="Search"
          className="absolute inset-y-0 right-1 flex items-center px-2 text-[var(--muted)] hover:text-[var(--ink)]"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </button>
      </label>
      {open && <SuggestPanel query={value} data={data} onPick={() => setOpen(false)} className="min-w-[22rem]" />}
    </form>
  );
}
