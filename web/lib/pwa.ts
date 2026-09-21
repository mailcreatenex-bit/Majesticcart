/**
 * Progressive Web App install logic.
 *
 * Pure functions, no DOM access, so the awkward parts — which browsers can
 * actually install, and when it is reasonable to ask — are testable without a
 * browser. The React components read state from here; they decide nothing
 * themselves.
 *
 * ── The three cases people get wrong ─────────────────────────────────────
 *
 * 1. `beforeinstallprompt` fires BEFORE React hydrates. If it is not captured
 *    in a script that runs in <head>, the event is gone and the install button
 *    silently does nothing forever. See PwaRegister.
 *
 * 2. iOS Safari has no install API at all. The only route is Share → Add to
 *    Home Screen, so it needs instructions, not a button that cannot work.
 *
 * 3. In-app browsers — WhatsApp, Instagram, Facebook — CANNOT install a PWA.
 *    That matters more here than on most sites: this platform's traffic comes
 *    from members sharing referral links on WhatsApp, so the in-app browser is
 *    the common case, not the edge case. Showing a normal install button there
 *    produces a button that does nothing.
 * ─────────────────────────────────────────────────────────────────────────
 */

export type InstallMethod =
  /** Chrome, Edge, Samsung Internet, Android: the browser gives us a prompt. */
  | 'native'
  /** iOS Safari: no API. Show the Share → Add to Home Screen steps. */
  | 'ios-manual'
  /** WhatsApp, Instagram and friends: cannot install. Offer "open in browser". */
  | 'in-app-browser'
  /** Firefox and anything else: installable by menu, but we cannot drive it. */
  | 'browser-menu'
  /** Already running as an installed app. Nothing to offer. */
  | 'installed';

export interface Platform {
  os: 'ios' | 'android' | 'desktop' | 'unknown';
  browser: 'safari' | 'chrome' | 'edge' | 'firefox' | 'samsung' | 'other';
  /** WhatsApp, Instagram, Facebook, Line and similar embedded webviews. */
  inAppBrowser: string | null;
  isStandalone: boolean;
}

/**
 * Identify the browser from a user-agent string.
 *
 * Order matters throughout: Edge's UA contains "Chrome", Chrome's contains
 * "Safari", and every in-app browser pretends to be one of them. Each check
 * therefore has to come before the thing it impersonates.
 */
export function detectPlatform(userAgent: string, isStandalone = false): Platform {
  const ua = userAgent ?? '';
  const lower = ua.toLowerCase();

  // In-app browsers first: they impersonate Safari or Chrome, so a later check
  // would swallow them.
  let inAppBrowser: string | null = null;
  if (/\bfban|\bfbav|\bfb_iab/i.test(ua)) inAppBrowser = 'Facebook';
  else if (/instagram/i.test(ua)) inAppBrowser = 'Instagram';
  // WhatsApp's Android webview does not always say "WhatsApp"; wv marks a webview.
  else if (/whatsapp/i.test(ua)) inAppBrowser = 'WhatsApp';
  else if (/\bline\//i.test(ua)) inAppBrowser = 'LINE';
  else if (/micromessenger/i.test(ua)) inAppBrowser = 'WeChat';
  else if (/snapchat/i.test(ua)) inAppBrowser = 'Snapchat';
  else if (/twitter|\bfxios\b.*twitter/i.test(ua)) inAppBrowser = 'X';
  else if (/;\s*wv\)/i.test(ua)) inAppBrowser = 'an in-app browser';

  const isIpadOS13Plus = /macintosh/i.test(ua) && /mobile|tablet/i.test(lower);
  const os: Platform['os'] =
    /iphone|ipad|ipod/i.test(ua) || isIpadOS13Plus ? 'ios'
    : /android/i.test(ua) ? 'android'
    : /windows|macintosh|linux|cros/i.test(ua) ? 'desktop'
    : 'unknown';

  const browser: Platform['browser'] =
    /edg[ea]?\//i.test(ua) ? 'edge'
    : /samsungbrowser/i.test(ua) ? 'samsung'
    : /firefox|fxios/i.test(ua) ? 'firefox'
    : /chrome|crios|chromium/i.test(ua) ? 'chrome'
    : /safari/i.test(ua) ? 'safari'
    : 'other';

  return { os, browser, inAppBrowser, isStandalone };
}

/**
 * How this visitor can install, if at all.
 *
 * `hasNativePrompt` is whether a `beforeinstallprompt` event was actually
 * captured. It is the ground truth and beats any UA guess: the event firing
 * means the browser has decided the app is installable.
 */
export function installMethod(platform: Platform, hasNativePrompt: boolean): InstallMethod {
  if (platform.isStandalone) return 'installed';
  if (hasNativePrompt) return 'native';
  if (platform.inAppBrowser) return 'in-app-browser';
  // iOS never fires beforeinstallprompt. Chrome and Firefox on iOS are Safari
  // underneath and cannot install at all — only Safari's own Share sheet can.
  if (platform.os === 'ios') return platform.browser === 'safari' ? 'ios-manual' : 'in-app-browser';
  return 'browser-menu';
}

/** Whether to show an install control at all. */
export const canOfferInstall = (method: InstallMethod): boolean => method !== 'installed';

/* ------------------------------------------------------------ messaging */

export interface InstallCopy {
  title: string;
  body: string;
  cta: string | null;
  /** Numbered steps, where the user has to do it by hand. */
  steps?: string[];
}

