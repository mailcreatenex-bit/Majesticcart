# Majestic Cart — API

NestJS + PostgreSQL + Prisma + BullMQ. Read `ARCHITECTURE.md` before changing
anything in `src/ledger`, `src/commission` or `src/plan` — those three carry the
decisions that are expensive to reverse.

## Running it

```bash
cp .env.example .env          # fill in JWT_SECRET and OTP_PEPPER
openssl rand -base64 48       # generate each of them

docker compose up -d          # postgres, redis, minio
npm install
npx prisma migrate deploy
psql "$DATABASE_URL" -f prisma/migrations/0002_constraints/migration.sql
npm run seed -- --demo        # catalogue + a 40-member network with a year of orders
npm run start:dev
```

`npm run seed` without `--demo` does bootstrap only — company root, one admin,
plan version 1, settings and the catalogue. That is what runs on a first
production deploy.

Demo logins are printed at the end of the seed.

> **See `/AUDIT_FIXES.md` at the repo root** for what changed in the last
> audit pass — including one item (the missing `0001` migration) that was
> deliberately left for you to generate against a real database rather than
> guessed at here.

## Scripts

| Command | What it does |
|---|---|
| `npm run start:dev` | API with reload |
| `npm run seed` | bootstrap only, safe against production |
| `npm run seed -- --demo` | bootstrap plus demo network; refuses if `NODE_ENV=production` |
| `npm test` | unit tests, no database needed |
| `npm run test:integration` | concurrency tests against a real Postgres; needs `DATABASE_URL` |
| `npm run loadtest` | commission engine against a 10,000-member tree; needs `DATABASE_URL` |
| `npm run typecheck` | `tsc --noEmit` |

## Things that will bite you

**`TZ=Asia/Kolkata` on every process.** The monthly repurchase gate reads the
calendar month. A container on UTC puts an order placed at 11pm IST on the 30th
into the next month, and a member who met their target is told they did not.

**`app.set('trust proxy', 1)` behind a load balancer.** Already in `main.ts`.
Without it every fraud signal, rate limit and audit row records the proxy's IP
instead of the member's.

**Run migration `0002_constraints` by hand.** Prisma generates none of it. It
carries the partial unique index enforcing one approved credit per UTR — the
single most important control in the platform, since there is no payment gateway
callback and the UTR is the only thing tying a claim to money that arrived.

**Never write to `Wallet` outside `LedgerService`.** There is a test that proves
the reconciliation query catches it when you do. Run
`GET /api/admin/dashboard/ledger-drift` nightly. It should always return an
empty list; anything else is an incident, not a report.

**`FIELD_ENCRYPTION_KEY` is required.** Payout accounts, UPI IDs and admin TOTP
secrets are encrypted at rest and the app refuses to boot without it. Generate
with `openssl rand -base64 32`. To rotate: set the new key, move the old one to
`FIELD_ENCRYPTION_KEY_V1`, deploy, run `npx ts-node prisma/backfill-encryption.ts`.

**Money is `bigint` paise everywhere.** Floats are banned in the money path.
`src/common/money.ts` is the only place scales convert.

## API shape

All routes under `/api`. Protected by default — a route is locked unless it
carries `@Public()`.

