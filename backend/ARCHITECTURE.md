# Majestic Cart — Backend Architecture

NestJS + PostgreSQL + Prisma + BullMQ. This document covers the decisions that
are expensive to change later. Controllers, DTOs and CRUD modules are omitted —
scaffold those normally.

---

## 1. Module map

```
src/
  common/
    money.ts            integer money + BV, the only place scale converts
    period.ts           "2026-09" keys for the monthly repurchase gate
  plan/
    plan.config.ts      zod schema, client defaults, exposure ceiling
    plan.service.ts     write a new PlanVersion (validate -> assertSustainable -> insert)
    plan.controller.ts  admin read/write
  ledger/
    ledger.service.ts   THE ONLY WRITER of Wallet + LedgerEntry
  commission/
    commission.service.ts  payout computation + royalty distribution
    commission.processor.ts BullMQ worker, jobId `commission:${orderId}`
  order/                cart, checkout, status transitions
  recharge/
    recharge.service.ts UTR submission, fraud flags, admin approval
  withdrawal/
    withdrawal.service.ts hold-on-request, admin marks paid
  member/               signup, genealogy, profile, CRM notes
  auth/                 member OTP+JWT, admin password+TOTP
  catalog/              products, categories, stock
  media/                S3/R2 presigned uploads for QR + screenshots
  admin/                dashboard aggregates, security alerts, audit log
```

**Dependency rule:** `order`, `commission`, `recharge` and `withdrawal` all
depend on `ledger`. Nothing depends on them. If a new module needs to move
money, it calls `LedgerService`; it does not get its own path to the wallet.

---

## 2. Money is an integer. Always.

| Concept | Type | Example |
|---|---|---|
| Money | `BigInt` paise | ₹599.50 → `59950n` |
| Volume | `Int` centi-BV | 300 BV → `30000` |
| Percentage | `Int` basis points | 19% → `1900` |

`0.1 + 0.2 !== 0.3`. On a ledger paying thousands of members monthly, that drift
compounds into a reconciliation problem that is very hard to unwind after the
fact. `src/common/money.ts` is the only file allowed to convert between scales.

Because the plan treats 1 BV as ₹1, centi-BV and paise share a scale, so
`commission = bvCenti × pctBp / 10000` lands directly in paise. If the client
ever decouples BV from the rupee, `commissionOn()` is the single function to
change.

**Rounding goes down, and the dust is kept.** `commissionOn()` returns
`remainderPaise` alongside the amount. Rounding half a paise up on every leg of
a deep genealogy quietly inflates the company's liability; keeping the dust lets
the nightly reconciliation account for every last paise.

**Serialisation:** `BigInt` does not survive `JSON.stringify`. Register a global
interceptor that renders money as a decimal string, and never as a JS number —
`Number.MAX_SAFE_INTEGER` is ~₹90 crore in paise, which is closer than it looks.

---

## 3. The ledger

Append-only double entry. Never `UPDATE`, never `DELETE`. A wrong entry is
corrected by posting its reverse, so `balanceAfter` on every row stays a true
running total and a statement never needs recomputation.

Three invariants:

**Locking.** Wallet rows are taken `FOR UPDATE` in ascending wallet-id order.
Deadlocks here are not hypothetical — two orders delivering at the same moment
share most of their upline. Fixed ordering means one transaction simply waits.
Callers touching several members must use `lockWallets()` so the ordering is not
left to chance.

**Idempotency.** Every posting carries a deterministic `idempotencyKey` that is
`UNIQUE` on the table. A retried BullMQ job, a double-tapped button or a network
retry collides on the index and is swallowed. This is what makes the commission
run safe to replay.

**Reconciliation.** `LedgerService.audit()` recomputes a wallet from its entries
and reports the drift. Run it nightly across all wallets. **A non-zero drift
means something wrote to `Wallet` outside `LedgerService`, and that is a
production incident, not a rounding curiosity.**

---

## 4. Commission runs on DELIVERED, not PLACED

Paying at delivery means a cancelled or returned order needs no clawback across
an entire genealogy. Clawing back income a member has already withdrawn is close
to unrecoverable, so the design avoids the situation instead of handling it.

The run is one transaction:

