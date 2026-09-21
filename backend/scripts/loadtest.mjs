/**
 * Commission engine load test.
 *
 * Builds a 10,000-member genealogy up to 20 levels deep and measures what a
 * commission run actually costs at depth, because the cost is not uniform: a
 * payout for a member near the root touches two rows, and one for a member at
 * level 20 walks twenty ancestors.
 *
 * The number that matters is the deep case. If the tree grows and the p99
 * climbs with it, the queue backs up and members wait for income.
 *
 *   node scripts/loadtest.mjs
 */
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 16,
});

const MEMBERS = Number(process.env.LOAD_MEMBERS ?? 10_000);
const MAX_DEPTH = 20;
const RANKS = [
  { name: 'Star', minBv: 0, selfBp: 1000 },
  { name: 'Bronze', minBv: 100_000, selfBp: 1500 },
  { name: 'Silver', minBv: 500_000, selfBp: 1900 },
  { name: 'Gold', minBv: 1_500_000, selfBp: 2200 },
  { name: 'Diamond', minBv: 4_000_000, selfBp: 2500 },
];

/** Mirrors ledgerCategoryFor() in commission.service.ts. GENERATION is the odd
 *  one out — it maps to _BONUS, not _INCOME. */
const LEDGER_CATEGORY = {
  SELF: 'SELF_INCOME', DIRECT: 'DIRECT_INCOME', TEAM: 'TEAM_INCOME',
  GENERATION: 'GENERATION_BONUS', ROYALTY: 'ROYALTY',
};

let seed = 42;
const rnd = () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};
const ms = (n) => `${n.toFixed(1)}ms`;