```
POST   /api/auth/otp                     request a one-time code
POST   /api/auth/signup                  create an account
POST   /api/auth/login                   password login
POST   /api/auth/login/otp               OTP login
POST   /api/auth/reset                   reset password
POST   /api/auth/refresh                 rotate the refresh token
POST   /api/auth/logout

POST   /api/orders/quote                 price a bag before placing it
POST   /api/orders                       checkout
POST   /api/orders/:id/cancel

GET    /api/me                           dashboard: rank, wallets, volume, team
GET    /api/me/address                   saved delivery address, or null
GET    /api/me/payout                    payout details, masked
PATCH  /api/me/profile
PATCH  /api/me/address
PATCH  /api/me/payout
GET    /api/me/wallet/:kind              statement (shopping | income), paged
GET    /api/me/recharges                 recharge history and status
GET    /api/me/orders                    order list, paged
GET    /api/me/orders/:id                one order, scoped by caller
GET    /api/me/network                   team counts per level + directs
GET    /api/me/network/:childId          expand one branch
GET    /api/me/notifications
POST   /api/me/notifications/read

GET    /api/wallet/pay-info              UPI ID + server-rendered QR
POST   /api/wallet/upload-ticket         presigned screenshot upload
POST   /api/wallet/recharge              submit payment proof
GET    /api/wallet/withdrawal/quote      deduction and repurchase status
POST   /api/wallet/withdrawal

GET    /api/reports/catalog              field picker for the report builder
GET    /api/reports/:key                 run a report, scoped by caller
POST   /api/reports/preview              run an unsaved definition
PUT    /api/reports/:key                 save a definition
DELETE /api/reports/:key

GET    /api/admin/recharges              review queue
GET    /api/admin/recharges/:id/screenshot   short-lived signed URL
POST   /api/admin/recharges/:id/approve
POST   /api/admin/recharges/:id/reject
POST   /api/admin/orders/:id/status
POST   /api/admin/orders/:id/return      reverses commission; ADMIN only
POST   /api/admin/withdrawals/:id/paid
POST   /api/admin/withdrawals/:id/reject
GET    /api/admin/plan                   current plan + payout exposure
POST   /api/admin/plan/preview           cost a change before saving
POST   /api/admin/plan                   publish a new version
POST   /api/admin/plan/royalty/:key/distribute
GET    /api/catalog/products             public product list
GET    /api/catalog/product/:slug        public product page
GET    /api/catalog/categories
GET    /api/catalog/sitemap              feed for the Next.js sitemap
GET    /api/invoices/order/:id/html      member's own GST invoice
GET    /api/admin/catalog/products       includes inactive
POST   /api/admin/catalog/price-check    cost a product's BV before saving
POST   /api/admin/catalog/products
PUT    /api/admin/catalog/products/:id
PATCH  /api/admin/catalog/products/:id/active
POST   /api/admin/catalog/products/:id/stock   delta, never an absolute set
GET    /api/admin/dashboard              headline figures
GET    /api/admin/dashboard/ledger-drift reconciliation; must be empty
```

Roles: `ADMIN` can do everything. `FINANCE` approves payments and payouts but
cannot rewrite the plan — FINANCE approving a payment wrongly is recoverable,
FINANCE setting self income to 90% is not. `SUPPORT` handles orders.

## Reads are scoped in the WHERE clause, not after the fetch

Every method in `MemberViewService` takes the caller's id from the access token
and puts it in the query, rather than fetching a row and then checking who owns
it. There is no route under `/api/me` that accepts a member id from the URL or
the body, so there is no route that can be pointed at someone else's data by
editing a value.

`GET /api/me/orders/:id` is the shape to copy: the order id and the member id
are both in the `WHERE`, so "not yours" and "does not exist" are the same 404
with the same timing.

Everything is paged, with the page size capped server-side. A member with
10,000 people below them cannot ask for all of them, and neither can their
browser by accident.

## Money and volume on the wire

`bigint` does not survive `JSON.stringify`, so money leaves as a decimal string
and arrives as one. `parseMoneyInput()` rejects a JSON number outright: a rupee
value that has been through a JS float is already possibly wrong and nothing in
the value says so.

```json
{ "total": { "paise": "59950", "amount": "599.50", "display": "₹599.50" } }
```

## What is not built yet

- React Native mobile apps (Phase 2), and the Play/App Store submissions. The
  web app installs as a PWA in the meantime — see `web/PWA.md`.
- nightly cron wiring for `ledger-drift` and `TokenService.purgeExpired()`
- DLT registration and a real SMS provider behind `SmsSender`
- the admin console UI. Every admin route above is built and tested; the
  console itself is still the prototype in `MajesticCart.jsx`.

## Before this can go live

These are not code. They block launch and none of them can be resolved from
this repository:

- [ ] The four open plan questions answered by the client (team commission mode, direct-income basis, which ranks earn the generation bonus, Diamond's team %). Every variant is implemented and switchable; the client has to choose.
- [ ] Legal review of the compensation plan by a lawyer who knows Indian direct-selling law — particularly if the client wants the wallet-recharge commission basis, which pays on deposits rather than product sales.
- [ ] Entity details: registered legal name, CIN, GSTIN, registered address, and a named grievance officer.
- [ ] Policy numbers: return window, buy-back percentage and window, delivery timelines. Run `auditAll()` in the web package for the itemised list.
- [ ] Lawyer sign-off on all four policy documents. They currently render with a visible draft banner and `assertLegalPagesReady()` fails the build — that is deliberate.
- [ ] HSN codes confirmed by the client's CA. The list in `catalog.service.ts` is a convenience, not advice.
- [ ] The real UPI QR uploaded, and real product photography.

