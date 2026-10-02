'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The phone header's search field, in the style of Purplle's app: a large
 * white rounded bar on the coloured header band, a search icon on the left,
 * a mic on the right behind a thin divider, and a placeholder that cycles
 * through example searches.
 *
 * The examples come from the live catalogue's own category names (passed in
 * by the header) rather than a hardcoded list, so they are always things the
 * shop actually sells.
 *
 * It is a plain GET form to /search, so it works before hydration. The mic is
 * progressive enhancement: it only renders where the browser has speech
 * recognition (Chrome/Edge/Safari on most phones) and submits the form with
 * whatever was heard.
 */

interface RecognitionResult { 0: { transcript: string } }
interface RecognitionEvent { results: ArrayLike<RecognitionResult> }
interface Recognition {
  lang: string;
  interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

export function MobileSearchBar({ suggestions }: { suggestions: string[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<Recognition | null>(null);
  const [tick, setTick] = useState(0);
  const [canSpeak, setCanSpeak] = useState(false);
  const [listening, setListening] = useState(false);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
    setCanSpeak(Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition));
  }, []);

  useEffect(() => {
    if (suggestions.length < 2 || focused) return;
    const id = setInterval(() => setTick((n) => n + 1), 2600);
    return () => clearInterval(id);
  }, [suggestions.length, focused]);

  const placeholder = suggestions.length
    ? `Search "${suggestions[tick % suggestions.length]}"`
    : 'Search products, brands…';

  const listen = () => {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = 'en-IN';
    rec.interimResults = false;
    rec.onresult = (e) => {
      const heard = e.results[0]?.[0]?.transcript?.trim();
      if (heard && inputRef.current) {
        inputRef.current.value = heard;
        formRef.current?.requestSubmit();
      }
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  };

  return (
    <form ref={formRef} action="/search" method="get" role="search" className="px-4">
      <div className="flex h-12 items-center rounded-2xl bg-white pl-3.5 pr-1.5 shadow-sm ring-1 ring-black/5">
        <button type="submit" aria-label="Search" className="shrink-0 text-[var(--ink)]">
          <SearchGlyph />
        </button>
        <input
          ref={inputRef}
          type="search"
          name="q"
          aria-label="Search products and brands"
          placeholder={placeholder}
          autoComplete="off"
          enterKeyHint="search"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="mx-3 min-w-0 flex-1 bg-transparent text-[15px] text-[var(--ink)] outline-none placeholder:text-[var(--muted)] [&::-webkit-search-cancel-button]:hidden"
        />
        {canSpeak && (
          <>
            <span aria-hidden="true" className="h-6 w-px bg-[var(--line-strong)]" />
            <button
              type="button"
              onClick={listen}
              aria-label={listening ? 'Stop listening' : 'Search by voice'}
              aria-pressed={listening}
              className={`ml-1 inline-flex h-9 w-10 shrink-0 items-center justify-center rounded-xl ${listening ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'text-[var(--ink)]'}`}
            >
              <MicGlyph />
            </button>
          </>
        )}
      </div>
    </form>
  );
}

function SearchGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function MicGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="12" rx="3" fill="currentColor" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}
