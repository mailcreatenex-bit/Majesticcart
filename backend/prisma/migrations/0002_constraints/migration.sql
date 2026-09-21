-- Constraints Prisma's schema language cannot express.
--
-- Run this AFTER `prisma migrate dev` has created the tables. Prisma will not
-- generate any of it, and `prisma migrate diff` will not drop it either, so it
-- is safe to keep in its own migration.

-- ---------------------------------------------------------------------------
-- 1. One approved credit per UTR. Ever.
--
-- This is the single most important control in the platform. There is no
-- payment gateway callback: the UTR is the only thing tying a member's claim to
-- money that actually arrived in the bank. The application checks for a clash
-- before approving, but two admins clicking Approve on the same UTR within the
-- same second would both pass that check. This index is what stops them.
--
-- Partial, because rejected and pending rows may legitimately repeat a UTR.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS recharge_one_approved_per_utr
  ON "Recharge" (utr)
  WHERE status = 'APPROVED';

-- ---------------------------------------------------------------------------
-- 2. Ledger sanity.
--
-- Amounts are always positive; direction carries the sign. A negative amount
-- would flip a debit into a credit and silently mint money.
-- ---------------------------------------------------------------------------
ALTER TABLE "LedgerEntry"
  ADD CONSTRAINT ledger_amount_positive CHECK ("amountPaise" > 0);

ALTER TABLE "Commission"
  ADD CONSTRAINT commission_amount_positive CHECK ("amountPaise" > 0);

-- ---------------------------------------------------------------------------
-- 3. Wallet balances.
--
-- NOT VALID so it applies to new writes without a full table scan on deploy;
-- run VALIDATE during a quiet window once the data is known clean.
--
-- Note this is NOT a blanket non-negative rule. A post-delivery return claws
-- back commission a member may already have withdrawn, which can legitimately
-- push an income wallet negative. That debt is recorded on purpose rather than
-- written off, so the constraint covers the shopping wallet only.
-- ---------------------------------------------------------------------------
ALTER TABLE "Wallet"
  ADD CONSTRAINT wallet_shopping_non_negative
  CHECK (kind <> 'SHOPPING' OR "balancePaise" >= 0) NOT VALID;

-- After verifying no existing rows violate it:
--   ALTER TABLE "Wallet" VALIDATE CONSTRAINT wallet_shopping_non_negative;

-- ---------------------------------------------------------------------------
-- 4. Product economics.
--
-- BV above the selling price means the commission pool is larger than the
-- revenue funding it. Caught in the admin UI, enforced here.
-- ---------------------------------------------------------------------------
ALTER TABLE "Product"
  ADD CONSTRAINT product_price_sane
  CHECK ("pricePaise" > 0 AND "pricePaise" <= "mrpPaise" AND "bvCenti" >= 0 AND "bvCenti" <= "pricePaise");

ALTER TABLE "Product"
  ADD CONSTRAINT product_stock_non_negative CHECK (stock >= 0);

-- ---------------------------------------------------------------------------
-- 5. Genealogy paths must be well formed.
--
-- The leading and trailing slashes are load-bearing: the downline prefix match
-- relies on them, and without the trailing slash member "m1" would match "m12"
-- and misroute commission into the wrong leg.
-- ---------------------------------------------------------------------------
ALTER TABLE "Member"
  ADD CONSTRAINT member_path_well_formed
  CHECK ("ancestorPath" LIKE '/%' AND "ancestorPath" LIKE '%/');

-- A member may not be their own sponsor. Deeper cycles are prevented in
-- application code; this catches the trivial case at the storage layer.
ALTER TABLE "Member"
  ADD CONSTRAINT member_not_own_sponsor CHECK ("sponsorId" IS NULL OR "sponsorId" <> id);

-- ---------------------------------------------------------------------------
-- 6. Indexes for the hot dashboard queries.
--
-- All partial: the admin console filters hard on status, and a partial index is
-- a fraction of the size of the full one.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS order_delivered_at
  ON "Order" ("deliveredAt" DESC) WHERE status = 'DELIVERED';

CREATE INDEX IF NOT EXISTS recharge_pending_created
  ON "Recharge" ("createdAt") WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS withdrawal_pending_created
  ON "Withdrawal" ("createdAt") WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS alert_open
  ON "SecurityAlert" ("createdAt" DESC) WHERE resolved = false;

-- Commission income by member and month, for the earnings breakdown.
CREATE INDEX IF NOT EXISTS commission_member_month
  ON "Commission" ("memberId", "createdAt" DESC);

-- ---------------------------------------------------------------------------
-- 7. Bootstrap counters.
--
-- Member codes start at MC100001, which the company root takes. Order numbers
-- continue the demo series so nothing collides during a staged cutover.
-- ---------------------------------------------------------------------------
INSERT INTO "NumberSeries" (key, prefix, "nextValue", "updatedAt")
VALUES
  ('member', 'MC', 100001, NOW()),
  ('order',  'OD', 24001,  NOW())
ON CONFLICT (key) DO NOTHING;
