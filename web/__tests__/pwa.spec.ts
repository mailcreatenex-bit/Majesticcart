import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  detectPlatform, installMethod, installCopy, shouldShowPrompt, cooldownMs,
  readPromptState, writePromptState, withDismissal, withInstall,
  EMPTY_PROMPT_STATE, PROMPT_STORAGE_KEY, type PromptState,
} from '@/lib/pwa';
import { robotsFor } from '@/lib/seo';
import { installCaptureScript, ensureInstallCapture } from '@/components/PwaRegister';

/* Real user-agent strings, because this is the one place where a plausible
   invented string would prove nothing. */
const UA = {
  androidChrome: 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  iosSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
  iosChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1',
  desktopChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  desktopEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
  desktopFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  samsung: 'Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36',
  whatsappAndroid: 'Mozilla/5.0 (Linux; Android 13; SM-G991B Build/TP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 WhatsApp/2.23',
  androidWebview: 'Mozilla/5.0 (Linux; Android 13; SM-G991B Build/TP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36',
  instagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 302.0.0.23.113',
  facebook: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBDV/iPhone14,2]',
  ipadOS: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
};

/* ------------------------------------------------------ platform detection */

test('operating systems are identified from real user agents', () => {
  assert.equal(detectPlatform(UA.androidChrome).os, 'android');
  assert.equal(detectPlatform(UA.iosSafari).os, 'ios');
  assert.equal(detectPlatform(UA.desktopChrome).os, 'desktop');
  assert.equal(detectPlatform(UA.desktopFirefox).os, 'desktop');
});

test('iPadOS is recognised despite claiming to be a Mac', () => {
  // Since iPadOS 13 the UA says "Macintosh". Treating an iPad as a desktop
  // would show it a native install button that can never fire.
  const p = detectPlatform(UA.ipadOS);
  assert.equal(p.os, 'ios');
});

test('browsers are identified in the right order, since each impersonates another', () => {
  // Edge's UA contains "Chrome"; Chrome's contains "Safari"; Samsung's contains
  // both. Checked in the wrong order, every one of these comes back as Safari.
  assert.equal(detectPlatform(UA.desktopEdge).browser, 'edge');
  assert.equal(detectPlatform(UA.desktopChrome).browser, 'chrome');
  assert.equal(detectPlatform(UA.samsung).browser, 'samsung');
  assert.equal(detectPlatform(UA.iosSafari).browser, 'safari');
  assert.equal(detectPlatform(UA.desktopFirefox).browser, 'firefox');
  assert.equal(detectPlatform(UA.iosChrome).browser, 'chrome');
});

test('in-app browsers are identified before the browser they impersonate', () => {
  // This is the case that matters most here: the whole traffic model is members
  // sharing referral links on WhatsApp.
  assert.equal(detectPlatform(UA.whatsappAndroid).inAppBrowser, 'WhatsApp');
  assert.equal(detectPlatform(UA.instagram).inAppBrowser, 'Instagram');
  assert.equal(detectPlatform(UA.facebook).inAppBrowser, 'Facebook');
  // A generic Android webview still cannot install, even unbranded.
  assert.equal(detectPlatform(UA.androidWebview).inAppBrowser, 'an in-app browser');
});

test('a real browser is never mistaken for an in-app one', () => {
  for (const ua of [UA.androidChrome, UA.iosSafari, UA.desktopChrome, UA.desktopEdge, UA.samsung, UA.desktopFirefox]) {
    assert.equal(detectPlatform(ua).inAppBrowser, null, `false positive on ${ua.slice(0, 40)}`);
  }
});

/* ---------------------------------------------------------- install method */

test('a captured prompt event beats every user-agent guess', () => {
  // The event firing means the browser has already decided it is installable.
  const p = detectPlatform(UA.androidChrome);
  assert.equal(installMethod(p, true), 'native');
});

test('already running as an app offers nothing', () => {
  const p = detectPlatform(UA.androidChrome, true);
  assert.equal(installMethod(p, true), 'installed');
  assert.equal(installMethod(p, false), 'installed');
});

test('iOS Safari gets manual instructions, never a button', () => {
  // iOS has no install API at all. A button there would do nothing.
  assert.equal(installMethod(detectPlatform(UA.iosSafari), false), 'ios-manual');
});

test('Chrome on iOS cannot install either, and is not offered Safari steps', () => {
  // Every iOS browser is Safari underneath, but only Safari's own Share sheet
  // can install. Telling a Chrome-on-iOS user to "tap Share" sends them
  // somewhere that has no such option.
  assert.equal(installMethod(detectPlatform(UA.iosChrome), false), 'in-app-browser');
});