async function build() {
  console.log(`Building a ${MEMBERS.toLocaleString('en-IN')}-member tree, up to ${MAX_DEPTH} levels…`);
  const t0 = Date.now();

  await pool.query(`TRUNCATE "Commission","LedgerEntry","Wallet","Member" RESTART IDENTITY CASCADE`);
  await pool.query(
    `INSERT INTO "Member"(id,"memberCode",name,"isCompany","ancestorPath",depth) VALUES ('root','MC100001','Company',true,'/',0)`);

  // Shape the tree like a real one: most members recruit nobody, a few recruit
  // many, and depth accumulates down the productive legs. A uniform tree would
  // make the deep case look rarer than it is.
  const nodes = [{ id: 'root', path: '/', depth: 0 }];
  const byDepth = new Array(MAX_DEPTH + 1).fill(0);
  byDepth[0] = 1;

  const CHUNK = 1000;
  for (let start = 0; start < MEMBERS; start += CHUNK) {
    const values = [];
    const params = [];
    for (let i = start; i < Math.min(start + CHUNK, MEMBERS); i++) {
      // Bias towards recently added nodes so the tree deepens rather than
      // fanning out flat.
      const pickFrom = Math.max(0, nodes.length - 1 - Math.floor(rnd() * Math.min(nodes.length, 400)));
      let sponsor = nodes[pickFrom];
      if (sponsor.depth >= MAX_DEPTH) sponsor = nodes[Math.floor(rnd() * Math.min(nodes.length, 50))];

      const id = `m${i}`;
      const path = `${sponsor.path}${sponsor.id}/`;
      const depth = sponsor.depth + 1;
      const rankIndex = rnd() < 0.02 ? 4 : rnd() < 0.08 ? 3 : rnd() < 0.2 ? 2 : rnd() < 0.45 ? 1 : 0;

      const n = params.length;
      values.push(`($${n + 1},$${n + 2},$${n + 3},$${n + 4},$${n + 5},$${n + 6})`);
      params.push(id, `MC${200000 + i}`, `Member ${i}`, path, depth, rankIndex);
      nodes.push({ id, path, depth });
      byDepth[depth]++;
    }
    await pool.query(
      `INSERT INTO "Member"(id,"memberCode",name,"ancestorPath",depth,"rankIndex") VALUES ${values.join(',')}`, params);
  }

  // Wallets in bulk.
  for (let start = 0; start <= MEMBERS; start += CHUNK) {
    const ids = [];
    for (let i = start; i < Math.min(start + CHUNK, MEMBERS); i++) ids.push(`m${i}`);
    if (start === 0) ids.push('root');
    if (!ids.length) continue;
    const values = ids.flatMap((id) => [`('${id}-S','${id}','SHOPPING',5000000)`, `('${id}-I','${id}','INCOME',0)`]);
    await pool.query(`INSERT INTO "Wallet"(id,"memberId",kind,"balancePaise") VALUES ${values.join(',')}`);
  }

  console.log(`  built in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const deepest = byDepth.reduce((mx, n, d) => (n > 0 ? d : mx), 0);
  console.log(`  depth distribution: ${byDepth.slice(1, 13).map((n, i) => `L${i + 1}:${n}`).join(' ')}`);
  console.log(`  deepest level: ${deepest}\n`);
  return nodes;
}

/**
 * One commission run, mirroring CommissionService: read the upline from the
 * materialised path, pay self, pay the gap up the line, pay generations, then
 * apply the volume.
 */
async function runCommission(client, buyer, orderId, bvCenti) {
  const ancestorIds = buyer.path.split('/').filter(Boolean).filter((x) => x !== 'root');

  const upline = ancestorIds.length
    ? (await client.query(
        `SELECT id, "rankIndex", "ancestorPath" FROM "Member" WHERE id = ANY($1) AND "isCompany" = false`,
        [ancestorIds])).rows
    : [];
  // ancestorPath is root-first; commission walks upward from the buyer.
  const byId = new Map(upline.map((m) => [m.id, m]));
  const chain = ancestorIds.map((id) => byId.get(id)).filter(Boolean).reverse();

  const { rows: [buyerRow] } = await client.query(`SELECT "rankIndex" FROM "Member" WHERE id=$1`, [buyer.id]);
  const payouts = [];
  const selfBp = RANKS[buyerRow.rankIndex].selfBp;
  payouts.push({ memberId: buyer.id, type: 'SELF', bp: selfBp, gen: null, depth: 0 });

  let paidBp = selfBp;
  const topBp = 2500;
  for (const [i, u] of chain.entries()) {
    if (paidBp >= topBp) break;
    const upBp = RANKS[u.rankIndex].selfBp;
    if (upBp > paidBp) { payouts.push({ memberId: u.id, type: 'TEAM', bp: upBp - paidBp, gen: null, depth: i + 1 }); paidBp = upBp; }
  }
  let gen = 0;
  for (const [i, u] of chain.entries()) {
    if (gen >= 3) break;
    if (u.rankIndex < 4) continue;
    payouts.push({ memberId: u.id, type: 'GENERATION', bp: [200, 200, 100][gen], gen: gen + 1, depth: i + 1 });
    gen++;
  }

  // Lock every wallet up front, in ascending id order.
  const walletIds = payouts.map((p) => `${p.memberId}-I`).sort();
  await client.query(`SELECT id FROM "Wallet" WHERE id = ANY($1) ORDER BY id ASC FOR UPDATE`, [walletIds]);

  for (const p of payouts) {
    const amount = Math.floor((bvCenti * p.bp) / 10000);
    if (amount <= 0) continue;
    const key = `commission:${orderId}:${p.memberId}:${p.type}:${p.gen ?? '_'}`;
    const ins = await client.query(
      `INSERT INTO "Commission"("orderId","memberId",type,"sourceBvCenti","pctBp","amountPaise","generationLevel","uplineDepth","dedupeKey")
       VALUES ($1,$2,$3::"CommissionType",$4,$5,$6,$7,$8,$9) ON CONFLICT ("dedupeKey") DO NOTHING`,
      [orderId, p.memberId, p.type, bvCenti, p.bp, amount, p.gen, p.depth, key]);
    if (ins.rowCount === 0) continue;

    const { rows: [w] } = await client.query(
      `SELECT id,"balancePaise" FROM "Wallet" WHERE "memberId"=$1 AND kind='INCOME' FOR UPDATE`, [p.memberId]);
    const after = BigInt(w.balancePaise) + BigInt(amount);
    await client.query(
      `INSERT INTO "LedgerEntry"("journalId","memberId","walletId",direction,"amountPaise",category,"balanceAfter","refType","refId","idempotencyKey")
       VALUES ($1,$2,$3,'CREDIT',$4,$5::"LedgerCategory",$6,'order',$7,$8)`,
      [`commission:${orderId}`, p.memberId, w.id, amount, LEDGER_CATEGORY[p.type], after.toString(), orderId, key]);
    await client.query(`UPDATE "Wallet" SET "balancePaise"=$1, version=version+1 WHERE id=$2`, [after.toString(), w.id]);
  }

  // Volume: buyer plus every ancestor, in one statement.
  await client.query(
    `UPDATE "Member" SET "selfBvCenti"="selfBvCenti"+$2, "groupBvCenti"="groupBvCenti"+$2 WHERE id=$1`,
    [buyer.id, bvCenti]);
  if (ancestorIds.length) {
    await client.query(`UPDATE "Member" SET "groupBvCenti"="groupBvCenti"+$2 WHERE id = ANY($1)`, [ancestorIds, bvCenti]);
  }
  return payouts.length;
}

async function timed(buyer, orderId) {
  const client = await pool.connect();
  const t0 = process.hrtime.bigint();
  try {
    await client.query('BEGIN');
    const legs = await runCommission(client, buyer, orderId, 60000);
    await client.query('COMMIT');
    return { ms: Number(process.hrtime.bigint() - t0) / 1e6, legs };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function main() {
  const nodes = await build();
  const members = nodes.filter((n) => n.id !== 'root');

  // ---- sequential, bucketed by depth -----------------------------------
  console.log('Sequential commission runs, by buyer depth');
  const buckets = [[1, 3], [4, 7], [8, 12], [13, 20]];
  for (const [lo, hi] of buckets) {
    const pool_ = members.filter((m) => m.depth >= lo && m.depth <= hi);
    if (!pool_.length) { console.log(`  L${lo}-${hi}: none`); continue; }
    const times = [];
    let legs = 0;
    for (let i = 0; i < 60; i++) {
      const buyer = pool_[Math.floor(rnd() * pool_.length)];
      const r = await timed(buyer, `seq-${lo}-${i}-${Math.random().toString(36).slice(2, 8)}`);
      times.push(r.ms); legs += r.legs;
    }
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    console.log(`  L${String(lo).padStart(2)}-${String(hi).padEnd(2)}  avg ${ms(avg).padStart(8)}  p50 ${ms(pct(times, 0.5)).padStart(8)}  p99 ${ms(pct(times, 0.99)).padStart(8)}  ${(legs / times.length).toFixed(1)} legs/order`);
  }

  // ---- concurrent throughput -------------------------------------------
  console.log('\nConcurrent throughput (the shape a delivery batch actually has)');
  for (const concurrency of [1, 4, 8, 16]) {
    const TOTAL = 200;
    const times = [];
    const failureReasons = [];
    const t0 = Date.now();
    let failures = 0;

    for (let batch = 0; batch < TOTAL / concurrency; batch++) {
      const jobs = Array.from({ length: concurrency }, (_, k) => {
        const buyer = members[Math.floor(rnd() * members.length)];
        return timed(buyer, `conc-${concurrency}-${batch}-${k}-${Math.random().toString(36).slice(2, 8)}`)
          .then((r) => times.push(r.ms))
          .catch((e) => { failures++; failureReasons.push(`${e.code ?? ''} ${e.message}`.trim().slice(0, 120)); });
      });
      await Promise.all(jobs);
    }
    const elapsed = (Date.now() - t0) / 1000;
    console.log(`  c=${String(concurrency).padStart(2)}  ${(TOTAL / elapsed).toFixed(0).padStart(4)} orders/sec  p50 ${ms(pct(times, 0.5)).padStart(8)}  p99 ${ms(pct(times, 0.99)).padStart(8)}  failures ${failures}`);
    for (const r of [...new Set(failureReasons)].slice(0, 3)) console.log(`        ! ${r}`);
  }

  // ---- correctness after the storm -------------------------------------
  console.log('\nIntegrity after the run');
  const { rows: drift } = await pool.query(`
    SELECT count(*)::int AS n FROM "Wallet" w
    LEFT JOIN (SELECT "walletId", SUM(CASE WHEN direction='CREDIT' THEN "amountPaise" ELSE -"amountPaise" END) d
               FROM "LedgerEntry" GROUP BY "walletId") l ON l."walletId"=w.id
    WHERE w.kind='INCOME' AND w."balancePaise" <> COALESCE(l.d,0)`);
  console.log(`  wallets drifted from their ledger: ${drift[0].n}`);

  const { rows: dupes } = await pool.query(
    `SELECT count(*)::int AS n FROM (SELECT "dedupeKey" FROM "Commission" GROUP BY "dedupeKey" HAVING count(*)>1) x`);
  console.log(`  duplicate commission rows: ${dupes[0].n}`);

  const { rows: totals } = await pool.query(
    `SELECT count(*)::int AS legs, SUM("amountPaise")::bigint AS paid FROM "Commission"`);
  console.log(`  ${Number(totals[0].legs).toLocaleString('en-IN')} commission legs, ₹${(Number(totals[0].paid) / 100).toLocaleString('en-IN')} paid`);

  // ---- the query the deep path depends on ------------------------------
  console.log('\nUpline lookup plan (the query that grows with depth)');
  const deep = members.filter((m) => m.depth >= 12)[0] ?? members[members.length - 1];
  const ids = deep.path.split('/').filter(Boolean).filter((x) => x !== 'root');
  const { rows: plan } = await pool.query(
    `EXPLAIN (ANALYZE, BUFFERS) SELECT id,"rankIndex" FROM "Member" WHERE id = ANY($1)`, [ids]);
  for (const r of plan.slice(0, 4)) console.log(`  ${r['QUERY PLAN']}`);

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
