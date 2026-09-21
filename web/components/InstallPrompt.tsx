'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  detectPlatform, installMethod, installCopy, shouldShowPrompt,
  readPromptState, writePromptState, withDismissal, withInstall,
  type InstallMethod, type Platform, type PromptState, EMPTY_PROMPT_STATE,
} from '@/lib/pwa';
import { ensureInstallCapture } from './PwaRegister';

const ENGAGEMENT_THRESHOLD_MS = 30_000;

/**
 * Everything the install UI needs.
 *
 * Deliberately returns `method: null` until mounted. Rendering an install
 * button during SSR would flash the wrong copy on every load — iOS instructions
 * to an Android user, or an install button to someone already running the
 * installed app.
 */
export function useInstallState() {
  const [method, setMethod] = useState<InstallMethod | null>(null);
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [state, setState] = useState<PromptState>(EMPTY_PROMPT_STATE);

  const evaluate = useCallback(() => {
    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      // iOS Safari's own flag; it does not support the display-mode query.
      (window.navigator as { standalone?: boolean }).standalone === true ||
      document.referrer.startsWith('android-app://');

    const p = detectPlatform(navigator.userAgent, standalone);
    const hasNative = !!window.__mcInstall?.event;
    setPlatform(p);
    setMethod(window.__mcInstall?.installed ? 'installed' : installMethod(p, hasNative));
  }, []);

  useEffect(() => {
    // Wires the capture if the inline script has not run yet, and is a no-op
    // if it has. Either way the listener exists from this point on, so the
    // event cannot be missed regardless of which ran first.
    ensureInstallCapture();

    setState(readPromptState(window.localStorage));
    evaluate();

    // The event may arrive after mount on a slow connection, so re-evaluate
    // rather than assuming the first read was final.
    const onAvailable = () => evaluate();
    const onInstalled = () => {
      setState((prev) => {
        const next = withInstall(prev);
        writePromptState(window.localStorage, next);
        return next;
      });
      evaluate();
    };

    window.addEventListener('mc-install-available', onAvailable);
    window.addEventListener('mc-install-done', onInstalled);

    // Catches the case where the app is launched from the home screen in an
    // already-open tab.
    const mq = window.matchMedia?.('(display-mode: standalone)');
    mq?.addEventListener?.('change', onAvailable);

    return () => {
      window.removeEventListener('mc-install-available', onAvailable);
      window.removeEventListener('mc-install-done', onInstalled);
      mq?.removeEventListener?.('change', onAvailable);
    };
  }, [evaluate]);

  /**
   * Fire the native prompt.
   *
   * The event is single-use: once prompted, it is spent and the browser will
   * not hand over another until it decides to. So it is cleared either way,
   * and the UI falls back to instructions.
   */
  const promptInstall = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    const evt = window.__mcInstall?.event;
    if (!evt) return 'unavailable';
    try {
      await evt.prompt();
      const { outcome } = await evt.userChoice;
      if (window.__mcInstall) window.__mcInstall.event = null;
      evaluate();
      return outcome;
    } catch {
      if (window.__mcInstall) window.__mcInstall.event = null;
      evaluate();
      return 'unavailable';
    }
  }, [evaluate]);

  const dismiss = useCallback(() => {
    setState((prev) => {
      const next = withDismissal(prev);
      writePromptState(window.localStorage, next);
      return next;
    });
  }, []);

  return { method, platform, state, promptInstall, dismiss };
}

/**
 * Time the page has actually been VISIBLE.
 *
 * Not wall-clock time since load. A tab left open in the background for a
 * minute is not someone browsing the site, and popping a dialog at them the
 * moment they switch back is exactly the behaviour that gets a prompt
 * dismissed with prejudice.
 */
function useEngagementMs(targetMs: number): number {
  const [engaged, setEngaged] = useState(0);
  const accumulated = useRef(0);
  const since = useRef<number | null>(null);

  useEffect(() => {
    if (document.visibilityState === 'visible') since.current = Date.now();

    const flush = () => {
      if (since.current !== null) {
        accumulated.current += Date.now() - since.current;
        since.current = null;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') since.current = Date.now();
      else {
        flush();
        setEngaged(accumulated.current);
      }
    };

    const tick = window.setInterval(() => {
      const live = accumulated.current + (since.current ? Date.now() - since.current : 0);
      setEngaged(live);
      if (live >= targetMs) window.clearInterval(tick);
    }, 1000);

    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(tick);
    };
  }, [targetMs]);

  return engaged;
}

/* --------------------------------------------------------------- button */

/**
 * The explicit install control, for the header or footer.
 *
 * Renders nothing when there is nothing to offer — already installed, or a
 * browser we cannot help. A dead button is worse than no button.
 */