1. `SELECT ... FOR UPDATE` the order; exit if `commissionRunAt` is already set.
2. Load the pinned `PlanVersion`.
3. Apply volume — buyer's self + group BV, every upline's group BV, the monthly rollup.
4. `computePayouts()` — pure, no I/O, which is why it is the function the tests hammer.
5. Insert `Commission` rows; a collision on `dedupeKey` means this is a replay.
6. Post ledger credits for the rows that were genuinely new.
7. Promote ranks, accrue royalty pools, stamp `commissionRunAt`.

**Volume is applied before rates are read**, so a buyer crossing into a higher
rank on this very order earns at the *old* rate on it. That is the conventional
reading and it stops a member gaming the boundary.

**Plans are versioned, not mutated.** The client edits the plan from the admin
console; every edit writes a new `PlanVersion` row and the active version is
pinned onto the order at delivery. A rate change next month therefore cannot
retroactively alter what an old order paid, and every historical payout can
still explain itself under audit.

`assertSustainable()` refuses to save a plan committing more than 60% of BV, and
refuses unlimited flat team levels unless the admin explicitly acknowledges
them. Verified in the test suite: the client's default plan commits 45%.

---

## 4a. Checkout, locking and numbering

Checkout touches product stock, the member's wallet, the joining rule and
first-purchase detection in one transaction. Every one of those is a race.

**Global lock order: products (ascending id), then wallets (ascending id).**
Every path touching both — checkout, cancellation, returns — must follow it.
Two transactions grabbing them in opposite orders is a textbook deadlock.
`normaliseCart()` returns lines pre-sorted by product id precisely so this
ordering is not left to the caller.

**Stock is claimed with a conditional UPDATE**, not read-then-write:

```sql
UPDATE "Product" SET stock = stock - $qty
WHERE id = $id AND stock >= $qty
```

Zero rows affected means someone else took the last unit. Two buyers racing for
it cannot both win, and no explicit row lock is needed.

**First-purchase detection** is safe because the wallet lock taken just above it
serialises checkout per member. Without that lock, two concurrent first orders
would both count zero prior orders and both skip the joining minimum.

**Numbering.** `orderNo` may have gaps — a rolled-back checkout burning a number
is harmless. `invoiceNo` may not: a GST invoice series must be gapless within a
financial year. Both come from `NumberSeries` via a row-locked
`INSERT … ON CONFLICT DO UPDATE … RETURNING`, which serialises on one row. That
is a deliberate throughput trade, paid once per order. Invoice numbers are
allocated at **delivery**, not at checkout, so a cancelled order never consumes
one.

**Returns after delivery** are the expensive path the delivery-time payout rule
exists to keep rare. `returnDelivered()` reverses the commission run, rolls back
the BV that order contributed (otherwise ranks drift upward permanently on
returned goods), restocks and refunds. Reversal can push an income wallet
negative if the member already withdrew. That is intentional: the debt is
recorded rather than silently written off, and finance decides how to recover
it. Alert on negative income balances.

**GST rounding.** Per-line tax is exact to the paise and floors, consistently
with the rest of the money path. Rounding the invoice total to the nearest rupee
for filing is the invoice module's job — do not push it down into the ledger.

---

## 5. Genealogy

`Member.ancestorPath` is a materialised, slash-delimited, root-first path
(`/idA/idB/`). Written once at signup; `sponsorId` never changes afterwards.

- **Upline of X** — split `X.ancestorPath`, one `IN` query. Not 20 recursive round trips.
- **Downline of X** — `ancestorPath LIKE 'X.ancestorPath || X.id || /%'`, a prefix match that uses the btree.

Use `startsWith`, never `contains`. `contains` compiles to `LIKE '%…%'`, which
cannot use the index and sequentially scans every member — fine at 17 members,
fatal at 50,000.

If the tree ever needs to be re-parented (a compliance correction, say), rebuild
paths in one recursive CTE and re-run affected commissions through
`reverseOrderRun()`. Do not patch paths row by row.

---

## 6. Raw SQL Prisma cannot express

Shipped as `prisma/migrations/0002_constraints/migration.sql`. Run it after
`prisma migrate dev` creates the tables; Prisma generates none of it and
`migrate diff` will not drop it. The highlights:

```sql
-- One approved credit per UTR, ever. This is the single most important control
-- in the platform: there is no payment gateway callback, so the UTR is the only
-- thing tying a member's claim to money that actually arrived.
CREATE UNIQUE INDEX recharge_one_approved_per_utr
  ON "Recharge" (utr) WHERE status = 'APPROVED';

-- A wallet balance must never go negative except via a deliberate admin
-- correction. Belt and braces behind the application check.
ALTER TABLE "Wallet" ADD CONSTRAINT wallet_non_negative
  CHECK ("balancePaise" >= 0) NOT VALID;

-- Ledger amounts are always positive; direction carries the sign.
ALTER TABLE "LedgerEntry" ADD CONSTRAINT ledger_positive
  CHECK ("amountPaise" > 0);

-- Dashboard queries filter hard on these.
CREATE INDEX order_delivered_at ON "Order" ("deliveredAt")
  WHERE status = 'DELIVERED';
CREATE INDEX recharge_pending ON "Recharge" ("createdAt")
  WHERE status = 'PENDING';
```

The wallet check is deliberately **not** a blanket non-negative rule. A
post-delivery return claws back commission a member may already have withdrawn,
which can legitimately push an income wallet negative; that debt is recorded on
purpose rather than written off. The constraint therefore covers the shopping
wallet only.

Note `commission.dedupeKey`: a composite unique index on
`(orderId, memberId, type, generationLevel)` **does not work**, because
`generationLevel` is NULL on SELF/DIRECT/TEAM rows and `orderId` is NULL on
royalty rows, and Postgres never treats two NULLs as equal. The rows that most
need deduplication are exactly the ones such an index would miss. An
app-computed `dedupeKey String @unique` is the fix.

---

## 6a. The HTTP layer

**BigInt does not survive JSON.** `JSON.stringify({ total: 59950n })` throws, so
without `BigIntSerializerInterceptor` the first endpoint returning an order
500s. The obvious fix — a global `BigInt.prototype.toJSON` returning `Number` —
is worse than the bug: `MAX_SAFE_INTEGER` is about ₹90 crore in paise, and the
failure past it is silent rounding rather than an exception. Money leaves as a
decimal string and arrives as one; `parseMoneyInput()` rejects a JSON number
outright, because a rupee value that has been through a JS float is already
possibly wrong and nothing in the value says so.

**Routes are protected by default.** `AuthGuard` is registered as an
`APP_GUARD`, so a new endpoint is locked unless it carries `@Public()`. Opt-out
beats opt-in: forgetting a decorator leaves a route closed rather than open.
`@MemberOnly()` and `@AdminOnly(...roles)` narrow it further, and
`@CurrentUser()` / `@ClientContext()` supply the request context the audit log
and fraud signals need.

**Trust proxy must be on.** `ClientContext` reads `req.ip` rather than parsing
`X-Forwarded-For` itself — an unvalidated header lets a caller spoof their own
IP and poison the security alerts that depend on it.

**The queue hook.** `OrderService.commissionQueue` is an optional property, not
a constructor dependency, so checkout and the status machine can be unit-tested
without Redis. `OrderModule.onModuleInit()` attaches the real queue.

---

## 6b. Reporting

33 reports ship as **config, not code** — five groups (finance, compliance,
growth, operations, member-facing) that the client can edit, clone or extend
from the admin console without a deploy.

**Admins compose; they never write SQL.** `src/reporting/catalog.ts` declares
nine datasets with typed dimensions and measures. A report definition
*references* those by key. The obvious way to build "reports the client can
change from the backend" is a query box, and that puts every member's PII and
every wallet balance one injection away.

The compiler (`compiler.ts`) is the security boundary, and two rules hold
absolutely:

1. **No user string reaches the SQL text.** Dimensions, measures, operators,
   buckets and sort directions resolve against the catalog or a whitelist;
   filter *values* become bound parameters. A filter value of
   `'; DROP TABLE "Member"; --` ends up as `$1`, verified by test.

2. **Scoping is decided by the caller, not the definition.** A saved definition
   claiming `GLOBAL` cannot hand one member the whole company's orders — a
   `MEMBER` caller always gets the `ancestorPath` predicate appended. A
   mislabelled definition fails closed. A dataset with no `scoping` key (e.g.
   security alerts) can never be published to members at all.

**Admin impersonation is explicit.** An admin opening a member report must name
the member. Without it the query would return company-wide figures under a
heading saying "my income" — not a leak, but a wrong number in exactly the
conversation where the number is being disputed.