test('WhatsApp gets the open-in-browser route, not an install button', () => {
  assert.equal(installMethod(detectPlatform(UA.whatsappAndroid), false), 'in-app-browser');
  assert.equal(installMethod(detectPlatform(UA.instagram), false), 'in-app-browser');
});

test('Firefox falls back to its own menu', () => {
  assert.equal(installMethod(detectPlatform(UA.desktopFirefox), false), 'browser-menu');
});

/* ------------------------------------------------------------------- copy */

test('every method produces usable copy, and only native offers a button', () => {
  const android = detectPlatform(UA.androidChrome);
  const ios = detectPlatform(UA.iosSafari);
  const whatsapp = detectPlatform(UA.whatsappAndroid);

  assert.equal(installCopy('native', android).cta, 'Install app');
  // The manual routes must carry steps, or the user is told it is possible
  // without being told how.
  assert.ok((installCopy('ios-manual', ios).steps ?? []).length >= 3);
  assert.equal(installCopy('ios-manual', ios).cta, null);
  assert.ok((installCopy('in-app-browser', whatsapp).steps ?? []).length >= 2);
});

test('the in-app message names the app the visitor is actually in', () => {
  const copy = installCopy('in-app-browser', detectPlatform(UA.whatsappAndroid));
  assert.match(copy.body, /WhatsApp cannot install apps/);
  assert.match(copy.body, /Open in browser/);
});

test('in-app instructions differ by platform, because the menus differ', () => {
  const ios = installCopy('in-app-browser', detectPlatform(UA.instagram));
  const android = installCopy('in-app-browser', detectPlatform(UA.whatsappAndroid));
  assert.match(ios.steps!.join(' '), /Safari/);
  assert.match(android.steps!.join(' '), /Chrome|browser/);
});

/* --------------------------------------------------------- when to prompt */

const base = { method: 'native' as const, state: EMPTY_PROMPT_STATE, now: 1_000_000 };

test('the popup waits for 30 seconds of engagement', () => {
  assert.deepEqual(shouldShowPrompt({ ...base, engagedMs: 29_999 }), { show: false, reason: 'not-engaged' });
  assert.deepEqual(shouldShowPrompt({ ...base, engagedMs: 30_000 }), { show: true, reason: 'ok' });
});

test('someone who already installed it is never asked', () => {
  assert.equal(shouldShowPrompt({ ...base, method: 'installed', engagedMs: 99_000 }).show, false);
  const installed: PromptState = { ...EMPTY_PROMPT_STATE, installedAt: 123 };
  assert.equal(shouldShowPrompt({ ...base, state: installed, engagedMs: 99_000 }).reason, 'installed');
});

test('a browser that cannot be helped is not interrupted', () => {
  // Firefox can install from its own menu, but there is nothing worth
  // interrupting someone for.
  assert.deepEqual(
    shouldShowPrompt({ ...base, method: 'browser-menu', engagedMs: 99_000 }),
    { show: false, reason: 'cannot-install' },
  );
});

test('WhatsApp users are still prompted, because the workaround is worth knowing', () => {
  assert.equal(shouldShowPrompt({ ...base, method: 'in-app-browser', engagedMs: 30_000 }).show, true);
});

test('the cooldown lengthens with each dismissal, then stops forever', () => {
  const DAY = 24 * 60 * 60 * 1000;
  assert.equal(cooldownMs(0), 0);
  assert.equal(cooldownMs(1), 7 * DAY);
  assert.equal(cooldownMs(2), 30 * DAY);
  // Three refusals is an answer. Asking again is what gets a prompt blocked.
  assert.equal(cooldownMs(3), null);
  assert.equal(cooldownMs(9), null);
});

test('a dismissal is respected for exactly its cooldown, then the prompt returns', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const dismissedOnce: PromptState = { dismissCount: 1, lastDismissedAt: 1_000_000, installedAt: null };

  const nextDay = shouldShowPrompt({ ...base, state: dismissedOnce, engagedMs: 60_000, now: 1_000_000 + DAY });
  assert.deepEqual(nextDay, { show: false, reason: 'in-cooldown' });

  const afterAWeek = shouldShowPrompt({ ...base, state: dismissedOnce, engagedMs: 60_000, now: 1_000_000 + 8 * DAY });
  assert.deepEqual(afterAWeek, { show: true, reason: 'ok' });
});

