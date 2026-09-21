// src/__tests__/integration.spec.ts
import assert from "node:assert/strict";
import { test, before, after, beforeEach } from "node:test";
import pg from "pg";
var { Pool } = pg;
var pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 20 });
var paise = (rupees) => BigInt(Math.round(rupees * 100));
async function lockWallets(client, walletIds) {
  if (!walletIds.length) return;
  await client.query(
    `SELECT id FROM "Wallet" WHERE id = ANY($1) ORDER BY id ASC FOR UPDATE`,
    [walletIds]
  );
}
async function post(client, args) {
  const { rows } = await client.query(
    `SELECT id, "balancePaise" FROM "Wallet" WHERE "memberId" = $1 AND kind = $2::"WalletKind" FOR UPDATE`,
    [args.memberId, args.kind]
  );
  const wallet = rows[0];
  const delta = args.direction === "CREDIT" ? args.amountPaise : -args.amountPaise;
  const balanceAfter = BigInt(wallet.balancePaise) + delta;
  try {
    await client.query(
      `INSERT INTO "LedgerEntry" ("journalId","memberId","walletId",direction,"amountPaise",category,"balanceAfter","refType","refId","idempotencyKey")
       VALUES ($1,$2,$3,$4::"EntryDirection",$5,$6::"LedgerCategory",$7,$8,$9,$10)`,
      [args.idempotencyKey, args.memberId, wallet.id, args.direction, args.amountPaise.toString(), args.category, balanceAfter.toString(), args.refId ? "order" : null, args.refId ?? null, args.idempotencyKey]
    );
  } catch (e) {
    if (e.code === "23505") return { deduplicated: true, balanceAfter: BigInt(wallet.balancePaise) };
    throw e;
  }
  await client.query(`UPDATE "Wallet" SET "balancePaise" = $1, version = version + 1 WHERE id = $2`, [balanceAfter.toString(), wallet.id]);
  return { deduplicated: false, balanceAfter };
}
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw e;
  } finally {
    client.release();
  }
}
var phoneSeq = 0;
async function makeMember(id, sponsorPath = "/", shoppingPaise = 0n) {
  const phone = `9${String(8e8 + phoneSeq++).slice(0, 9)}`;
  await pool.query(
    `INSERT INTO "Member"(id,"memberCode",name,phone,"ancestorPath",depth) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, id.toUpperCase(), id, phone, sponsorPath, sponsorPath.split("/").filter(Boolean).length]
  );
  for (const kind of ["SHOPPING", "INCOME"]) {
    await pool.query(
      `INSERT INTO "Wallet"(id,"memberId",kind,"balancePaise") VALUES ($1,$2,$3::"WalletKind",0)`,
      [`${id}-${kind}`, id, kind]
    );
  }
  if (shoppingPaise > 0n) {
    await tx((c) => post(c, {
      memberId: id,
      kind: "SHOPPING",
      direction: "CREDIT",
      amountPaise: shoppingPaise,
      category: "RECHARGE",
      idempotencyKey: `opening:${id}`
    }));
  }
  return id;
}
var balanceOf = async (memberId, kind = "INCOME") => {
  const { rows } = await pool.query(`SELECT "balancePaise" FROM "Wallet" WHERE "memberId"=$1 AND kind=$2::"WalletKind"`, [memberId, kind]);
  return BigInt(rows[0].balancePaise);
};
var derivedBalance = async (memberId, kind = "INCOME") => {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN l.direction='CREDIT' THEN l."amountPaise" ELSE -l."amountPaise" END),0) AS d
     FROM "LedgerEntry" l JOIN "Wallet" w ON w.id = l."walletId"
     WHERE l."memberId"=$1 AND w.kind=$2::"WalletKind"`,
    [memberId, kind]
  );
  return BigInt(rows[0].d);
};
before(async () => {
  await pool.query("SELECT 1");
});
after(async () => {
  await pool.end();
});
beforeEach(async () => {
  await pool.query(`TRUNCATE "Commission","LedgerEntry","Order","Wallet","MonthlyVolume","Recharge","Member","Product" RESTART IDENTITY CASCADE`);
});
test("a replayed commission job pays exactly once, even fired 20 times at once", async () => {
  const m = await makeMember("m1");
  const key = "commission:order-1:m1:SELF:_";
  const results = await Promise.allSettled(
    Array.from({ length: 20 }, () => tx((c) => post(c, { memberId: m, kind: "INCOME", direction: "CREDIT", amountPaise: paise(100), category: "SELF_INCOME", idempotencyKey: key })))
  );
  const succeeded = results.filter((r) => r.status === "fulfilled").length;
  assert.ok(succeeded >= 1, "every attempt failed");
  assert.equal(await balanceOf(m), paise(100), "the member was paid more than once");
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM "LedgerEntry" WHERE "idempotencyKey"=$1`, [key]);
  assert.equal(rows[0].n, 1, "more than one ledger row for one event");
});
test("two orders delivering at once through a shared upline pay the right total", async () => {
  const sponsor = await makeMember("sponsor");
  const a = await makeMember("buyer-a", `/sponsor/`);
  const b = await makeMember("buyer-b", `/sponsor/`);
  const run = (buyer, orderId) => tx(async (c) => {
    await lockWallets(c, [`${buyer}-INCOME`, "sponsor-INCOME"].sort());
    await post(c, { memberId: buyer, kind: "INCOME", direction: "CREDIT", amountPaise: paise(80), category: "SELF_INCOME", idempotencyKey: `c:${orderId}:${buyer}:SELF`, refId: orderId });
    await post(c, { memberId: sponsor, kind: "INCOME", direction: "CREDIT", amountPaise: paise(96), category: "TEAM_INCOME", idempotencyKey: `c:${orderId}:sponsor:TEAM`, refId: orderId });
  });
  await Promise.all([run(a, "order-a"), run(b, "order-b")]);
  assert.equal(await balanceOf(sponsor), paise(192));
  assert.equal(await balanceOf(a), paise(80));
  assert.equal(await balanceOf(b), paise(80));
});
test("fifty concurrent payouts into one wallet lose nothing", async () => {
  const m = await makeMember("popular");
  await Promise.all(
    Array.from({ length: 50 }, (_, i) => tx((c) => post(c, { memberId: m, kind: "INCOME", direction: "CREDIT", amountPaise: paise(10), category: "TEAM_INCOME", idempotencyKey: `c:order-${i}:popular:TEAM` })))
  );
  assert.equal(await balanceOf(m), paise(500));
  assert.equal(await derivedBalance(m), paise(500), "stored balance and ledger disagree");
});
test("ascending lock order means contention queues instead of deadlocking", async () => {
  const x = await makeMember("alpha");
  const y = await makeMember("bravo");
  const ids = [`${x}-INCOME`, `${y}-INCOME`].sort();
  const both = (tag) => tx(async (c) => {
    await lockWallets(c, ids);
    await post(c, { memberId: x, kind: "INCOME", direction: "CREDIT", amountPaise: paise(5), category: "TEAM_INCOME", idempotencyKey: `${tag}:alpha` });
    await post(c, { memberId: y, kind: "INCOME", direction: "CREDIT", amountPaise: paise(5), category: "TEAM_INCOME", idempotencyKey: `${tag}:bravo` });
  });
  const results = await Promise.allSettled([both("t1"), both("t2"), both("t3"), both("t4")]);
  const deadlocked = results.filter((r) => r.status === "rejected" && /deadlock/i.test(String(r.reason)));
  assert.equal(deadlocked.length, 0, "a deadlock occurred despite the ordering rule");
  assert.equal(await balanceOf(x), paise(20));
  assert.equal(await balanceOf(y), paise(20));
});
test("a wallet cannot be spent twice over", async () => {
  const m = await makeMember("spender", "/", paise(1e3));
  const spend = (orderId) => tx((c) => post(c, { memberId: m, kind: "SHOPPING", direction: "DEBIT", amountPaise: paise(800), category: "ORDER_PAYMENT", idempotencyKey: `pay:${orderId}` }));
  const results = await Promise.allSettled([spend("o1"), spend("o2")]);
  const ok = results.filter((r) => r.status === "fulfilled").length;
  assert.equal(ok, 1, `expected exactly one checkout to succeed, ${ok} did`);
  assert.equal(await balanceOf(m, "SHOPPING"), paise(200));
  const failed = results.find((r) => r.status === "rejected");
  assert.match(String(failed.reason), /wallet_shopping_non_negative|check constraint/i);
});
test("the last unit of stock goes to exactly one buyer", async () => {
  await pool.query(`INSERT INTO "Product"(id,sku,name,"pricePaise","mrpPaise","bvCenti",stock) VALUES ('p1','SKU1','Lotion',59900,69900,30000,1)`);
  const claim = () => tx(async (c) => {
    const res = await c.query(`UPDATE "Product" SET stock = stock - 1, sold = sold + 1 WHERE id='p1' AND stock >= 1`);
    if (res.rowCount === 0) throw new Error("out of stock");
    return true;
  });
  const results = await Promise.allSettled([claim(), claim(), claim(), claim(), claim()]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const { rows } = await pool.query(`SELECT stock, sold FROM "Product" WHERE id='p1'`);
  assert.equal(rows[0].stock, 0);
  assert.equal(rows[0].sold, 1);
});
test("one UTR can only ever be credited once, however many admins click at once", async () => {
  const m = await makeMember("payer");
  const utr = "123456789012";
  for (let i = 0; i < 4; i++) {
    await pool.query(
      `INSERT INTO "Recharge"(id,"memberId","claimedPaise",utr,"screenshotKey",status) VALUES ($1,$2,$3,$4,$5,'PENDING')`,
      [`r${i}`, m, paise(5e3).toString(), utr, `k${i}`]
    );
  }
  const approve = (id) => tx((c) => c.query(`UPDATE "Recharge" SET status='APPROVED', "creditedPaise"=$2 WHERE id=$1`, [id, paise(5e3).toString()]));
  const results = await Promise.allSettled([approve("r0"), approve("r1"), approve("r2"), approve("r3")]);
  const approved = results.filter((r) => r.status === "fulfilled").length;
  assert.equal(approved, 1, `${approved} approvals got through for one UTR`);
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM "Recharge" WHERE utr=$1 AND status='APPROVED'`, [utr]);
  assert.equal(rows[0].n, 1);
});
test("after a storm of concurrent activity, no wallet has drifted", async () => {
  const members = await Promise.all(["a", "b", "c", "d", "e"].map((id) => makeMember(id, "/", paise(5e3))));
  const work = [];
  for (let i = 0; i < 120; i++) {
    const m = members[i % members.length];
    const credit = i % 3 !== 0;
    work.push(
      tx((c) => post(c, {
        memberId: m,
        kind: credit ? "INCOME" : "SHOPPING",
        direction: credit ? "CREDIT" : "DEBIT",
        amountPaise: paise(credit ? 7 : 11),
        category: credit ? "TEAM_INCOME" : "ORDER_PAYMENT",
        idempotencyKey: `storm:${i}`
      })).catch(() => null)
    );
  }
  await Promise.all(work);
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
test("the reconciliation query catches a balance written outside the ledger", async () => {
  const m = await makeMember("tampered");
  await tx((c) => post(c, { memberId: m, kind: "INCOME", direction: "CREDIT", amountPaise: paise(100), category: "TEAM_INCOME", idempotencyKey: "legit:1" }));
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
  assert.equal(rows.length, 1, "the out-of-band write was not detected");
  assert.equal(rows[0].id, "tampered-INCOME");
  assert.equal(rows[0].drift, "50000");
});
test("an order at 11pm IST on the last of the month stays in that month", async () => {
  const m = await makeMember("timezone");
  const late = "2026-09-30 23:30:00+05:30";
  const { rows } = await pool.query(`SELECT to_char($1::timestamptz, 'YYYY-MM') AS period`, [late]);
  assert.equal(rows[0].period, "2026-09");
  await pool.query(
    `INSERT INTO "MonthlyVolume"("memberId",period,"selfBvCenti") VALUES ($1,$2,$3)`,
    [m, rows[0].period, 6e4]
  );
  const { rows: check } = await pool.query(`SELECT period, "selfBvCenti" FROM "MonthlyVolume" WHERE "memberId"=$1`, [m]);
  assert.equal(check[0].period, "2026-09");
  assert.equal(check[0].selfBvCenti, 6e4);
});