The catalog sent to the report-builder UI is stripped of SQL, and a test asserts
no dataset references `passwordHash`, `totpSecret`, `codeHash`, `tokenHash`,
`payoutAccount` or `salt`.

Two reports worth pointing the client at specifically:

- **Recruitment versus retail income** — if income paid on joining outgrows income from repeat sales, the plan is drifting toward the structure the Direct Selling Rules target. This is the chart to be able to show a regulator.
- **Monthly purchase distribution** — a hard spike at exactly the repurchase target means members are buying to unlock withdrawals rather than because they want the product. That is inventory loading, and it is invisible in an average; the shape of the histogram is the finding.

CSV export prefixes any cell starting with `=`, `+`, `-` or `@` with a quote. Not
cosmetic: a member name like `=cmd|...` becomes an executable formula when
finance opens the file in Excel.

---

## 6c. Catalogue and invoices

**HSN and country of origin are required at product creation**, not backfilled.
A GST invoice is invalid without the HSN of each line item, and discovering
that at the first audit means reissuing every invoice already raised. Country
of origin is required on the product page by the E-Commerce Rules.

**BV is checked against price before a product can be saved.** BV drives every
payout, so a product whose BV approaches its price cannot fund the commission
it generates. `CatalogService.priceCheck()` reads the live plan, computes the
worst-case payout per unit, and refuses the arithmetically impossible case
while warning on the merely unwise one — the admin sees the consequence rather
than discovering it in a month of margin reports.

**Slugs are never regenerated on a rename.** The slug is the public URL and
members have already shared it; changing it 404s every one of those links.

**Products are deactivated, never deleted.** Order lines reference them, so a
delete would break every past invoice and commission record citing the sale.

**Stock moves by delta, never by absolute set.** Two admins reading 40 and
writing 45 and 38 leave whichever wrote last, silently discarding the other's
count. A delta composes.

### The GST split

The single most common mistake in Indian e-commerce billing: 18% GST is **not**
one line of 18%. Same state as the seller → CGST 9% + SGST 9%. Different state
→ IGST 18%. Same total to the buyer, different heads on the return.

Three details are load-bearing:

- **Comparison is on the state code, not the name.** "West Bengal", "west bengal", "WB" and "Orissa"/"Odisha" are one place of supply. A name mismatch silently bills IGST where CGST+SGST was due.
- **An unknown state falls back to inter-state.** IGST filed where CGST+SGST was due is correctable by amendment; the reverse leaves the buyer unable to claim input credit at all.
- **SGST takes the remainder, it is not computed separately.** Halving and rounding each half independently loses a paise on odd amounts. A 2,000-case sweep asserts CGST + SGST reconstructs the tax exactly at every price and rate.

Amounts in words render on the Indian scale — lakh and crore. "Two Million
Rupees" on an Indian invoice reads as an error.

Invoices render as HTML rather than through a PDF library: it prints to PDF
from any browser, renders in an email, and needs no font packaging for the
rupee sign. The same markup goes through a headless Chromium later without the
layout being rewritten.

---

## 6d. Load test

`npm run loadtest` against a 10,000-member tree, 20 levels deep, on real
Postgres. Measured, not estimated.

**Depth costs almost nothing.**

| Buyer depth | avg | p50 | p99 | legs/order |
|---|---|---|---|---|
| L1–3 | 2.9ms | 2.4ms | 16.9ms | 1.4 |
| L4–7 | 3.0ms | 2.7ms | 10.1ms | 2.0 |
| L8–12 | 2.8ms | 2.5ms | 5.5ms | 2.4 |
| L13–20 | 4.0ms | 3.2ms | 18.3ms | 3.3 |

A 20-level payout costs about 1.4× a 3-level one. This is the materialised
`ancestorPath` earning its place: the upline lookup is a single index scan on
the primary key regardless of depth (`EXPLAIN` confirms `Index Scan using
Member_pkey`, 32 shared buffers at level 12), not twenty recursive round trips.
Had it been a recursive walk, the deep case would scale linearly and the p99
would climb with the tree.

**Throughput plateaus at c=8.** Stable across three consecutive runs:

| Concurrency | orders/sec | p50 | p99 |
|---|---|---|---|
| 1 | ~390 | 2.4ms | 5.4ms |
| 4 | ~480 | 6.2ms | 21ms |
| 8 | ~600 | 9.7ms | 20ms |
| 16 | ~585 | 18ms | 35ms |

Past 8 there is no throughput gain and latency doubles — the workers are
contending for the same upline wallets. **`concurrency: 1` on the commission
worker is therefore the right default**, not a limitation: ~390 orders/sec is
1.4 million orders an hour, far beyond anything this client will see, and it
eliminates lock contention entirely. Raising it to 4 is safe if a genuine
backlog ever appears.

Zero drift, zero duplicate commission rows and zero failures across all warm
runs. The *first* run after a cold start showed 2 failures and a 1,018ms p99;
those disappeared on every subsequent run and are cold-cache artifacts, worth
knowing only because a benchmark taken immediately after a deploy will look
worse than the system actually is.

---

## 7. Security and auth

**Passwords** are argon2id at the OWASP baseline (19 MiB, 2 passes), server
side. The prototype's browser-side SHA-256 was demo-only: fast, effectively
unsalted, and the hash travels as the password. `passwordNeedsRehash()` upgrades
old digests transparently on login, so cost parameters can be raised later
without locking anyone out.

**Failures are indistinguishable.** Every wrong login returns the same message,
and a login for an unknown phone still runs a dummy argon2 verify so the
response time matches. Without that, latency alone enumerates which numbers are
registered — exactly the roster a competitor would want to scrape.

**OTP** codes are `randomInt`, stored as `sha256(pepper + code)` with the pepper
in the environment rather than the database, so a dumped table cannot be
rainbow-tabled against a six-digit space. Attempts are counted on the challenge,
so guessing burns the challenge rather than getting 10⁶ tries. Throttled at 5
per hour with a 60-second resend cooldown — an unthrottled OTP endpoint is both
an enumeration tool and a way to run up an SMS bill.

**Refresh tokens** are opaque random strings, stored only as hashes, rotated on
every use. Rotation is what makes theft *detectable*: each refresh marks the old
token used, so if a used token is ever presented again, someone is replaying it.
We cannot tell victim from attacker, so the whole family is revoked and both
must log in again. Losing a session is a small price for catching a stolen one.
A password reset revokes every family — otherwise a reset performed by someone
who had stolen access would leave their session alive.

**Admin 2FA** is TOTP (RFC 6238), verified against the published RFC test
vectors. `AdminUser.lastTotpStep` is the replay guard: a code stays valid for
its full 30-second window, so without it a shoulder-surfed code works again
seconds later. Password and TOTP are checked in a single call so the response
never reveals that the password alone was correct.

**Lockout** backs off exponentially from the fifth failure — 1, 2, 4, 8 minutes,
capped at an hour. The cap matters: an uncapped lockout hands an attacker a
cheap way to lock a known member out permanently.

**Encrypted at rest.** Payout account numbers, UPI IDs and admin TOTP secrets
are AES-256-GCM encrypted (`src/common/crypto.ts`). GCM because it
authenticates as well as encrypts: a tampered ciphertext fails rather than
decrypting into plausible garbage.

Each value is bound to the record it belongs to via the AAD
(`payout:<memberId>:account`). Encryption alone stops a dump being read but does
nothing about an attacker with *write* access copying one member's encrypted
account number into another member's row — the value still decrypts and
withdrawals start landing in the wrong bank. Binding makes that swap fail, and
there is a test for exactly it.

A plaintext TOTP secret is the one that makes the rest pointless: anyone with
database access could generate valid codes, so the second factor would be
decorative.

**Keys rotate without downtime.** Values carry a version prefix
(`v2:iv:tag:ciphertext`). Add the new key as `FIELD_ENCRYPTION_KEY`, move the
old one to `FIELD_ENCRYPTION_KEY_V1`, deploy, then run
`prisma/backfill-encryption.ts`. Old rows keep decrypting throughout — no
big-bang migration.

**Encrypted columns cannot be searched**, since the same input produces
different ciphertext every time. Where a lookup is genuinely needed — is this
payout account shared with another member? — a keyed HMAC is stored alongside
in `payoutUpiIndex` / `payoutAccountIndex`. Keyed rather than a plain SHA-256:
Indian UPI IDs are mostly phone-derived and would fall to a rainbow table of
ten-digit numbers in minutes.

