import assert from 'node:assert/strict';
import { test, before, after, beforeEach } from 'node:test';
import pg from 'pg';

/**
 * Integration tests against a real Postgres.
 *
 * These cover the failure modes that unit tests cannot reach, because they only
 * appear when two transactions run at the same time. Every one of them is on
 * the money path, and every one produces a wrong balance rather than an error
 * if it regresses — which is the worst kind of bug to have in a ledger.
 *
 * Run with: npm run test:integration   (needs DATABASE_URL)
 */

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 20 });

const paise = (rupees: number) => BigInt(Math.round(rupees * 100));

/** Take wallet locks in a fixed order. This IS the deadlock-avoidance rule. */
async function lockWallets(client: pg.PoolClient, walletIds: string[]) {
  if (!walletIds.length) return;
  await client.query(
    `SELECT id FROM "Wallet" WHERE id = ANY($1) ORDER BY id ASC FOR UPDATE`,
    [walletIds],
  );
}

/** One ledger posting, mirroring LedgerService.post(). */
async function post(
  client: pg.PoolClient,
  args: { memberId: string; kind: 'SHOPPING' | 'INCOME'; direction: 'CREDIT' | 'DEBIT'; amountPaise: bigint; category: string; idempotencyKey: string; refId?: string },
) {
  const { rows } = await client.query(
    `SELECT id, "balancePaise" FROM "Wallet" WHERE "memberId" = $1 AND kind = $2::"WalletKind" FOR UPDATE`,
    [args.memberId, args.kind],
  );
  const wallet = rows[0];
  const delta = args.direction === 'CREDIT' ? args.amountPaise : -args.amountPaise;
  const balanceAfter = BigInt(wallet.balancePaise) + delta;

  try {
    await client.query(
      `INSERT INTO "LedgerEntry" ("journalId","memberId","walletId",direction,"amountPaise",category,"balanceAfter","refType","refId","idempotencyKey")
       VALUES ($1,$2,$3,$4::"EntryDirection",$5,$6::"LedgerCategory",$7,$8,$9,$10)`,
      [args.idempotencyKey, args.memberId, wallet.id, args.direction, args.amountPaise.toString(), args.category, balanceAfter.toString(), args.refId ? 'order' : null, args.refId ?? null, args.idempotencyKey],
    );
  } catch (e) {
    // 23505 = unique violation on idempotencyKey. Already posted; no-op.
    if ((e as { code?: string }).code === '23505') return { deduplicated: true, balanceAfter: BigInt(wallet.balancePaise) };
    throw e;
  }
  await client.query(`UPDATE "Wallet" SET "balancePaise" = $1, version = version + 1 WHERE id = $2`, [balanceAfter.toString(), wallet.id]);
  return { deduplicated: false, balanceAfter };
}

async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/* ------------------------------------------------------------- fixtures */

let phoneSeq = 0;
async function makeMember(id: string, sponsorPath = '/', shoppingPaise = 0n) {
  // Sequential, because deriving a phone number from the id collided as soon
  // as two fixtures shared their digits ("buyer-a" and "buyer-b" both had none).
  const phone = `9${String(800000000 + phoneSeq++).slice(0, 9)}`;
  await pool.query(
    `INSERT INTO "Member"(id,"memberCode",name,phone,"ancestorPath",depth) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, id.toUpperCase(), id, phone, sponsorPath, sponsorPath.split('/').filter(Boolean).length],
  );
  for (const kind of ['SHOPPING', 'INCOME']) {
    await pool.query(
      `INSERT INTO "Wallet"(id,"memberId",kind,"balancePaise") VALUES ($1,$2,$3::"WalletKind",0)`,
      [`${id}-${kind}`, id, kind],
    );
  }
  // Fund through the ledger, the way a real recharge would.
  //
  // The first version of this helper set balancePaise directly — and the
  // reconciliation test below caught it immediately, reporting five drifted
  // wallets. That is the detector doing its job on an out-of-band write, so
  // the fixture was wrong rather than the query.
  if (shoppingPaise > 0n) {
    await tx((c) => post(c, {
      memberId: id, kind: 'SHOPPING', direction: 'CREDIT', amountPaise: shoppingPaise,
      category: 'RECHARGE', idempotencyKey: `opening:${id}`,
    }));
  }
  return id;
}

const balanceOf = async (memberId: string, kind = 'INCOME') => {
  const { rows } = await pool.query(`SELECT "balancePaise" FROM "Wallet" WHERE "memberId"=$1 AND kind=$2::"WalletKind"`, [memberId, kind]);
  return BigInt(rows[0].balancePaise);
};

const derivedBalance = async (memberId: string, kind = 'INCOME') => {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN l.direction='CREDIT' THEN l."amountPaise" ELSE -l."amountPaise" END),0) AS d
     FROM "LedgerEntry" l JOIN "Wallet" w ON w.id = l."walletId"
     WHERE l."memberId"=$1 AND w.kind=$2::"WalletKind"`, [memberId, kind]);
  return BigInt(rows[0].d);
};

