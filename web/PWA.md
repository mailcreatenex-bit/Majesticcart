# Installable app (PWA)

The site installs as an app on Android, iOS, Windows and macOS — one tap from
the **Get the app** button, which sits in the header (icon-only on narrow
screens) and again in the footer, plus a prompt after 30 seconds for anyone who
has not installed it yet.

No app stores, no review queues, no separate codebase. It is the same site.

---

## What the member sees

| Where they are | What happens on "Get the app" |
|---|---|
| Chrome / Edge / Samsung Internet on Android | The browser's own install dialog. One tap, done. |
| Chrome / Edge on desktop | Same native dialog. |
| Safari on iPhone or iPad | A sheet with the three Share-sheet steps, because iOS has no install API. |
| **WhatsApp, Instagram, Facebook in-app browser** | **Cannot install at all.** See below. |
| Firefox | Nothing — the button is not rendered. |

### The WhatsApp problem

This matters more here than on most sites. An MLM's traffic arrives through
WhatsApp links — an upline sends a product link to their downline — so the
in-app browser is not an edge case, it is likely the single largest source of
first visits.

WhatsApp's in-app browser **cannot install a PWA**. It has no
`beforeinstallprompt`, no Share-to-Home-Screen, no menu item. An install button
there is a button that does nothing.

So in-app browsers get their own path: the sheet says the site has to be opened
in the real browser first, and offers a **Copy link** button. Detection for them
runs *before* everything else in `detectPlatform`, because these browsers
impersonate Safari and Chrome in their user-agent string and would otherwise be
handed instructions that do not match anything on screen.

Chrome on iOS is classed the same way. It is a Safari shell without the Share
sheet's "Add to Home Screen", so Safari's instructions would send the member
looking for a menu item that is not there.

---

## The event that gets lost

`beforeinstallprompt` is the browser offering the install dialog. It fires once,
cannot be retrieved afterwards, and does not fire again on its own. A listener
attached after it fires misses it permanently — and there is no error, nothing
in the console, nothing to debug. The button just does nothing, forever, for
that session.

Next.js makes this easy to get wrong. Its own bundles are emitted as
`<script src="..." async>` at the very top of `<head>`, ahead of anything the
root layout can place. On a warm cache a bundle can execute before an inline
script further down the document, so React hydrates first and any listener the
component adds is too late.

**`next/script` with `strategy="beforeInteractive"` does not fix this.** It reads
as though it should, and it is what the documentation points at, but in the App
Router it compiles to a push into `self.__next_s` — a queue drained by Next's
*own runtime*, which means it runs strictly *after* the bundles rather than
before. Measured on the built output, it moved the capture from character 2999
to 3749, past `</head>` entirely. It made the problem worse.

The fix is not to win the race but to stop depending on it. The listener is
wired by two independent routes that share one flag:

1. **`installCaptureScript`** — a raw inline `<script>` in `<head>`, which runs
   where the parser finds it, before React has downloaded.
2. **`ensureInstallCapture()`** — called by the install components on mount.

Whichever runs first attaches the listener; the other is a no-op. The event
lands in `window.__mcInstall` either way, and a custom event tells React.

`__tests__/pwa.spec.ts` holds this to the property directly: the event is caught
with the inline script first, with the component first, with *only* the
component (React won the race), and with *only* the inline script (the bundle
never loaded). Removing either route fails a test.

---

## The 30-second prompt

Shown once a visitor has spent 30 seconds **actually looking at the page**.

That is visible time, accumulated across `visibilitychange` — not wall-clock
time since load. A tab left open in the background for a minute is not someone
browsing, and popping a dialog the instant they switch back is precisely the
behaviour that gets a prompt dismissed with prejudice.

It is never shown to someone who has it installed, is in a browser that cannot
install, or has said no recently. Dismissals back off:

| Dismissal | Next prompt |
|---|---|
| 1st | after 7 days |
| 2nd | after 30 days |
| 3rd | never again |

Stored in `localStorage`, which means it is per-device and clearing site data
resets it. Every read and write is wrapped — Safari private mode throws on both,
and a dismissal record is not worth breaking a page render over. Worst case,
someone gets asked twice.

---

## What the service worker will not cache

A service worker is required for installability, but on a site holding member
money the **exclusion** list matters far more than the offline support does.

Never cached, never served from cache — the worker does not touch these requests
at all:

```
/api/  /wallet  /orders  /network  /account  /recharge
/cart  /checkout  /admin  /reports
/login  /signup  /forgot-password
```

A cached wallet balance is not a stale pixel. A member would see money they have
already spent, try to order against it, and get an error they cannot explain —
and in an MLM that becomes an accusation that the company is taking their money.
The same reasoning covers order status, commission and the genealogy tree.

Everything else:

- **Hashed build output and icons** — cache-first. Immutable by definition.
- **Pages** — network-first, cache as fallback. A cached product page showing
  last week's price is worse than a slightly slower load, so the cache exists
  for being offline, not for speed.
- **Offline** — `/offline`, precached at install, `noindex` so "You are offline"
  never turns up in search results.

Written by hand rather than generated by Workbox, because the exclusion list is
the entire point and that is exactly the part a generated config makes easy to
get subtly wrong.

---

## Icons

Six generated files in `public/icons/`.

`any` and `maskable` are **separate manifest entries**, not one icon serving both
purposes. A single maskable icon gets cropped into a circle on Android and loses
its edges; a single `any` icon gets an ugly white box drawn behind it.

The maskable pair keeps all artwork inside the safe zone — verified as zero
off-background pixels on both the 10% and 15% inset rings, so the mark survives
whatever shape the launcher crops to.

---

## Files

| File | What it holds |
|---|---|
| `lib/pwa.ts` | Platform detection, install method, prompt timing, cooldown. Pure — no DOM, fully tested. |
| `components/PwaRegister.tsx` | SW registration, `installCaptureScript`, `ensureInstallCapture()`. |
| `components/InstallPrompt.tsx` | `InstallButton` (`variant="header"` for the nav), `InstallPromptPopup`, `InstallSheet`, engagement timer. |
| `app/manifest.ts` | Manifest, generated at `/manifest.webmanifest`. |
| `public/sw.js` | Service worker and the never-cache list. |
| `app/offline/page.tsx` | Offline fallback. |
| `__tests__/pwa.spec.ts` | 34 tests. |

---

## Before this goes live

- **Serve over HTTPS.** No service worker, no manifest, no install on plain HTTP.
  `localhost` is the only exception.
- **Replace the generated icons** with the client's real artwork, keeping the
  maskable safe zone.
- **Test in WhatsApp specifically**, on a real phone, since that is where most
  first visits will land.
- Bump `VERSION` in `public/sw.js` on any deploy that changes cached assets.
  Old caches are cleaned up on activate, but only for versions that differ.