export function InstallButton({
  className,
  variant = 'default',
}: {
  className?: string;
  /** 'header' is the compact form: it has to survive a 16px-tall nav row next
      to Bag and Log in, so the label collapses to an icon under `sm`. */
  variant?: 'default' | 'header';
}) {
  const { method, platform, promptInstall } = useInstallState();
  const [sheetOpen, setSheetOpen] = useState(false);

  if (!method || !platform || method === 'installed' || method === 'browser-menu') return null;

  const onClick = async () => {
    if (method === 'native') {
      const outcome = await promptInstall();
      // If the browser refused to show it, fall back to instructions rather
      // than leaving the click with no visible result.
      if (outcome === 'unavailable') setSheetOpen(true);
      return;
    }
    setSheetOpen(true);
  };

  const styles = className ?? (variant === 'header'
    ? 'inline-flex items-center gap-1.5 rounded-full border border-[var(--line-strong)] px-3 py-2 text-sm font-semibold text-[var(--accent)] hover:bg-[var(--surface-tint)]'
    : 'inline-flex items-center gap-2 rounded-xl border border-[var(--line-strong)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-tint)]');

  return (
    <>
      <button type="button" onClick={onClick} className={styles} aria-label="Install the Majestic Cart app">
        <DownloadIcon />
        {variant === 'header' ? <span className="hidden sm:inline">Get the app</span> : 'Get the app'}
      </button>
      {sheetOpen && <InstallSheet method={method} platform={platform} onClose={() => setSheetOpen(false)} />}
    </>
  );
}

/* ---------------------------------------------------------------- popup */

/**
 * The timed popup.
 *
 * Shown once the visitor has spent 30 seconds actually looking at the site, and
 * never to someone who has it installed or has said no recently.
 */
export function InstallPromptPopup() {
  const { method, platform, state, promptInstall, dismiss } = useInstallState();
  const engagedMs = useEngagementMs(ENGAGEMENT_THRESHOLD_MS);
  const [open, setOpen] = useState(false);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    if (closed || open || !method) return;
    const decision = shouldShowPrompt({ state, method, engagedMs, thresholdMs: ENGAGEMENT_THRESHOLD_MS });
    if (decision.show) setOpen(true);
  }, [closed, open, method, state, engagedMs]);

  if (!open || !method || !platform) return null;

  const close = (recordDismissal: boolean) => {
    if (recordDismissal) dismiss();
    setOpen(false);
    setClosed(true);
  };

  const onInstall = async () => {
    if (method === 'native') {
      const outcome = await promptInstall();
      // "dismissed" on the browser's own dialog is a real no, so it counts
      // towards the cooldown. Accepting closes it without one.
      close(outcome === 'dismissed');
      return;
    }
    // Manual routes keep the sheet open so the steps stay readable.
  };

  return (
    <InstallSheet
      method={method}
      platform={platform}
      onClose={() => close(true)}
      onInstall={method === 'native' ? onInstall : undefined}
      timed
    />
  );
}

/* ---------------------------------------------------------------- sheet */

function InstallSheet({
  method, platform, onClose, onInstall, timed,
}: {
  method: InstallMethod;
  platform: Platform;
  onClose: () => void;
  onInstall?: () => void;
  timed?: boolean;
}) {
  const copy = installCopy(method, platform);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="install-title"
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-[#250E10]/50"
        onClick={onClose}
      />

      <div className="relative w-full max-w-md rounded-t-3xl bg-[var(--surface)] p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl sm:pb-6">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent-soft)]">
            <DownloadIcon className="h-6 w-6 text-[var(--accent)]" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="install-title" className="font-serif text-lg leading-tight text-[var(--ink)]">
              {copy.title}
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-[var(--body)]">{copy.body}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--surface-tint)]"
          >
            <CloseIcon />
          </button>
        </div>

        {copy.steps && (
          <ol className="mt-4 space-y-2 rounded-2xl bg-[var(--page)] p-4">
            {copy.steps.map((step, i) => (
              <li key={i} className="flex gap-3 text-sm text-[var(--body)]">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--ink)] text-[11px] font-semibold text-[var(--gold-pale)]">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        )}

        <div className="mt-5 flex gap-2">
          {method === 'native' && onInstall && (
            <button
              type="button"
              onClick={onInstall}
              className="flex-1 rounded-xl gold-foil px-5 py-3 font-semibold text-white shadow-lg shadow-amber-900/20"
            >
              {copy.cta ?? 'Install'}
            </button>
          )}
          {method === 'in-app-browser' && (
            <button
              type="button"
              onClick={copyLink}
              className="flex-1 rounded-xl bg-[var(--ink)] px-5 py-3 font-semibold text-[var(--gold-pale)]"
            >
              {copied ? 'Link copied' : 'Copy link'}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[var(--line-strong)] px-5 py-3 text-sm font-semibold text-[var(--body)] hover:bg-[var(--surface-tint)]"
          >
            {timed ? 'Not now' : 'Close'}
          </button>
        </div>

        {timed && (
          <p className="mt-3 text-center text-xs text-[var(--muted)]">
            We will not ask again for a week.
          </p>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- icons */

function DownloadIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