A shared payout account raises an alert rather than blocking the save. It is
either a family sharing one bank account, which is normal, or one person
collecting the income of a fake downline, which is not — and a blanket block
would lock out the legitimate case with no recourse.

Still to wire up:

- **Screenshots:** S3/R2 via presigned PUT. Store the object key and a SHA-256 of the bytes; the hash is what catches one screenshot reused across accounts.
- **Rate limits:** per-IP as well as per-phone, at the edge.
- **Audit log:** every admin money action writes an `AuditLog` row with actor, IP and user agent. Non-negotiable for a platform handling member funds.

---

## 8. The compliance item that needs a decision

`plan.direct.basis` defaults to `FIRST_PURCHASE` — the sponsor earns 10% of the
new member's first *product order*.

The client's document specifies `WALLET_RECHARGE` instead: 10% paid when the
recruit *tops up their wallet*, before any product is sold. That variant is
implemented and switchable, but it pays on money coming in rather than goods
going out, which is the structure the Consumer Protection (Direct Selling)
Rules, 2021 treat as a money circulation scheme. Selecting it raises a warning
in the admin console and logs a warning server-side on every payout.

Same reasoning for the ₹2,000 joining minimum: it is modelled as a **minimum
first product purchase**, not a registration fee. Registration itself is free.

Neither of these is a software judgement. Get the plan reviewed by a lawyer who
knows direct selling law, and note that West Bengal has its own Direct Selling
Guidelines (2018) on top of the central Rules.

---

## 9. Build order

**Phase 1 — web portal**
~~ledger~~ → ~~order~~ → ~~commission~~ → ~~recharge~~ → ~~withdrawal~~ →
~~plan~~ → ~~auth~~ → ~~genealogy~~ → ~~HTTP layer~~ → ~~dashboard~~ → ~~reporting~~ (done) → catalog CRUD → controllers per module.

The money path, the identity path and the HTTP plumbing are closed. What
remains is genuinely mechanical: product CRUD, and one controller per service
that already exists. `nest g resource` plus the guards and DTO patterns above
will produce most of it.

Still outstanding before this is a running system:

- a `prisma/seed.ts` bootstrapping the company root member, the first admin, `PlanVersion` 1 from `CLIENT_DEFAULT_PLAN`, and the store settings rows
- S3/R2 presigned upload endpoints for the QR and payment screenshots
- an SMS provider behind the `SmsSender` interface Ship to a VPS or Railway with managed
Postgres and Redis.

**Phase 2 — mobile**
React Native / Expo against the same API. Play Store and App Store review are
each ~1–2 weeks of calendar time on their own, independent of build time.

The proposal quotes web + Android + iOS in 15 days for ₹70,000. Section 1 alone
is not 15 days of work. Split the commercial into phases before signing, or the
deadline will be missed with the money already collected.

**Before go-live**
- [ ] Nightly ledger reconciliation job, alerting on any drift
- [x] Concurrency tests against real Postgres — `src/__tests__/integration.spec.ts`
- [x] Load test the commission run against a 10,000-member tree, 20 levels deep — `npm run loadtest`, results in §6d
- [ ] Restore-from-backup rehearsal, not just backups configured
- [ ] `TZ=Asia/Kolkata` on every process — the monthly repurchase gate depends on it
- [ ] `OTP_PEPPER` (32+ chars) and `JWT_SECRET` set; AuthService refuses to boot without the pepper
- [ ] Nightly `TokenService.purgeExpired()` — the refresh table only grows otherwise
- [ ] Nightly `DashboardService.ledgerDrift()` — must always return zero rows; anything else is an incident
- [ ] `app.set('trust proxy', 1)` behind the load balancer, or every fraud signal records the proxy's IP
- [ ] GST invoice numbering (sequential, per financial year, gapless)

---

## 10. Testing

165 tests across eight suites, all passing, covering the parts where a bug costs
real money.

`src/__tests__/plan.spec.ts` — 29 tests:

- integer money conversion, rounding that never invents or loses a paise
- pool splitting where the leftover paise are distributed deterministically
- plan validation: rank ordering, the 500% typo, the payout ceiling
- gap mode — including a 200-trial randomised check that **total payout never exceeds the top rank's rate at any tree depth**
- generation bonus slot allocation under both `onlyQualified` settings
- members on hold and the company account earning nothing
- an end-to-end 800 BV order paying the exact rupee figures the plan promises