before(async () => { await pool.query('SELECT 1'); });
after(async () => { await pool.end(); });
beforeEach(async () => {
  await pool.query(`TRUNCATE "Commission","LedgerEntry","Order","Wallet","MonthlyVolume","Recharge","Member","Product" RESTART IDENTITY CASCADE`);
});

/* ------------------------------------------------- idempotency under load */

test('a replayed commission job pays exactly once, even fired 20 times at once', async () => {
  const m = await makeMember('m1');
  const key = 'commission:order-1:m1:SELF:_';

  // A BullMQ retry storm: the same job, concurrently, twenty times over.
  const results = await Promise.allSettled(
    Array.from({ length: 20 }, () =>
      tx((c) => post(c, { memberId: m, kind: 'INCOME', direction: 'CREDIT', amountPaise: paise(100), category: 'SELF_INCOME', idempotencyKey: key }))),
  );

  const succeeded = results.filter((r) => r.status === 'fulfilled').length;
  assert.ok(succeeded >= 1, 'every attempt failed');
  assert.equal(await balanceOf(m), paise(100), 'the member was paid more than once');

  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM "LedgerEntry" WHERE "idempotencyKey"=$1`, [key]);
  assert.equal(rows[0].n, 1, 'more than one ledger row for one event');
});

/* --------------------------------------------- shared upline contention */

test('two orders delivering at once through a shared upline pay the right total', async () => {
  // The real shape: one sponsor, two buyers, both delivering simultaneously.
  const sponsor = await makeMember('sponsor');
  const a = await makeMember('buyer-a', `/sponsor/`);
  const b = await makeMember('buyer-b', `/sponsor/`);

  // Each order pays the buyer 10% and the shared sponsor 12%.
  const run = (buyer: string, orderId: string) =>
    tx(async (c) => {
      await lockWallets(c, [`${buyer}-INCOME`, 'sponsor-INCOME'].sort());
      await post(c, { memberId: buyer, kind: 'INCOME', direction: 'CREDIT', amountPaise: paise(80), category: 'SELF_INCOME', idempotencyKey: `c:${orderId}:${buyer}:SELF`, refId: orderId });
      await post(c, { memberId: sponsor, kind: 'INCOME', direction: 'CREDIT', amountPaise: paise(96), category: 'TEAM_INCOME', idempotencyKey: `c:${orderId}:sponsor:TEAM`, refId: orderId });
    });

  await Promise.all([run(a, 'order-a'), run(b, 'order-b')]);

  // If the two transactions had interleaved on the sponsor's wallet, this would
  // be 96 rather than 192 — a lost update, and silent.
  assert.equal(await balanceOf(sponsor), paise(192));
  assert.equal(await balanceOf(a), paise(80));
  assert.equal(await balanceOf(b), paise(80));
});

test('fifty concurrent payouts into one wallet lose nothing', async () => {
  const m = await makeMember('popular');
  await Promise.all(
    Array.from({ length: 50 }, (_, i) =>
      tx((c) => post(c, { memberId: m, kind: 'INCOME', direction: 'CREDIT', amountPaise: paise(10), category: 'TEAM_INCOME', idempotencyKey: `c:order-${i}:popular:TEAM` }))),
  );
  assert.equal(await balanceOf(m), paise(500));
  assert.equal(await derivedBalance(m), paise(500), 'stored balance and ledger disagree');
});

/* ------------------------------------------------------- lock ordering */

test('ascending lock order means contention queues instead of deadlocking', async () => {
  const x = await makeMember('alpha');
  const y = await makeMember('bravo');
  const ids = [`${x}-INCOME`, `${y}-INCOME`].sort();

  // Both transactions want both wallets. Sorting the ids is what stops them
  // grabbing them in opposite orders and deadlocking.
  const both = (tag: string) =>
    tx(async (c) => {
      await lockWallets(c, ids);
      await post(c, { memberId: x, kind: 'INCOME', direction: 'CREDIT', amountPaise: paise(5), category: 'TEAM_INCOME', idempotencyKey: `${tag}:alpha` });
      await post(c, { memberId: y, kind: 'INCOME', direction: 'CREDIT', amountPaise: paise(5), category: 'TEAM_INCOME', idempotencyKey: `${tag}:bravo` });
    });

  const results = await Promise.allSettled([both('t1'), both('t2'), both('t3'), both('t4')]);
  const deadlocked = results.filter((r) => r.status === 'rejected' && /deadlock/i.test(String((r as PromiseRejectedResult).reason)));
  assert.equal(deadlocked.length, 0, 'a deadlock occurred despite the ordering rule');
  assert.equal(await balanceOf(x), paise(20));
  assert.equal(await balanceOf(y), paise(20));
});

/* --------------------------------------------------- overspend and stock */

test('a wallet cannot be spent twice over', async () => {
  const m = await makeMember('spender', '/', paise(1000));

  // Two checkouts racing for the same balance. One must fail.
  const spend = (orderId: string) =>
    tx((c) => post(c, { memberId: m, kind: 'SHOPPING', direction: 'DEBIT', amountPaise: paise(800), category: 'ORDER_PAYMENT', idempotencyKey: `pay:${orderId}` }));

  const results = await Promise.allSettled([spend('o1'), spend('o2')]);
  const ok = results.filter((r) => r.status === 'fulfilled').length;

  assert.equal(ok, 1, `expected exactly one checkout to succeed, ${ok} did`);
  assert.equal(await balanceOf(m, 'SHOPPING'), paise(200));
  // The CHECK constraint is the backstop if the application logic ever slips.
  const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
  assert.match(String(failed.reason), /wallet_shopping_non_negative|check constraint/i);
});

test('the last unit of stock goes to exactly one buyer', async () => {
  await pool.query(`INSERT INTO "Product"(id,sku,name,"pricePaise","mrpPaise","bvCenti",stock) VALUES ('p1','SKU1','Lotion',59900,69900,30000,1)`);

  // The conditional UPDATE is the check: two buyers cannot both win.
  const claim = () =>
    tx(async (c) => {
      const res = await c.query(`UPDATE "Product" SET stock = stock - 1, sold = sold + 1 WHERE id='p1' AND stock >= 1`);
      if (res.rowCount === 0) throw new Error('out of stock');
      return true;
    });

  const results = await Promise.allSettled([claim(), claim(), claim(), claim(), claim()]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const { rows } = await pool.query(`SELECT stock, sold FROM "Product" WHERE id='p1'`);
  assert.equal(rows[0].stock, 0);
  assert.equal(rows[0].sold, 1);
});

/* ------------------------------------------------------------ the UTR rule */

test('one UTR can only ever be credited once, however many admins click at once', async () => {
  const m = await makeMember('payer');
  const utr = '123456789012';
  for (let i = 0; i < 4; i++) {
    await pool.query(
      `INSERT INTO "Recharge"(id,"memberId","claimedPaise",utr,"screenshotKey",status) VALUES ($1,$2,$3,$4,$5,'PENDING')`,
      [`r${i}`, m, paise(5000).toString(), utr, `k${i}`]);
  }

  // Four admins approving the same UTR simultaneously. Without the partial
  // unique index, the application-level check passes in all four.
  const approve = (id: string) =>
    tx((c) => c.query(`UPDATE "Recharge" SET status='APPROVED', "creditedPaise"=$2 WHERE id=$1`, [id, paise(5000).toString()]));

  const results = await Promise.allSettled([approve('r0'), approve('r1'), approve('r2'), approve('r3')]);
  const approved = results.filter((r) => r.status === 'fulfilled').length;

  assert.equal(approved, 1, `${approved} approvals got through for one UTR`);
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM "Recharge" WHERE utr=$1 AND status='APPROVED'`, [utr]);
  assert.equal(rows[0].n, 1);
});

