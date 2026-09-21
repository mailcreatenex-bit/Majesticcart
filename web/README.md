# Majestic Cart — storefront

Next.js 15 App Router. The public shop is statically generated; everything
behind the login renders in the browser against the API.

> **See `/AUDIT_FIXES.md` at the repo root.** The session/cookie proxy under
> `app/api/` (`lib/backend.ts`, `lib/session-shared.ts`) is new — it's what
> turns the API's JSON tokens into the httpOnly cookies this file's `api()`
> client already expected.

```bash
npm install
API_ORIGIN=http://localhost:3001 NEXT_PUBLIC_ORIGIN=https://majesticcart.in npm run build
npm run test        # 110 tests
npm run typecheck
```

`API_ORIGIN` has no `NEXT_PUBLIC_` prefix on purpose: catalogue fetches run on
the server during build and revalidation, so the API's internal address never
reaches the client bundle.

---

## The rule this site is built around

**Nobody can buy directly.** There is no card field, no netbanking, no payment
gateway, no cash on delivery. An order is paid from the shopping wallet or it is
not placed.

Money enters one way: the member pays by UPI to the account on the recharge
page, submits the UTR and a screenshot, and **an admin verifies it against the
bank statement** before a paisa is credited.

Almost every decision in `components/CheckoutView.tsx` and
`components/RechargeView.tsx` follows from that:

- The recharge button says **"Submit for approval"**, not "Add money". It does
  not add money; it asks someone to. A member who expects an instant credit and
  does not get one assumes the money is gone — and in an MLM that becomes an
  accusation within the hour.
- Checkout's interesting state is not "pay", it is **"not enough"**. A member
  who is ₹240 short gets a recharge link with ₹240 already filled in and comes
  back to a bag exactly as they left it. It is a two-tap detour, not a dead end.
- Pending recharges are shown **above** the form, because "where is my money" is
  the commonest support question and the answer is usually "still pending".
- A rejection carries its reason to the member. A rejection they cannot explain
  becomes a support call, then an accusation.

The shopping wallet **cannot be withdrawn as cash** — that separation is what
keeps a recharge a purchase of store credit rather than a deposit, and a deposit
taken by a company that is not a bank is a different business with a different
set of laws attached. Income moves into shopping; never the reverse.

---

## Pages

| Public (indexed) | |
|---|---|
| `/` | Home — hero, categories, featured, trust |
| `/shop` | Full catalogue |
| `/category/[slug]` | Category, with copy of its own |
| `/product/[slug]` | Product, JSON-LD, add to bag |
| `/join` | How membership works, and what it is not |
| `/faq` | FAQPage markup |
| `/about`, `/contact`, `/legal/[slug]` | |

| Behind the login (`noindex, nofollow, nocache`) | |
|---|---|
| `/cart`, `/checkout` | Bag and wallet-paid checkout |
| `/wallet`, `/wallet/withdraw`, `/recharge` | Statements, UPI recharge, payout |
| `/orders`, `/orders/[id]` | History, status, invoice |
| `/network` | Team counts, referral link |
| `/account` | Rank, volume, payout details |

A test walks `app/` and fails if a new route is neither classified public nor
matched by a private prefix — so a page shipped without `noindex` is caught by
existing rather than by someone remembering.

---

## Things worth knowing before you change something

**The cart never names its price.** It stores a display snapshot so a bag
restored a week later shows something, but checkout sends product ids and
quantities only, and the server prices the order. There is a test that
serialises the checkout payload and asserts no price appears in it.

**Storage is member-editable.** `readCart` drops a line whose price is not a
non-negative integer rather than repairing it — a repaired price is a wrong
price shown confidently.

**Amounts are parsed, not multiplied.** `parseRupeeInput` splits on the decimal
point and works in integers. `Math.round(Number(x) * 100)` lands a paisa off on
some two-decimal values, and on a wallet that funds every order the member
eventually notices.

**The state list is generated from the backend's table.** The delivery state
decides CGST+SGST versus IGST, and a name the backend cannot resolve falls back
to inter-state — so a state offered in the form but spelled differently would
quietly tax every order there the wrong way, with a correct-looking invoice. A
test compares the two tables.

**GST is inside the total, not added to it.** Indian prices are quoted
GST-inclusive, so the summary shows the total with "of which CGST + SGST"
indented underneath. Shown as its own line it reads as an extra charge.

**`export const revalidate` must be a literal.** Next cannot follow an imported
constant. The value is written out per page and a test holds it to
`CATALOG_REVALIDATE`.

**`/shop` has no URL filters.** Filters multiply into an unbounded crawlable
space of near-duplicates. Category pages carry the segmentation instead — a
fixed, small set, each in the sitemap with copy of its own.

**The team page shows no income.** Not the member's, not anyone else's, and no
contact details — only a first name, a member code and a status. The full list
of names and numbers is exactly the export a departing team lead would want.

---

## Also here

- **`SEO.md`** — indexing rules, the referral-URL trap, structured data, and
  why AggregateRating markup is withheld.
- **`PWA.md`** — installability, the 30-second prompt, why WhatsApp's in-app
  browser cannot install a PWA at all, and the service worker's never-cache
  list.
- **`lib/legal.ts`** — the four policy documents. They render with a visible
  draft banner and `assertLegalPagesReady()` fails the build until a lawyer has
  signed them off. That is deliberate.

---

## The admin console

Lives under `app/(admin)/`, in a **route group with its own root layout**, so it
does not inherit the storefront's header, footer, cart provider or PWA install
prompt. That is not cosmetic: a cart badge over an approval queue is a page that
can be mistaken for the shop, and the install prompt has no business appearing
over a payout.

| Page | What it does |
|---|---|
| `/admin` | Queues first, then solvency. Ledger drift sits at the top in red. |
| `/admin/recharges` | The approval queue the whole business waits on. |
| `/admin/orders` | Pack, ship, deliver. Delivery is what pays commission. |
| `/admin/withdrawals` | Record the bank transfer, or return the money. |
| `/admin/catalog` | Products, with the live BV/price economics check. |
| `/admin/plan` | The compensation plan, with the live payout ceiling. |

**Roles are presentation only.** Every admin route carries its own
`@AdminOnly(...)` on the server; the console hides what a role cannot use so
they don't make the trip. A test parses both the nav table and the API's
decorators and fails if they disagree in either direction — showing a FINANCE
user a plan editor that 403s on save is as wrong as hiding the recharge queue
from someone who can use it.

**The recharge queue does not pre-fill the amount.** The field starts empty and
the member's claim sits next to it for comparison. A pre-filled field is one
that gets accepted without being read, and the entire purpose of that screen is
that a person compared two numbers against a bank statement.

**The plan editor shows the payout ceiling live.** The arithmetic is checked
against the server's own `payoutExposure` by a backend test, across every mode
combination — a console that disagrees with the validator is worse than one
showing nothing, because it either blocks a plan that would publish or approves
one that will be refused.

---

## Not built yet

- Search (`/search` is reserved as `noindex, follow`).
- Member management in the console (status changes, notes) — the API routes
  exist; the screen does not.
- The report builder UI. `ReportBuilder.jsx` is the prototype; the API's
  `/reports` routes are built and tested.
- Real product photography and the real UPI QR.