export function installCopy(method: InstallMethod, platform: Platform): InstallCopy {
  switch (method) {
    case 'native':
      return {
        title: 'Install Majestic Cart',
        body: 'Add the app to your home screen for faster access to your wallet, orders and team.',
        cta: 'Install app',
      };

    case 'ios-manual':
      return {
        title: 'Add to your Home Screen',
        body: 'iPhone and iPad install apps from the Share menu.',
        cta: null,
        steps: [
          'Tap the Share button at the bottom of Safari',
          'Scroll down and tap "Add to Home Screen"',
          'Tap "Add" in the top corner',
        ],
      };

    case 'in-app-browser':
      // The honest answer. A button here would do nothing at all.
      return {
        title: 'Open in your browser to install',
        body: platform.inAppBrowser
          ? `${platform.inAppBrowser} cannot install apps. Tap the menu and choose "Open in browser", then install from there.`
          : 'This browser cannot install apps. Open the site in Chrome or Safari to install it.',
        cta: 'Copy link',
        steps:
          platform.os === 'ios'
            ? ['Tap the menu in the corner', 'Choose "Open in Safari"', 'Then Share → Add to Home Screen']
            : ['Tap the menu in the corner', 'Choose "Open in browser" or "Open in Chrome"', 'Then install from the address bar'],
      };

    case 'browser-menu':
      return {
        title: 'Install Majestic Cart',
        body:
          platform.browser === 'firefox'
            ? 'Open the Firefox menu and choose "Install" or "Add to Home Screen".'
            : 'Open your browser menu and look for "Install app" or "Add to Home Screen".',
        cta: null,
      };

    case 'installed':
      return { title: 'App installed', body: 'You are using the installed app.', cta: null };
  }
}

/* ------------------------------------------------- when to ask, and how often */

export interface PromptState {
  /** How many times the visitor has dismissed the popup. */
  dismissCount: number;
  /** Epoch ms of the last dismissal. */
  lastDismissedAt: number | null;
  /** Set once installed, so the popup never returns. */
  installedAt: number | null;
}

export const EMPTY_PROMPT_STATE: PromptState = { dismissCount: 0, lastDismissedAt: null, installedAt: null };

const DAY = 24 * 60 * 60 * 1000;

/**
 * Cooldown after a dismissal, lengthening each time.
 *
 * Someone who has said no three times has answered the question. Asking a
 * fourth time is the behaviour that gets a site's notification permission
 * blocked forever, and the same instinct applies here.
 */
export function cooldownMs(dismissCount: number): number | null {
  if (dismissCount <= 0) return 0;
  if (dismissCount === 1) return 7 * DAY;
  if (dismissCount === 2) return 30 * DAY;
  return null; // never again
}

export interface PromptDecision {
  show: boolean;
  reason: 'ok' | 'installed' | 'in-cooldown' | 'dismissed-enough' | 'not-engaged' | 'cannot-install';
}

/**
 * Decide whether to show the popup.
 *
 * `engagedMs` is time the page was actually VISIBLE, not wall-clock time since
 * load. A tab left open in the background for a minute is not someone browsing,
 * and interrupting them when they return would be worse than not asking.
 */
export function shouldShowPrompt(args: {
  state: PromptState;
  method: InstallMethod;
  engagedMs: number;
  thresholdMs?: number;
  now?: number;
}): PromptDecision {
  const { state, method, engagedMs } = args;
  const threshold = args.thresholdMs ?? 30_000;
  const now = args.now ?? Date.now();

  if (method === 'installed' || state.installedAt) return { show: false, reason: 'installed' };
  // Nothing useful to say on a platform that cannot install and has no
  // workaround worth interrupting someone for.
  if (method === 'browser-menu') return { show: false, reason: 'cannot-install' };

  const cooldown = cooldownMs(state.dismissCount);
  if (cooldown === null) return { show: false, reason: 'dismissed-enough' };
  if (state.lastDismissedAt !== null && now - state.lastDismissedAt < cooldown) {
    return { show: false, reason: 'in-cooldown' };
  }
  if (engagedMs < threshold) return { show: false, reason: 'not-engaged' };

  return { show: true, reason: 'ok' };
}

/* ---------------------------------------------------------------- storage */

export const PROMPT_STORAGE_KEY = 'mc-pwa-prompt';

/**
 * localStorage throws in Safari private mode and when cookies are blocked.
 * A failure to read the dismissal record must never break the page, so both
 * sides fall back silently — the worst case is asking someone twice.
 */
export function readPromptState(storage: Pick<Storage, 'getItem'> | null | undefined): PromptState {
  try {
    const raw = storage?.getItem(PROMPT_STORAGE_KEY);
    if (!raw) return { ...EMPTY_PROMPT_STATE };
    const parsed = JSON.parse(raw) as Partial<PromptState>;
    return {
      dismissCount: Number.isFinite(parsed.dismissCount) ? Number(parsed.dismissCount) : 0,
      lastDismissedAt: typeof parsed.lastDismissedAt === 'number' ? parsed.lastDismissedAt : null,
      installedAt: typeof parsed.installedAt === 'number' ? parsed.installedAt : null,
    };
  } catch {
    return { ...EMPTY_PROMPT_STATE };
  }
}

export function writePromptState(storage: Pick<Storage, 'setItem'> | null | undefined, state: PromptState): void {
  try {
    storage?.setItem(PROMPT_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* private mode, blocked storage — not worth failing a page render over */
  }
}

export const withDismissal = (state: PromptState, now = Date.now()): PromptState => ({
  ...state,
  dismissCount: state.dismissCount + 1,
  lastDismissedAt: now,
});

export const withInstall = (state: PromptState, now = Date.now()): PromptState => ({
  ...state,
  installedAt: now,
});