/* ------------------------------------------------------- reconciliation */

test('after a storm of concurrent activity, no wallet has drifted', async () => {
  const members = await Promise.all(['a', 'b', 'c', 'd', 'e'].map((id) => makeMember(id, '/', paise(5000))));

  const work: Promise<unknown>[] = [];
  for (let i = 0; i < 120; i++) {
    const m = members[i % members.length];
    const credit = i % 3 !== 0;
    work.push(
      tx((c) => post(c, {
        memberId: m,
        kind: credit ? 'INCOME' : 'SHOPPING',
        direction: credit ? 'CREDIT' : 'DEBIT',
        amountPaise: paise(credit ? 7 : 11),
        category: credit ? 'TEAM_INCOME' : 'ORDER_PAYMENT',
        idempotencyKey: `storm:${i}`,
      })).catch(() => null),
    );
  }
  await Promise.all(work);

  // This is the nightly reconciliation query. It must come back empty.
  const { rows } = await pool.query(`
    SELECT w.id, w."balancePaise"::text AS stored, COALESCE(l.derived,0)::text AS derived
    FROM "Wallet" w
    LEFT JOIN (
      SELECT "walletId", SUM(CASE WHEN direction='CREDIT' THEN "amountPaise" ELSE -"amountPaise" END) AS derived
      FROM "LedgerEntry" GROUP BY "walletId"
    ) l ON l."walletId" = w.id
    WHERE w."balancePaise" <> COALESCE(l.derived,0)
  `);
  assert.deepEqual(rows, [], `${rows.length} wallet(s) drifted from their ledger`);
});