test('after three dismissals it never shows again, however long passes', () => {
  const YEAR = 365 * 24 * 60 * 60 * 1000;
  const state: PromptState = { dismissCount: 3, lastDismissedAt: 1_000, installedAt: null };
  assert.deepEqual(
    shouldShowPrompt({ ...base, state, engagedMs: 999_999, now: 1_000 + 5 * YEAR }),
    { show: false, reason: 'dismissed-enough' },
  );
});

/* ----------------------------------------------------------- persistence */

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    dump: () => Object.fromEntries(map),
  };
}

test('prompt state round trips through storage', () => {
  const storage = fakeStorage();
  const state = withDismissal(EMPTY_PROMPT_STATE, 5_000);
  writePromptState(storage, state);
  assert.deepEqual(readPromptState(storage), { dismissCount: 1, lastDismissedAt: 5_000, installedAt: null });
});

test('dismissals accumulate rather than overwrite', () => {
  let state = withDismissal(EMPTY_PROMPT_STATE, 1_000);
  state = withDismissal(state, 2_000);
  assert.equal(state.dismissCount, 2);
  assert.equal(state.lastDismissedAt, 2_000);
});

test('installing clears the prompt permanently', () => {
  const state = withInstall(withDismissal(EMPTY_PROMPT_STATE, 1_000), 9_000);
  assert.equal(state.installedAt, 9_000);
  assert.equal(shouldShowPrompt({ ...base, state, engagedMs: 99_000 }).reason, 'installed');
});

test('blocked or broken storage never throws', () => {
  // Safari private mode throws on both read and write. A dismissal record is
  // not worth breaking a page render over; the worst case is asking twice.
  const throwing = {
    getItem: () => { throw new Error('SecurityError'); },
    setItem: () => { throw new Error('QuotaExceededError'); },
  };
  assert.doesNotThrow(() => readPromptState(throwing));
  assert.deepEqual(readPromptState(throwing), EMPTY_PROMPT_STATE);
  assert.doesNotThrow(() => writePromptState(throwing, EMPTY_PROMPT_STATE));
  assert.doesNotThrow(() => readPromptState(null));
});

test('corrupt stored state degrades to empty rather than crashing', () => {
  for (const bad of ['not json', '{"dismissCount":"lots"}', 'null', '[]']) {
    const storage = fakeStorage({ [PROMPT_STORAGE_KEY]: bad });
    assert.doesNotThrow(() => readPromptState(storage));
    assert.equal(readPromptState(storage).dismissCount, 0);
  }
});

/* ------------------------------------------------------------- indexing */

test('the offline fallback is never indexed', () => {
  // "You are offline" appearing in search results as a real page.
  const r = robotsFor('/offline') as { index: boolean; follow: boolean };
  assert.equal(r.index, false);
  assert.equal(r.follow, true);
});

/* ------------------------------------------------------- capture ordering */

/**
 * The install event is single-shot and unrecoverable, and the two things that
 * might catch it — an inline <script> in the document and the React component
 * on mount — cannot be ordered reliably: Next emits its own bundles as `async`
 * scripts at the very top of <head>, ahead of anything the layout can place.
 *
 * So both routes are wired, and these tests hold them to the property that
 * makes that safe: whichever runs first, exactly one listener is attached and
 * the event is caught.
 */

interface FakeWin {
  __mcInstall?: { event: unknown; installed: boolean; wired?: boolean };
  addEventListener(type: string, fn: (e: unknown) => void): void;
  removeEventListener(type: string, fn: (e: unknown) => void): void;
  dispatchEvent(e: { type: string }): void;
  listenerCount(type: string): number;
}

function fakeWindow(): FakeWin {
  const listeners = new Map<string, Array<(e: unknown) => void>>();
  return {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type)!.push(fn);
    },
    removeEventListener(type, fn) {
      const l = listeners.get(type);
      if (l) listeners.set(type, l.filter((x) => x !== fn));
    },
    dispatchEvent(e) {
      for (const fn of listeners.get(e.type) ?? []) fn(e);
    },
    listenerCount: (type) => (listeners.get(type) ?? []).length,
  };
}

class FakeEvent { constructor(public type: string) {} }

/**
 * Run a body with the fake window installed as the global.
 *
 * It stays installed for the whole body, not just the wiring call: the
 * listeners close over `window`, so swapping it back before dispatching would
 * be testing the harness rather than the code.
 */
