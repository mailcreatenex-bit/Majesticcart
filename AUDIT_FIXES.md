# Audit fixes — September 2026

This documents every change made in response to the audit, and is deliberately
explicit about the one item left undone and why.

## 🔴 Fixed: the login flow was non-functional

**The bug.** The API (`backend/src/api/member.controller.ts`,
`admin.controller.ts`) returns `{ accessToken, refreshToken }` as a JSON body.
Nothing in the repo ever turned that into a cookie. The frontend's
`lib/api.ts` assumed an httpOnly cookie was already being set
(`credentials: 'include'`), and the login/signup pages posted to
`/api/auth/login` / `/api/auth/signup` — routes that did not exist anywhere in
`web/app`. A member could submit the login form, the API would issue a valid
session, and the browser would still end up signed out, because nothing ever
stored the token anywhere.

**The fix.** Added the missing middle layer:

- `web/lib/session-shared.ts` — pure helpers (cookie names, redirect-safety
  checks, token-shape checks). No side effects, so these are unit-tested
  directly (`__tests__/session.spec.ts`).
- `web/lib/backend.ts` — the server-only half (`import 'server-only'`, so an
  accidental client-component import fails the build instead of leaking the
  API's internal address). Builds backend URLs and forwards the visitor's real
  IP/user-agent so fraud signals and lockouts on the API still record the
  visitor, not this server.
- `web/app/api/auth/login/route.ts`, `.../signup/route.ts` — receive the
  progressive-enhancement `<form method="post">` submissions, call the real
  API, and convert the JSON tokens into httpOnly, `SameSite=Lax` cookies
  (`mc_session` / `mc_refresh`) before redirecting.
- `web/app/api/[...path]/route.ts` — a catch-all proxy for every other call
  `lib/api.ts` makes (`/me`, `/orders`, `/admin/...`, etc.). Attaches the
  access token as `Authorization: Bearer …`, and on a 401 makes one silent
  refresh attempt using the refresh cookie before giving up and clearing the
  session. Member and admin sessions use separate cookie pairs
  (`mc_session`/`mc_refresh` vs `mc_admin_session`/`mc_admin_refresh`) so one
  browser can hold both without either clobbering the other.
- Added a "Sign out" button to `MemberShell.tsx` — there was previously no way
  for a member to sign out at all; only the admin console had one.
- `lib/api.ts`: a 401 on an `/admin/...` call now redirects to `/admin/login`,
  not the member `/login` — previously every session expiry sent an admin to
  the wrong form.

**A bug this surfaced while fixing it.** `middleware.ts` ran its
SEO canonical-URL redirect logic on `/api/*` as well as real pages. Its
allowlist of "parameters that legitimately change the page" doesn't include
things like `?cursor=…` or `?status=PENDING`, so any admin list call with a
query string was silently 308-redirected to a stripped version of the same
URL before it ever reached the API — an admin paging through recharges or
withdrawals would have had `cursor` dropped on every page after the first.
Fixed by excluding `api/` from the middleware's matcher; API routes get no SEO
treatment because they are not pages. `next`/`error`/`identifier` were added
to the canonical-parameter allowlist so the login/signup pages' own error
messages survive the same redirect logic.

## Rate limiting

Added `backend/src/common/rate-limit.guard.ts` — Redis-backed (reuses the
connection BullMQ already requires), IP-scoped, opt-in via a
`@RateLimit(...)` decorator. Applied to:

- `POST /auth/login` — 10/min per IP
- `POST /auth/login/otp` — 10/min per IP
- `POST /auth/otp` — 20/hour per IP (on top of the existing per-phone throttle)
- `POST /auth/reset` — 10/hour per IP
- `POST /auth/signup` — 10/hour per IP
- `POST /admin/auth/login` — 5/min per IP

This sits alongside the existing per-account lockout, not instead of it —
lockout stops one account being guessed, this stops one IP spraying attempts
across many accounts. Fails open if Redis is unreachable (logged), so a Redis
outage degrades the defence rather than taking sign-in down entirely.

## TZ enforcement

`main.ts` previously only logged a warning if `TZ` was not `Asia/Kolkata`. The
monthly repurchase gate and volume buckets depend on it silently — nobody sees
a stack trace, a member is just wrongly told they missed their target. Now
throws at boot when `NODE_ENV=production`; still just warns elsewhere so a
laptop with an unset `TZ` can run the app.

## Cleanup

- Removed `prototype/` (`MajesticCart.jsx`, `ReportBuilder.jsx` — ~6,100 lines
  of unused legacy code shipped inside the "Final" zip).

## Not fixed: the missing initial Prisma migration

`backend/prisma/migrations/` contains only `0002_constraints`; the baseline
schema migration (`0001`) is missing, so `npx prisma migrate deploy` against
an empty database will not, on its own, produce a working schema.

This was **not** hand-written. Reconstructing correct DDL for a 28-model
schema — enum types, cascade behaviour, nullability, every index — by reading
`schema.prisma` and guessing at Prisma's compiled output is exactly the kind
of task that looks done and is subtly wrong in a way nobody notices until a
constraint that should have existed doesn't, on a database holding real ledger
balances. I don't have a way to run `prisma migrate dev` or `prisma db push`
against a real database in this environment to generate and verify the
migration, so producing one here would be a guess dressed up as a fix.

**The safe way to close this**, in an environment with the Postgres instance
`docker-compose.yml` already brings up and the Prisma CLI installed:

```bash
docker compose up -d db
npx prisma migrate dev --name init --create-only   # generates 0001-ish SQL from schema.prisma, does not apply it
# review the generated SQL, then:
npx prisma migrate dev
psql "$DATABASE_URL" -f prisma/migrations/0002_constraints/migration.sql
npx prisma migrate resolve --applied 0002_constraints  # if migrate dev didn't already track it
```

If migration history needs to look like a clean `0001` before `0002` rather
than whatever timestamped name `migrate dev` assigns, rename the generated
folder and update `_prisma_migrations` accordingly, or use
`prisma migrate resolve` to mark it applied without re-running it against a
database that already has the schema from `db push`. Either way, this needs a
real database in the loop to verify against — worth doing before the first
production deploy, not worth faking here.

## How to verify

I could not run `npm install`, the type checker, or the test suites in this
environment (no network access), so none of this has actually been compiled
or executed — it's been checked by reading, not by running. Before deploying,
in order:

```bash
# backend
cd backend && npm install && npm run typecheck && npm test
# needs REDIS_HOST/PORT reachable for the new rate-limit guard to do anything;
# it fails open (logs a warning) if Redis is unreachable, so this won't block
# a boot without Redis, it just won't rate-limit anything.

# frontend
cd web && npm install && npm run typecheck && npm test
```

Then a manual pass: sign up, sign out, sign back in with the password, let an
access token expire (or shorten `ACCESS_TOKEN_MAX_AGE_SECONDS` in
`lib/session-shared.ts` temporarily to make this practical to test) and
confirm a call still succeeds via the silent refresh, and confirm an
admin-console session expiry lands on `/admin/login` rather than `/login`.

---

# Second pass — branding, page audit, mobile recharge

## Footer credit + logo

Added "Developed with ♥️ by [Cre8nex logo]" to the very bottom of the site
footer (`components/Chrome.tsx`), linked to cre8nex.com. The logo asset
(`web/public/brand/cre8nex-logo.png`) is the wordmark cropped out of the
supplied file, with the black background keyed to transparent so it sits
cleanly on the footer's white background — the source file's background was
solid opaque black, not transparent, so this couldn't just be dropped in
as-is. Not added to the admin console: that's a back-office tool, not a
marketing page, and `app/(admin)/layout.tsx` deliberately doesn't inherit the
shop's chrome.

## Page audit

Every page asked for already existed: Home, About, Cart, Checkout, Wallet,
Products (`/shop`, `/product/[slug]`), Categories (`/category/[slug]`,
indexed on `/shop`), Privacy Policy and Terms & Conditions (`/legal/privacy-
policy`, `/legal/terms` — easy to miss since they're not literally named
"privacy-policy.tsx" anywhere, they're generated from `lib/legal.ts`).

**Found while checking:** the admin nav had a "Reports" link
(`/admin/reports`) with no page behind it. The API's `ReportController`
(`GET /reports/:key`) exists; the only UI that ever called it was
`prototype/ReportBuilder.jsx`, which was removed as dead code in the first
pass. Removed the dangling nav entry rather than leave a link that 404s —
building a real Reports page wasn't asked for here, so it's noted rather than
done.

## Home page as a gist of the site

Added two sections to `app/(shop)/page.tsx`: a short "About Majestic Cart"
block linking to `/about`, and an "Explore Majestic Cart" grid linking to
Shop, Wallet & recharge, Become a member, Your network, Your account, and
Help & policies — one line each, so the home page now points to everything
else on the site rather than just the catalogue.

## Wallet → mobile recharge

Built, but not the way it was literally described. Your own schema has this
comment on the shopping wallet: `// funded by verified UPI payments; spends
on orders; never withdrawable`. That line exists on purpose — a wallet that
only ever converts into your own products/services stays simple store
credit; one that converts into mobile airtime (fungible, effectively cash) is
the shape of thing that needs RBI's PPI (Prepaid Payment Instrument)
authorisation in India. I'm not a lawyer and this isn't legal advice, but
that's a real license requirement, not paperwork, so I didn't build a literal
"wallet balance → arbitrary recharge" cash-out path.

What's built instead: **Majestic Cart selling mobile recharge as a service**,
funded from the shopping wallet exactly like a product order —

- `prisma/schema.prisma` — new `MobileRechargeRequest` model, `RechargeOperator`
  and `MobileRechargeStatus` enums, two new `LedgerCategory` values
  (`MOBILE_RECHARGE_HOLD` / `MOBILE_RECHARGE_REVERSAL`). The `WalletKind.SHOPPING`
  comment was updated to say what it now covers: orders *and* in-app services,
  still never redeemable as cash to a bank or UPI handle.
- `backend/src/mobile-recharge/mobile-recharge.service.ts` — mirrors
  `withdrawal.service.ts` on purpose: hold the amount the instant a member
  requests it, then either complete it (admin has actually topped up the
  number through their own recharge account — there's no telecom/BBPS API
  integration in scope, same manual-fulfilment reality the UPI recharge side
  already runs on) or reverse the hold if it can't be done.
- Member endpoints: `POST /wallet/mobile-recharge`, `GET /wallet/mobile-recharge`.
- Admin endpoints: `GET /admin/mobile-recharges`, `POST .../:id/complete`,
  `POST .../:id/fail` — new `AdminMobileRechargeController`, registered in
  `app.module.ts`.
- Frontend: `components/MobileRechargeView.tsx` (member request form, at
  `/wallet/mobile-recharge`, linked from the shopping wallet card in
  `WalletView.tsx`), `components/admin/MobileRechargeQueue.tsx` (admin queue
  at `/admin/mobile-recharges`, linked in the admin nav).
- `member/view.service.ts`'s `CATEGORY_LABELS` map got the two new ledger
  categories added — missing this would have left mobile-recharge entries
  showing up unlabelled in the wallet statement.

**Still needs a migration.** Same situation as the `0001` gap already
documented above: this adds a new table and two new enum values, and I did
not hand-write that migration either, for the same reason — no real database
in this environment to generate or verify it against. Once the `0001`
baseline is sorted, run:

```bash
npx prisma migrate dev --name mobile_recharge
```

and it'll pick up everything above.

---

# Third pass — matching the real logo

You shared the final "Majestic Cart" seal (gold monogram, crown, lotus, blush-pink mandala border). Re-themed the site around it rather than just dropping the image in.

## Palette

Sampled the logo's actual pixels (k-means clustering on the non-white regions) to get its real gold and rose tones, then compared against the site's existing palette. The gold gradient (`#9E7322`/`#D9B25A`/`#A87C26`) was already an almost exact match — left untouched. Two colors were off-family:

- **Ink** (`#34172B`, used for all headings/primary text — 187 places) was a cool violet-plum; the logo has no dark neutral in it at all (logos rarely do), but a UI still needs one for legible text. Rotated its hue from the violet family (319°) into the same warm maroon family as the logo's rose (355°) — deep maroon-and-gold is itself a classic, trustworthy pairing (think of what "royal" branding usually looks like), so this reads as more cohesive with the crown/gold imagery than the previous purple did. New: `#341316`.
- **Accent/rose** (`#A8455F`, links and CTA borders — 57 places) was a saturated magenta-berry; shifted toward the logo's actual dusty rose while keeping enough contrast for text (checked: 5.2:1 against white, comfortably past the 4.5:1 AA minimum for body text). New: `#B84654`.
- Body, secondary and tertiary text colors (`#5C4452`, `#8C7480`, `#B79BA9`) got smaller hue nudges in the same direction, so the whole neutral scale stays internally consistent rather than having the headings shift and the body text left behind.

Applied as one direct find-and-replace across every `.tsx`/`.ts` file (450 instances) — deliberately did *not* touch the site's semantic status colors (success green, error red, warning amber, info blue), since those encode meaning, not brand. Also left the admin console's neutral grayscale alone; it's a separate, intentionally unbranded tool.

Checked the result by rendering a static mockup of the header, hero and login page with the new values before committing to the site-wide sweep — screenshots aren't optional when a color change touches 450 call sites blind.

## The actual logo, everywhere it was missing

- **Favicon, Apple touch icon, PWA icons (192/512), maskable icons**: all regenerated from your file. The maskable versions get the logo scaled to ~68% on a padded canvas — without that, Android's circular crop would cut through the crown and the diamond border's corners.
- **Header**: seal added as a small badge next to the wordmark.
- **Footer**: same, next to the entity name block.
- **Login/signup pages**: the seal at full size, centered above "Welcome back" — this is the page someone checks before trusting the site with money, so the mark carries the most weight here.
- **`public/logo.png`**: didn't exist. `lib/seo.ts`'s `organizationJsonLd()` has referenced this path since the page was built, for Google's Organization structured data — it was a 404 the whole time. Created from the real logo.
- **`public/og/default.jpg`**: also didn't exist — the default share-card image for every page's Open Graph and Twitter Card tags, so every WhatsApp/Facebook/X share of any page on the site had a broken preview image. Designed one from scratch (seal, brand name, tagline, gold-bordered blush gradient) rather than just centering the logo on a blank canvas, since this is what shows up when a member forwards a product link — it's doing real marketing work.

---

# Fourth pass — regression audit

You asked directly: did adding new things break or orphan anything old? Checked systematically rather than by re-reading and hoping, since re-reading is exactly how the one real bug below got missed the first time.

**Method:**
1. Listed every actual page route on disk (31, route groups resolved) and diffed it against every `href`/`Link` target used anywhere in the frontend, dynamic segments included. Zero dangling internal links.
2. Listed every backend controller route (75, across every `@Controller` in `src/api/`) and diffed it against every `api(...)` call made anywhere in the frontend. Every call matches a real route.
3. Swept every source file in both `web/` and `backend/src/` for balanced `{}`, `()`, `[]` — not just the files touched this session, the whole tree. Three pre-existing files outside anything I touched flagged on the naive bracket count; checked each and confirmed it's a bracket character inside a string or regex, not a real mismatch (e.g. `legalName: '[REGISTERED LEGAL NAME]'`).

**One real regression found, from an earlier pass in this conversation:** when the second-pass audit removed the dead "Reports" link from the admin nav bar, it missed that `AdminDashboard.tsx` had its own, separate link to the same dead `/admin/reports` route — the dashboard's "Security alerts" tile, showing a live unresolved-alert count with a click-through that also 404'd. Worse than the nav link: this one is tied to an actionable, sometimes-urgent number (fraud/abuse signals the platform raises on its own — duplicate UTRs, reused screenshots), and nothing anywhere let an admin actually see or clear one. The signals were being written to the database and effectively going nowhere.

Fixed properly rather than removed again: added `SecurityAlertService` + `AdminSecurityController` (`GET /admin/security-alerts`, `POST /admin/security-alerts/:id/resolve`) and a real admin page at `/admin/security-alerts` — a plain queue (list, resolve), not the general ad-hoc report/query builder `ReportController` otherwise backs (that's a bigger, separate tool nobody's asked for yet). Dashboard tile and nav both now point at it.

Everything else came back clean: all 31 pages present, every route wired both directions, no orphaned imports or duplicate declarations in any file touched across all four passes.

---

# Fifth pass — mobile-width audit

Checked by reading, not by loading a real phone — this environment can't run the actual dev server (no network to install anything). So this is a systematic sweep of the code for the patterns that actually cause the two things you described (content cut off, page sprawling sideways), not a substitute for opening it on a phone once it's deployed.

**What the sweep covered:**
- Every fixed pixel width in the codebase (`w-[...px]`, `w-64`/`w-72`/`w-80`+) — one real one, see below.
- Every `<table>` — all four already sit inside an `overflow-x-auto` wrapper.
- Every un-wrapped `flex` row that could contain long or variable-length content — the pre-existing code consistently uses the correct `min-w-0` (on the shrinking child) + `shrink-0` (on the fixed-size sibling, usually an image) pattern, e.g. the cart line-item rows. That pattern is *why* the existing pages hold up on narrow screens.
- Every `whitespace-nowrap` — only two, both deliberately inside horizontally-scrolling nav bars (the account tabs, the admin mobile nav), which is the correct place for it.
- The one `fixed`-positioned element in the whole app (the install-prompt sheet) — already responsive (`w-full max-w-md`), no fixed widths.

**One real regression, introduced this session:** adding the logo to the header (third pass) made the left side of the nav wider without checking whether the row still fit next to Bag/Log in on a narrow phone — the original code was careful about this (the install button already collapses to icon-only under `sm` specifically for this reason, per its own comment), and my addition didn't follow that discipline. Fixed: `min-w-0` on the brand link plus `truncate` on the name (so on the narrowest phones it degrades to "Majestic Ca…" instead of pushing Bag/Log in off-screen — a guarantee, not a hope), smaller logo and tighter gaps below `sm`, tighter padding on the Bag and Log in controls.

**One gap, pre-existing, not something that broke — something that was never finished:** the shop layout sets `viewport-fit: cover` (lets the installed PWA draw edge-to-edge, behind the notch/Dynamic Island) but nothing anywhere in the codebase pairs that with `env(safe-area-inset-*)` padding, which is the other half of that feature. Practically: on a notched phone with the app installed, the sticky header could sit under the status-bar cutout, and the bottom-anchored install sheet could sit behind the home-indicator gesture bar. Not a "content pushed off the side" bug like the header regression above, but the same family of "something real users have goes unaccounted for." Added `env(safe-area-inset-top)` padding to the header and `env(safe-area-inset-bottom)` to the install sheet; both resolve to `0` and do nothing on any non-notched or non-installed context, so this is a no-downside fix.

**One small polish fix**, low-risk either way: the admin mobile-recharge queue's reference-number input was a fixed `w-64` — harmless inside its `flex-wrap` row (never actually at risk of overflowing), but now `w-full sm:w-64` so it fills the row properly on mobile instead of sitting at a slightly odd fixed width with empty space beside it.

---

# Sixth pass — dashboard wiring + SEO

## Dashboard: one real gap, everything else already wired

Checked every link and every `api(...)` call the admin dashboard makes against the backend. All four queue tiles (Recharges, Orders, Withdrawals, Security alerts) and the two Stat cards with links resolve to real pages; all four of the dashboard's own data calls (`summary`, `commission-breakdown`, `top-earners`, `ledger-drift`) hit real endpoints.

**One thing genuinely missing, not just unlinked:** `DashboardService`/`CommissionService` has always had `distributeRoyalty(fundKey)` — the endpoint that actually pays a royalty fund's accumulated pool out to whoever currently qualifies — but nothing in `PlanEditor.tsx` ever called it. An admin could define royalty funds (name, qualification rule, pool percentage) and publish them as part of the plan, and that's where the trail ended: no visibility into what a fund had accumulated, no button to pay it out. The money had a rule for how to move and no way to actually move it.

Fixed: added `CommissionService.royaltyPoolBalances()` and `GET /admin/plan/royalty/pools` (what each published fund holds right now, in rupees, not just raw business volume), and a "Royalty pools" panel in the plan editor's sidebar — one row per fund, a balance, and a "Distribute now" button behind an inline confirm (this is irreversible real money leaving the company, so it doesn't fire on the first click). Also tightened the existing `distribute` endpoint's response to return a formatted amount (`{paise, display}`, matching every other money field in the console) instead of a raw BigInt-as-string, which is what it was returning to a frontend that had no code path that would ever have received it.

**Confirmed, not fixed, because it isn't a bug:** `DashboardService.dailySeries()` (`GET /admin/dashboard/series`) is real and complete but nothing renders it — there's no trend chart on the dashboard. Checked against the dashboard's own stated design philosophy in its file header ("ordered by what needs a decision, not by what is impressive") before deciding this is an intentional omission, not a missed connection: a revenue trend line is exactly the kind of thing that philosophy says to leave out. Left it alone; worth building only if you decide you actually want it.

## SEO

`lib/seo.ts`, `app/robots.ts` and `app/sitemap.ts` were already unusually thorough for this kind of build — robots.txt blocks aggressive SEO-tool crawlers by name, strips referral/tracking query strings from what gets crawled, and the sitemap pulls live from the catalogue rather than being a static list. Every one of the 31 pages has its own `buildMetadata()` call (none silently inheriting only the generic root defaults), heading hierarchy is clean (exactly one `<h1>` per page, including pages like `/about` that get theirs from the shared `PageHeader` component rather than writing their own), product images use the product name as alt text rather than being empty or generic, and structured data (`Organization`, `Product`, `FAQPage` and others) is already present across the pages that call for it.

**One real gap:** `/login`, `/signup`, and all four legal documents (`/legal/privacy-policy`, `/legal/terms`, `/legal/refund-policy`, `/legal/shipping-policy`) are indexable per `robotsFor()` — they're not in `PRIVATE_PREFIXES` — but none of them were in `sitemap.xml`. They were still discoverable (footer links to all of them), but a sitemap entry is a stronger, more direct discovery signal than hoping a crawler follows a footer link, and costs nothing to include. Added all six.

---

# Seventh pass — a real money bug, found by building the royalty UI

Building the "Distribute now" button in the sixth pass meant exercising `CommissionService.distributeRoyalty()` for what was, as far as I can tell, the first time it had ever been reachable from anywhere — it's existed since the original build, with a real endpoint, and simply had no caller. Reading it closely enough to build a UI in front of it surfaced something the previous read-only passes wouldn't have caught.

## 🔴 Double-payout race in royalty distribution

`distributeRoyalty` reads the fund's accumulated pool (`RoyaltyPool.accBvCenti`), pays it out to qualifying members, and resets it to `0` — all inside one `$transaction`, but the read was a plain `findUnique`, not a locked read. Two calls landing close together (two admins, or one admin double-clicking on a slow connection) could both read the same accumulated balance before either had reset it, and both would pay the full amount out. Same volume, two payouts, real money, to real members' income wallets.

This is exactly the class of bug this codebase's own `ledger.service.ts` documents as its first design principle — *"Wallet rows are taken with `SELECT ... FOR UPDATE`, always in [consistent order]"* — and exactly the pattern `commission.service.ts` already uses correctly a few functions away, for order commission runs (*"FOR UPDATE on the order makes two concurrent runs serialise"*). This one function just didn't have it. Fixed by locking the `RoyaltyPool` row (`SELECT "fundKey" ... FOR UPDATE`) before reading it, so a second concurrent call blocks until the first transaction commits, then correctly sees a pool of `0` and refuses with "has nothing to share yet" instead of paying out twice.

## Same bug shape, lower stakes, found by pattern-matching

Having just found that, I checked the codebase for the same shape elsewhere: "read whether one is already open, then create one" with no lock on the check. Found it in two more places — both pre-existing, one of them mine:

- **`withdrawal.service.ts`**: the "you already have a withdrawal in review" check (`findFirst` for a PENDING row, per member) had the same gap — two concurrent withdrawal requests from one member could both pass it.
- **`mobile-recharge.service.ts`** (built in an earlier pass this session): the equivalent "you already have a recharge in progress" check had the identical gap, because it was written by copying this exact pattern from withdrawal — bug included, since I copied the shape without checking whether the original was itself race-safe.

Neither of these can cause a double-spend beyond what's actually in the wallet — `ledger.service.ts`'s own wallet-row locking still catches that at the point money actually moves — so the worst case is two PENDING rows for one member instead of one, not money leaving that shouldn't. Lower severity than the royalty bug, but the same root cause, so fixed the same way: a Postgres advisory lock keyed by member id (`pg_advisory_xact_lock(hashtext(memberId))`), taken before the "is one already open" check in both services. An advisory lock rather than `FOR UPDATE` because there's no existing row to lock against on a member's *first* request — nothing to point `FOR UPDATE` at yet — and an advisory lock serialises on the member id itself instead. It's transaction-scoped, so it releases automatically on commit or rollback; nothing to remember to clean up.

**Not tested, because I can't verify a concurrency test here.** All three fixes are logically sound — traced through against how Postgres row locks and advisory locks actually behave, and cross-checked that the royalty fix correctly serialises against the *other* place that touches the same row (the BV-accrual increment elsewhere in `commission.service.ts` also takes an implicit row lock, so the two now correctly queue behind each other) — but a race condition is the one category of bug that's genuinely hard to be confident about without firing concurrent requests at a real database and watching what happens. Worth a deliberate concurrency test (two simultaneous `distribute` calls, assert only one payout) once there's a database in the loop to run it against, rather than a test I write here and cannot execute.

---

# Eighth pass — design system, and four new features

Requested directly: a design pass built around the logo rather than scattered across the site, plus four features (visual team tree, AI shade finder, distributor storefronts, rank progress/badges).

## Design system

`app/globals.css` was rewritten around CSS custom properties (`--ink`, `--body`, `--accent`, the gold scale, surface colours) instead of literal hex values. Every brand colour across 32 storefront files (450+ call sites, same set the sixth pass tokenised by hex) was swept from a hardcoded hex to the matching `var(--x)` — the admin console was left untouched on purpose, same reasoning as every earlier pass: it's a back-office tool, not a brand surface.

That's what makes the rest of this section possible in an afternoon instead of a rewrite:

- **Royal Night** — a dark theme (`:root[data-theme='night']` redefining the same tokens, warm browns and golds rather than blue-black so the gold stays metal rather than going muddy) toggled from the header, boot-scripted in `<head>` so it applies before first paint rather than flashing light-then-dark, remembered per device via `localStorage` rather than per account (a phone in bed and a shared desktop want different answers).
- **The mandala rule** (`components/MandalaRule.tsx`) — the dotted diamond border from the logo's seal, reduced to an SVG divider, used only between a page's major sections. Deliberately not used inside cards or lists — the restraint is what keeps it reading as a signature instead of wallpaper.
- **Gold foil** (`.gold-foil` in globals.css) — a `background-position` sweep on hover/focus, applied to every primary gold call-to-action (11 buttons across the storefront). Transition-based rather than a looping animation: something that glints once when you reach for it reads as material; something that pulses on its own reads as an advertisement.
- Checked by rendering a static mock of the header, hero and both themes before touching the real components — a colour-token sweep across 32 files is not something to eyeball into correctness after the fact.

## Rank progress and badges

`components/RankPanel.tsx`, replacing the plain rank block in `AccountView`. The logo's crown fills bottom-up in proportion to rank (capped visually at 5 crown-levels past which the difference stops being legible — the number beside it does the rest), and a rank-up triggers a one-time celebration banner. The celebration is a client-only `localStorage` comparison (previous rank index vs current), not a server flag — replays on every load would stop meaning anything, and a database write to acknowledge a UI animation is a lot of machinery for a small moment. Never fires on first load (a new member hasn't just achieved anything).