test('the reconciliation query catches a balance written outside the ledger', async () => {
  const m = await makeMember('tampered');
  await tx((c) => post(c, { memberId: m, kind: 'INCOME', direction: 'CREDIT', amountPaise: paise(100), category: 'TEAM_INCOME', idempotencyKey: 'legit:1' }));

  // Simulate the incident this check exists for: something writes to Wallet
  // without a matching ledger entry. A stray migration, a hotfix, a script.
  await pool.query(`UPDATE "Wallet" SET "balancePaise" = "balancePaise" + 50000 WHERE id = 'tampered-INCOME'`);

  const { rows } = await pool.query(`
    SELECT w.id, (w."balancePaise" - COALESCE(l.derived,0))::text AS drift
    FROM "Wallet" w
    LEFT JOIN (
      SELECT "walletId", SUM(CASE WHEN direction='CREDIT' THEN "amountPaise" ELSE -"amountPaise" END) AS derived
      FROM "LedgerEntry" GROUP BY "walletId"
    ) l ON l."walletId" = w.id
    WHERE w."balancePaise" <> COALESCE(l.derived,0)
  `);
  assert.equal(rows.length, 1, 'the out-of-band write was not detected');
  assert.equal(rows[0].id, 'tampered-INCOME');
  assert.equal(rows[0].drift, '50000');
});

/* ------------------------------------------------- genealogy under IST */

test('an order at 11pm IST on the last of the month stays in that month', async () => {
  const m = await makeMember('timezone');
  // The exact case that breaks on a UTC container: 30 Sep 11pm IST is
  // 30 Sep 17:30 UTC, but 11pm on the 30th of a 31-day month in UTC+0 would
  // roll to the 1st for anything past 18:30.
  const late = '2026-09-30 23:30:00+05:30';
  const { rows } = await pool.query(`SELECT to_char($1::timestamptz, 'YYYY-MM') AS period`, [late]);
  assert.equal(rows[0].period, '2026-09');

  await pool.query(
    `INSERT INTO "MonthlyVolume"("memberId",period,"selfBvCenti") VALUES ($1,$2,$3)`,
    [m, rows[0].period, 60000]);
  const { rows: check } = await pool.query(`SELECT period, "selfBvCenti" FROM "MonthlyVolume" WHERE "memberId"=$1`, [m]);
  assert.equal(check[0].period, '2026-09');
  assert.equal(check[0].selfBvCenti, 60000);
});