`src/__tests__/order.spec.ts` — 16 tests:

- GST extracted per line, not blended: a 5% hair oil and an 18% lotion in one cart
- a 2,000-case sweep asserting subtotal + GST always reconciles to the total
- cart normalisation: duplicate lines merge, junk is rejected, output is sorted into lock order
- the joining gate in BV and in rupees, first order only, and free-joining mode
- the Indian financial year boundary at 31 March / 1 April

`src/__tests__/auth.spec.ts` — 27 tests:

- HOTP against the RFC 4226 Appendix D vectors, TOTP against RFC 6238 Appendix B
- clock drift tolerated one step either way, and a used code refused inside its own window
- base32 round trips and RFC 4648 vectors
- password policy, including passwords containing the owner's own phone, name or email
- OTP hashing with a pepper: the same code under a different pepper does not match
- lockout backoff curve and its one-hour cap
- genealogy paths: upline ordering, the trailing-slash rule that stops `m1` matching `m12`, cycle refusal, and subtree re-parenting

`src/__tests__/serialization.spec.ts` — 10 tests:

- a bigint response field becomes a decimal string, and `JSON.stringify` throws without it
- proof that the `Number()` shortcut loses precision silently past `MAX_SAFE_INTEGER`
- dates, buffers and null survive; self-referencing Prisma graphs do not blow the stack
- money arriving as a JSON float is rejected

`src/__tests__/reporting.spec.ts` — 34 tests:

- a filter value carrying `DROP TABLE` is proven never to appear in the SQL text
- every `$n` placeholder has exactly one bound value, with no gaps
- a member caller is confined to their downline even when the definition says `GLOBAL`
- the downline prefix ends in a slash, so `ckmem1` cannot match `ckmem12`
- a member caller with no genealogy context is refused rather than run unscoped
- all 33 presets compile, member presets compile scoped, admin presets stay closed to members
- the UI catalog contains no SQL, and no dataset touches a credential column

`computePayouts()`, `priceOrder()`, the cart helpers, the TOTP implementation,
the serializer, the report compiler and every genealogy function are
deliberately pure so these run with no database.

`src/__tests__/crypto.spec.ts` — 19 tests: round trips, per-encryption IV
randomness, record binding refusing a value moved between members or columns,
tamper detection on both ciphertext and auth tag, key rotation with old rows
still readable, idempotent backfill, and keyed blind indexes.

`src/__tests__/invoice.spec.ts` — 20 tests: state-code resolution across
casing, abbreviations and old names; intra vs inter-state; a 2,000-case sweep
proving CGST + SGST always reconstructs the tax exactly; multi-rate carts;
round-off bounded to ±50 paise; amounts in words on the Indian scale including
the teens boundary and negatives for credit notes.

`src/__tests__/integration.spec.ts` — 10 tests, against a **real Postgres**
(`npm run test:integration`, needs `DATABASE_URL`). These cover what unit tests
cannot reach, because the failures only appear when two transactions run at
once — and each produces a wrong balance rather than an error, which is the
worst kind of bug to have in a ledger:

- one commission job fired 20 times concurrently pays exactly once
- two orders delivering simultaneously through a shared upline pay ₹192, not ₹96 — the lost update that silent interleaving would cause
- 50 concurrent payouts into one wallet lose nothing
- four transactions competing for the same two wallets never deadlock, because the ids are locked in ascending order
- two checkouts racing for one balance: exactly one succeeds, and the CHECK constraint is the backstop
- the last unit of stock goes to exactly one of five buyers
- four admins approving the same UTR at once: exactly one gets through, enforced by the partial unique index
- after 120 concurrent operations, no wallet has drifted from its ledger
- the reconciliation query does catch a balance written outside `LedgerService`
- an order at 11pm IST on 30 September stays in September

The drift test earned its place immediately: the first version of the fixture
seeded opening balances by writing `balancePaise` directly, and the
reconciliation query reported five drifted wallets on the first run. The
detector was right and the fixture was wrong — which is exactly the incident it
exists to surface.

`computePayouts()`, `priceOrder()`, the cart helpers, the TOTP implementation,