## Visual team tree

`components/NetworkTree.tsx`, replacing the flat "people you sponsored" list in `NetworkView`. No backend changes were needed — `GET /me/network/:childId` (branch expansion, checked against the caller's own subtree by ancestor-path prefix) already existed and had no caller, exactly the shape of gap the sixth and seventh passes kept finding elsewhere. The tree lazy-loads one branch at a time on expand and caches what it's already fetched; it still never requests the whole tree in one call, which was the deliberate constraint the original `/me/network` endpoint was built around.

## AI shade finder (Gemini, the client's own key)

As specified: the client supplies their own Google Gemini API key from the admin console; nothing is bundled.

- `backend/src/settings/settings.service.ts` — `StoreSetting` (key/value, already in the schema, never previously written to) now holds the key, encrypted at rest with the same `encryptField`/`decryptField` machinery a member's bank details use. The console can confirm a key ending in `…1a2b` is configured; it can never display the key again after saving it.
- `backend/src/shade-finder/shade-finder.service.ts` — the photo is never stored (decoded, sent to Gemini, discarded; no upload, no `imageUrl` column) and the model can't invent products: the prompt hands Gemini the real, current makeup catalogue by name and asks it to choose from that exact list, and anything in the response that isn't a verbatim match to a real product is dropped before it reaches the member.
- Rate-limited (5/hour/member, via the existing `RateLimitGuard`) because every call spends the client's own Gemini quota — a member-only endpoint still needed a cost guard here, unlike everywhere else that guard's been applied so far.
- `/admin/settings` (new nav entry) for pasting the key; `/shade-finder` for the member-facing upload, linked from the homepage's Explore grid. Photo is resized client-side (long edge capped at 640px) before it ever leaves the phone.
- If no key is configured, the endpoint returns a plain "ask an admin to add a Gemini key" message rather than an error — the rest of the site is unaffected either way, and a 401/403 from Google itself is reported as "not configured correctly" rather than surfaced raw, since that's almost always a bad or expired key, not a code bug.

## Distributor mini-storefronts

`majesticcart.in/mc/PRIYA123` — the same shop, behind a banner naming the member whose link it was. Deliberately thin: the storefront is the real, current catalogue (`listProducts`, the same function the homepage uses), not a second content system a member has to keep updated — there's no "pick your featured products" step, so there's nothing to fall out of date.

- `CatalogService.storefrontMember()` + `GET /catalog/storefront/:code` — public, and deliberately minimal: first name and code only, the same privacy discipline `view.service.ts`'s `network()` already applies to a downline list, extended to a page a stranger can load. Not-found and not-active return the identical 404, so the endpoint never confirms *which* of those two a code was.
- The referral cookie is set in `middleware.ts`, extended to recognise `/mc/:code` as an implicit referral code alongside the existing `?ref=` query param — not in the page itself, because a Server Component can only read cookies, and setting one is exactly the kind of thing that has to happen before the page renders. Unlike `?ref=`, `/mc/:code` doesn't redirect: it's already the canonical URL for that page.
- Added to `NOINDEX_FOLLOW_PREFIXES` in `lib/seo.ts`: every member's storefront is the same catalogue behind a different name, and indexing all of them as distinct pages is a duplicate-content problem multiplied by however many members share a link. Still fully crawlable and followable — just not each one competing to rank as its own page.
- Linked from the team page (`NetworkView`) alongside the existing `?ref=` link, framed as "better for a WhatsApp status or a bio link" — which is genuinely what it's for.

## Verified, same method as every earlier pass

Re-ran the full-repo brace/paren balance sweep (clean), the page-link cross-check (35 pages now, zero dangling internal links beyond the one pre-existing icon-asset false positive already noted in the sixth pass), and the frontend-to-backend API cross-check (80 backend routes now, every new frontend call matches one). Also cross-checked every `var(--x)` used in the four new feature components against what `globals.css` actually defines — the CSS-token conversion is exactly the kind of change where a typo'd variable name fails silently (renders, just with the wrong colour or none at all) rather than loudly, so this was checked explicitly rather than assumed.

**Not verified, same limitation as everywhere else in this document:** none of this has been run. No `npm install`, no dev server, no real Gemini API call, no visual check of the actual rendered pages beyond the static mockups built to sanity-check the palette and the two themes. Worth a full manual pass — both themes, the shade finder against a real Gemini key, a storefront link opened fresh with cookies cleared — before this goes live.

## Also worth knowing about, not changed

- **Manual UPI recharge** relies on an admin matching bank statements to
  submitted UTRs. The duplicate-UTR handling is solid, but this is a business
  process decision (no payment gateway), not a bug — flagging it again here
  only because it will not scale the way a bug fix would.
- **Signup does not enforce OTP verification** even though `AuthService.signup`
  accepts an optional `otpCode` and the signup form doesn't collect one. Not
  changed, since making OTP mandatory at signup is a product decision, not a
  fix to something broken — worth a deliberate call from whoever owns that
  flow.