function withWindow<T>(win: FakeWin, fn: () => T): T {
  const g = globalThis as { window?: unknown; Event?: unknown };
  const realWin = g.window, realEvent = g.Event;
  g.window = win;
  g.Event = FakeEvent;
  try { return fn(); } finally { g.window = realWin; g.Event = realEvent; }
}

/** Runs the inline script's source, exactly as the browser would. */
function runInlineCapture(win: FakeWin) {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('window', 'Event', installCaptureScript)(win, FakeEvent);
}

/** The component-side wiring. Called inside withWindow. */
function runComponentCapture() {
  return ensureInstallCapture();
}

const promptEvent = () => ({ type: 'beforeinstallprompt', preventDefault() {} });

for (const [name, componentFirst] of [
  ['inline first, then the component', false],
  ['the component first, then inline', true],
] as const) {
  test(`the install event is caught when ${name}`, () => {
    const win = fakeWindow();

    withWindow(win, () => {
      if (componentFirst) { runComponentCapture(); runInlineCapture(win); }
      else { runInlineCapture(win); runComponentCapture(); }

      // Exactly one set of listeners, whichever route got there first. Two
      // would mean the custom event fires twice and the UI re-evaluates
      // needlessly.
      assert.equal(win.listenerCount('beforeinstallprompt'), 1);
      assert.equal(win.listenerCount('appinstalled'), 1);

      let announced = 0;
      win.addEventListener('mc-install-available', () => { announced += 1; });

      const evt = promptEvent();
      win.dispatchEvent(evt);

      assert.equal(win.__mcInstall!.event, evt, 'the event must be stashed for the UI to fire later');
      assert.equal(announced, 1, 'the UI must be told exactly once');
    });
  });
}

test('the component alone catches the event when the inline script has not run', () => {
  // The failure this whole arrangement exists to prevent.
  //
  // Next emits its bundles as `async` scripts at the very top of <head>, ahead
  // of anything the layout can place, so on a warm cache React can hydrate
  // before the inline capture further down the document has executed. If the
  // component relied on the inline script having run, `beforeinstallprompt`
  // would fire into an empty room and the install button would be dead for the
  // rest of the session, silently.
  const win = fakeWindow();

  withWindow(win, () => {
    runComponentCapture();                       // React got there first
    assert.equal(win.listenerCount('beforeinstallprompt'), 1);

    let announced = 0;
    win.addEventListener('mc-install-available', () => { announced += 1; });

    const evt = promptEvent();
    win.dispatchEvent(evt);                      // ...and the event fires now

    assert.equal(win.__mcInstall!.event, evt, 'the component must catch it on its own');
    assert.equal(announced, 1);
  });
});

test('the inline script alone catches the event when React never loads', () => {
  // The mirror case: a bundle that 404s after a deploy, or a slow connection
  // that never finishes. The event must still be held for whenever React does
  // arrive, rather than lost.
  const win = fakeWindow();

  withWindow(win, () => {
    runInlineCapture(win);
    const evt = promptEvent();
    win.dispatchEvent(evt);
    assert.equal(win.__mcInstall!.event, evt);
  });
});

test('an event that fires before the component mounts is still there for it', () => {
  // The ordinary case on a cold load: the browser decides the site is
  // installable while React is still downloading.
  const win = fakeWindow();
  withWindow(win, () => {
    runInlineCapture(win);

    const evt = promptEvent();
    win.dispatchEvent(evt);

    // React finally mounts and asks.
    assert.equal(runComponentCapture().event, evt);
  });
});

test('appinstalled clears the stashed event', () => {
  // Otherwise a spent event sits around and the UI keeps offering to install
  // an app that is already installed.
  const win = fakeWindow();
  withWindow(win, () => {
    runInlineCapture(win);
    win.dispatchEvent(promptEvent());
    assert.ok(win.__mcInstall!.event);

    let done = 0;
    win.addEventListener('mc-install-done', () => { done += 1; });
    win.dispatchEvent({ type: 'appinstalled' });

    assert.equal(win.__mcInstall!.event, null);
    assert.equal(win.__mcInstall!.installed, true);
    assert.equal(done, 1);
  });
});

test('repeated wiring never attaches a second listener', () => {
  // Every component that shows an install control calls ensureInstallCapture
  // on mount, and there can be several on a page.
  const win = fakeWindow();
  withWindow(win, () => {
    runInlineCapture(win);
    for (let i = 0; i < 5; i += 1) runComponentCapture();
    assert.equal(win.listenerCount('beforeinstallprompt'), 1);
  });
});
