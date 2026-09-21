"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
/* eslint-disable no-console */
const client_1 = require("@prisma/client");
const argon2 = __importStar(require("argon2"));
const plan_config_1 = require("../src/plan/plan.config");
const money_1 = require("../src/common/money");
const period_1 = require("../src/common/period");
/**
 * Seed.
 *
 * Two modes:
 *
 *   npm run seed            bootstrap only — the company root, one admin, plan
 *                           version 1, store settings and the catalogue. Safe
 *                           to run against production on first deploy.
 *
 *   npm run seed -- --demo  the above plus a 40-member network with a year of
 *                           orders, commissions, recharges and withdrawals, so
 *                           the client can click through a system that looks
 *                           real. Refuses to run if NODE_ENV=production.
 *
 * Idempotent: every insert is an upsert keyed on something stable, so running
 * it twice does not duplicate the catalogue or reset the plan.
 */
const prisma = new client_1.PrismaClient();
const DEMO = process.argv.includes('--demo');
const FORCE = process.argv.includes('--force');
// Deterministic RNG: the same seed produces the same demo network every time,
// so a bug someone reports on the demo can actually be reproduced.
let rngState = 20260912;
const rnd = () => {
    rngState |= 0;
    rngState = (rngState + 0x6d2b79f5) | 0;
    let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const int = (min, max) => min + Math.floor(rnd() * (max - min + 1));
/* ------------------------------------------------------------- catalogue */
const CATEGORIES = ['Makeup', 'Skin Care', 'Body Care', 'Hair Care', 'Fragrance'];
// sku, name, category, mrp₹, price₹, BV, gst%, stock, description
const PRODUCTS = [
    ['MC-BL01', 'Rose Gold Radiance Body Lotion', 'Body Care', 699, 599, 300, 18, 140, 'Deep-moisturising lotion with rose extract, shea butter and a soft gold shimmer. Absorbs fast, no sticky finish.'],
    ['MC-BB02', 'Cocoa & Shea Body Butter', 'Body Care', 549, 479, 240, 18, 90, 'Rich whipped butter for very dry skin, elbows and heels. A little goes a long way in winter.'],
    ['MC-BM03', 'Jasmine Night Body Mist', 'Fragrance', 499, 429, 210, 18, 75, 'A light mist of Indian jasmine and white musk. Layer it over lotion for longer wear.'],
    ['MC-FR04', 'Oud Royale Eau de Parfum', 'Fragrance', 1899, 1599, 800, 18, 40, 'Oud, saffron and amber in a long-lasting eau de parfum for evenings.'],
    ['MC-LS05', 'Velvet Matte Lipstick, Royal Rose', 'Makeup', 649, 549, 270, 18, 120, 'Weightless matte colour that stays for hours, with vitamin E so lips do not dry out.'],
    ['MC-FD06', 'Silk Finish Foundation SPF 20', 'Makeup', 899, 749, 370, 18, 60, 'Buildable, breathable coverage in shades made for Indian skin tones.'],
    ['MC-KJ07', 'Kohl Intense Kajal', 'Makeup', 299, 249, 120, 18, 200, 'Smudge-proof, water-resistant kajal that glides on jet black in one swipe.'],
    ['MC-CP08', 'Pearl Glow Compact Powder', 'Makeup', 549, 459, 230, 18, 60, 'Oil-control compact with finely milled pearl powder for a soft, even finish.'],
    ['MC-SR09', 'Vitamin C Brightening Serum', 'Skin Care', 999, 799, 400, 18, 85, '15% vitamin C with ferulic acid to fade dullness and dark spots over weeks.'],
    ['MC-FC10', 'Saffron Glow Day Cream', 'Skin Care', 749, 629, 310, 18, 70, 'Kashmiri saffron and niacinamide for an even, luminous complexion.'],
    ['MC-GL11', 'Lotus Aloe Soothing Gel', 'Skin Care', 399, 329, 160, 18, 150, 'Cooling aloe and pink lotus gel that calms sun-stressed skin.'],
    ['MC-SS12', 'Sun Shield Gel SPF 50', 'Skin Care', 599, 499, 250, 18, 110, 'Broad-spectrum protection in a light gel. No white cast, no grease.'],
    ['MC-KN13', 'Kumkumadi Night Elixir', 'Skin Care', 1299, 1099, 550, 18, 35, 'Ayurvedic night oil with saffron and sixteen herbs for overnight radiance.'],
    ['MC-HO14', 'Onion & Bhringraj Hair Oil', 'Hair Care', 449, 379, 190, 5, 130, 'Nourishing oil blend that strengthens roots and reduces breakage.'],
    ['MC-SH15', 'Keratin Smooth Shampoo', 'Hair Care', 499, 419, 210, 5, 95, 'Sulphate-free shampoo with keratin for smoother, frizz-free hair.'],
    ['MC-HM16', 'Argan Repair Hair Mask', 'Hair Care', 699, 579, 290, 18, 60, 'Weekly mask that repairs heat and colour damage.'],
];
const FIRST = ['Priya', 'Rahul', 'Ananya', 'Sourav', 'Riya', 'Arjun', 'Sneha', 'Vikram', 'Pooja', 'Karan', 'Moumita', 'Debjit', 'Nisha', 'Aditya', 'Tanisha', 'Imran', 'Kavya', 'Rohit', 'Meera', 'Subir'];
const LAST = ['Sharma', 'Das', 'Ghosh', 'Paul', 'Sen', 'Mehta', 'Roy', 'Singh', 'Iyer', 'Banerjee', 'Saha', 'Verma', 'Dutta', 'Nair'];
const PLACES = [
    ['Kolkata', 'West Bengal', '700016'], ['Siliguri', 'West Bengal', '734001'], ['Howrah', 'West Bengal', '711101'],
    ['Durgapur', 'West Bengal', '713201'], ['Patna', 'Bihar', '800001'], ['Ranchi', 'Jharkhand', '834001'],
    ['Bhubaneswar', 'Odisha', '751001'], ['Guwahati', 'Assam', '781001'], ['Lucknow', 'Uttar Pradesh', '226001'],
];
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/* ------------------------------------------------------------- bootstrap */
async function bootstrap() {
    console.log('→ plan version');
    const existingPlan = await prisma.planVersion.findFirst({ orderBy: { version: 'desc' } });
    const plan = existingPlan
        ? existingPlan
        : await prisma.planVersion.create({
            data: { config: plan_config_1.CLIENT_DEFAULT_PLAN, note: "Client's plan document, September 2026" },
        });
    console.log(`  ${existingPlan ? 'kept' : 'created'} version ${plan.version}`);
    console.log('→ store settings');
    const settings = [
        ['store', { name: 'Majestic Cart', tagline: 'Royal beauty, rewarded', phone: '+91 90000 00000', email: 'care@majesticcart.in', domain: 'majesticcart.in' }],
        ['payment', {
                upiId: 'majesticcart@upi', payee: 'Majestic Cart', qrObjectKey: null,
                minRechargePaise: (0, money_1.rupeesToPaise)(500).toString(), maxRechargePaise: (0, money_1.rupeesToPaise)(100000).toString(),
                instructions: 'Scan the QR with any UPI app and pay the exact amount. Then enter the 12-digit UTR and upload the payment screenshot.',
            }],
        ['security', { largeRechargePaise: (0, money_1.rupeesToPaise)(25000).toString(), maxRechargesPerDay: 3, maxAccountsPerDevice: 2 }],
    ];
    for (const [key, value] of settings) {
        await prisma.storeSetting.upsert({ where: { key }, create: { key, value }, update: {} });
    }
    console.log('→ number series');
    for (const [key, prefix, next] of [['member', 'MC', 100001], ['order', 'OD', 24001]]) {
        await prisma.numberSeries.upsert({
            where: { key }, create: { key, prefix, nextValue: next }, update: {},
        });
    }
    console.log('→ categories and products');
    const categoryIds = new Map();
    for (const [i, name] of CATEGORIES.entries()) {
        const cat = await prisma.category.upsert({ where: { name }, create: { name, slug: slugify(name), sortkey: i }, update: { sortkey: i } });
        categoryIds.set(name, cat.id);
    }
    for (const [sku, name, category, mrp, price, bv, gst, stock, description] of PRODUCTS) {
        await prisma.product.upsert({
            where: { sku },
            create: {
                sku, name, slug: slugify(name), description, categoryId: categoryIds.get(category),
                mrpPaise: (0, money_1.rupeesToPaise)(mrp), pricePaise: (0, money_1.rupeesToPaise)(price),
                bvCenti: (0, money_1.bvToCenti)(bv), gstBp: gst * 100, stock, isActive: true,
                hsnCode: '3304',
            },
            // Keep price and stock as the admin left them; only refresh copy.
            update: { name, description, categoryId: categoryIds.get(category) },
        });
    }
    console.log(`  ${PRODUCTS.length} products across ${CATEGORIES.length} categories`);
    console.log('→ company root member');
    const company = await prisma.member.upsert({
        where: { memberCode: 'MC100001' },
        create: {
            memberCode: 'MC100001', name: 'Majestic Cart (company)', phone: '9000000000',
            email: 'company@majesticcart.in', passwordHash: await argon2.hash(randomSecret()),
            isCompany: true, ancestorPath: '/', depth: 0,
            wallets: { create: [{ kind: 'SHOPPING' }, { kind: 'INCOME' }] },
        },
        update: {},
    });
    console.log('→ admin user');
    const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@majesticcart.in';
    const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? (DEMO ? 'admin-demo-2026!' : randomSecret());
    const admin = await prisma.adminUser.upsert({
        where: { email: adminEmail },
        create: { email: adminEmail, name: 'Owner', role: 'ADMIN', passwordHash: await argon2.hash(adminPassword) },
        update: {},
    });
    if (!process.env.SEED_ADMIN_PASSWORD && !DEMO) {
        // Printed once, never stored. If this scrolls past, reset it rather than
        // going looking for it.
        console.log(`\n  ADMIN PASSWORD (shown once): ${adminPassword}\n  Change it after the first login.\n`);
    }
    return { plan, company, admin, categoryIds };
}
const randomSecret = () => `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2).toUpperCase()}!7`;
/* ------------------------------------------------------------ demo data */
async function seedDemo(ctx) {
    if (process.env.NODE_ENV === 'production' && !FORCE) {
        throw new Error('Refusing to write demo data with NODE_ENV=production. Pass --force if you really mean it.');
    }
    if (await prisma.order.count() > 0) {
        console.log('→ demo data already present, skipping');
        return;
    }
    const plan = plan_config_1.CLIENT_DEFAULT_PLAN;
    const products = await prisma.product.findMany({ orderBy: { sku: 'asc' } });
    const now = new Date();
    const MONTHS = 12;
    const start = new Date(now.getFullYear(), now.getMonth() - (MONTHS - 1), 1);
    console.log('→ demo members');
    const password = await argon2.hash('demo123456');
    const members = [];
    const pool = [{ id: ctx.company.id, ancestorPath: '/', depth: 0 }];
    for (let i = 0; i < 40; i++) {
        const sponsor = i < 3 ? pool[0] : pool[int(0, Math.min(pool.length - 1, 3 + i))];
        const [city, state, pincode] = PLACES[i % PLACES.length];
        const name = `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`;
        const phone = `98765${String(10000 + i).slice(-5)}`;
        const joinedAt = new Date(start.getTime() + (i / 40) * (now.getTime() - start.getTime()) * 0.8);
        const code = `MC${100002 + i}`;
        const member = await prisma.member.create({
            data: {
                memberCode: code, name, phone, email: `${name.split(' ')[0].toLowerCase()}.${i}@example.com`,
                passwordHash: password, sponsorId: sponsor.id,
                ancestorPath: `${sponsor.ancestorPath}${sponsor.id}/`, depth: sponsor.depth + 1,
                joinedAt, status: rnd() > 0.95 ? 'ON_HOLD' : 'ACTIVE',
                addressLine: `${int(10, 99)}, ${pick(['Lake Road', 'Station Para', 'MG Road', 'College More'])}`,
                city, state, pincode,
                payoutUpi: rnd() > 0.4 ? `${phone}@ybl` : null,
                lastDeviceId: `DEV-DEMO-${i}`,
                wallets: { create: [{ kind: 'SHOPPING' }, { kind: 'INCOME' }] },
            },
        });
        const entry = { id: member.id, code, ancestorPath: member.ancestorPath, depth: member.depth, sponsorId: sponsor.id };
        members.push(entry);
        pool.push({ id: member.id, ancestorPath: member.ancestorPath, depth: member.depth });
    }
    await prisma.numberSeries.update({ where: { key: 'member' }, data: { nextValue: 100002 + members.length } });
    console.log(`  ${members.length} members`);
    console.log('→ demo orders, recharges and commission');
    // State we maintain by hand, because the real services run inside HTTP
    // requests and a queue. The arithmetic mirrors CommissionService exactly.
    const wallet = new Map();
    const volume = new Map();
    members.forEach((m) => { wallet.set(m.id, { shopping: 0n, income: 0n }); volume.set(m.id, { self: 0, group: 0, rank: 0 }); });
    const uplineOf = (m) => m.ancestorPath.split('/').filter(Boolean).reverse()
        .map((id) => members.find((x) => x.id === id))
        .filter((x) => !!x);
    let orderNo = 24001;
    let orderCount = 0, commissionCount = 0, rechargeCount = 0;
    for (let mi = 0; mi < MONTHS; mi++) {
        const monthStart = new Date(start.getFullYear(), start.getMonth() + mi, 1);
        const monthEnd = new Date(start.getFullYear(), start.getMonth() + mi + 1, 1);
        for (const m of members) {
            const row = await prisma.member.findUniqueOrThrow({ where: { id: m.id }, select: { joinedAt: true, status: true } });
            if (row.joinedAt >= monthEnd)
                continue;
            if (row.status !== 'ACTIVE' && rnd() > 0.2)
                continue;
            const isFirstMonth = row.joinedAt >= monthStart;
            const seller = rnd() < 0.25;
            // Most members buy just enough to clear the repurchase gate; a minority
            // genuinely sell. That shape is what the compliance histogram surfaces.
            const targetBv = isFirstMonth ? (0, money_1.bvToCenti)(2000 + int(0, 600))
                : seller ? (0, money_1.bvToCenti)(int(600, 3000))
                    : rnd() < 0.7 ? (0, money_1.bvToCenti)(int(500, 560))
                        : rnd() < 0.5 ? 0 : (0, money_1.bvToCenti)(int(200, 450));
            if (targetBv <= 0)
                continue;
            const when = new Date(monthStart.getTime() + int(1, 24) * 864e5);
            if (when > now)
                continue;
            // --- build the basket ---
            const lines = [];
            let bv = 0, gross = 0n, gst = 0n;
            const cheap = [...products].sort((a, b) => a.bvCenti - b.bvCenti).slice(0, 3);
            let guard = 0;
            while (bv < targetBv && guard++ < 8) {
                const p = seller || isFirstMonth ? pick(products) : pick(cheap);
                const qty = seller || isFirstMonth ? int(1, 3) : 1;
                lines.push({ product: p, qty });
                bv += p.bvCenti * qty;
                const line = p.pricePaise * BigInt(qty);
                gross += line;
                gst += (line * BigInt(p.gstBp)) / BigInt(10000 + p.gstBp);
            }
            // --- fund the wallet first, as a real member would ---
            const balance = wallet.get(m.id);
            if (balance.shopping < gross) {
                const topUp = ((gross - balance.shopping) / 100000n + 1n) * 100000n; // round up to ₹1000
                const rechargeAt = new Date(when.getTime() - int(1, 4) * 864e5);
                const flagged = rnd() < 0.08;
                await prisma.recharge.create({
                    data: {
                        memberId: m.id, claimedPaise: topUp, creditedPaise: topUp,
                        utr: String(100000000000 + Math.floor(rnd() * 899999999999)),
                        screenshotKey: `demo/receipts/${m.code}-${rechargeCount}.jpg`,
                        status: 'APPROVED', flags: flagged ? ['LARGE_AMOUNT'] : [],
                        createdAt: rechargeAt, reviewedAt: new Date(rechargeAt.getTime() + int(10, 300) * 60000),
                        reviewedById: ctx.admin.id,
                    },
                });
                balance.shopping += topUp;
                rechargeCount++;
                await postLedger(m.id, 'SHOPPING', 'CREDIT', topUp, 'RECHARGE', balance.shopping, rechargeAt, `recharge:${m.code}:${rechargeCount}`);
            }
            // --- the order ---
            const delivered = when < new Date(now.getTime() - 4 * 864e5);
            const status = delivered ? 'DELIVERED' : pick(['PLACED', 'PACKED', 'SHIPPED']);
            const deliveredAt = delivered ? new Date(when.getTime() + int(26, 96) * 36e5) : null;
            const code = `OD${orderNo++}`;
            const member = await prisma.member.findUniqueOrThrow({ where: { id: m.id } });
            const order = await prisma.order.create({
                data: {
                    orderNo: code, memberId: m.id, status,
                    subtotalPaise: gross - gst, gstPaise: gst, totalPaise: gross, totalBvCenti: bv,
                    isFirstPurchase: isFirstMonth, createdAt: when, deliveredAt,
                    planVersionId: delivered ? ctx.plan.id : null,
                    invoiceNo: delivered ? `INV/${financialYear(when)}/${orderNo}` : null,
                    invoicedAt: deliveredAt,
                    commissionRunAt: deliveredAt,
                    shipName: member.name, shipPhone: member.phone, shipLine: member.addressLine ?? '',
                    shipCity: member.city ?? '', shipState: member.state ?? '', shipPincode: member.pincode ?? '',
                    items: { create: lines.map((l) => ({
                            productId: l.product.id, nameSnapshot: l.product.name, pricePaise: l.product.pricePaise,
                            mrpPaise: l.product.mrpPaise, bvCenti: l.product.bvCenti, gstBp: l.product.gstBp, quantity: l.qty,
                        })) },
                    events: { create: { status: 'PLACED', createdAt: when } },
                },
            });
            orderCount++;
            balance.shopping -= gross;
            await postLedger(m.id, 'SHOPPING', 'DEBIT', gross, 'ORDER_PAYMENT', balance.shopping, when, `order-pay:${order.id}`);
            for (const l of lines) {
                // Demo data spans a year of orders and can outrun a product's seeded
                // starting stock; clamp at 0 rather than violate the non-negative
                // stock check constraint (0002_constraints).
                await prisma.$executeRaw `UPDATE "Product" SET stock = GREATEST(stock - ${l.qty}, 0), sold = sold + ${l.qty} WHERE id = ${l.product.id}`;
            }
            if (!delivered)
                continue;
            // --- commission, mirroring CommissionService ---
            const chain = uplineOf(m);
            volume.get(m.id).self += bv;
            volume.get(m.id).group += bv;
            chain.forEach((u) => { volume.get(u.id).group += bv; });
            await prisma.member.update({ where: { id: m.id }, data: { selfBvCenti: { increment: BigInt(bv) }, groupBvCenti: { increment: BigInt(bv) } } });
            if (chain.length) {
                await prisma.member.updateMany({ where: { id: { in: chain.map((u) => u.id) } }, data: { groupBvCenti: { increment: BigInt(bv) } } });
            }
            await prisma.monthlyVolume.upsert({
                where: { memberId_period: { memberId: m.id, period: (0, period_1.isoPeriod)(deliveredAt) } },
                create: { memberId: m.id, period: (0, period_1.isoPeriod)(deliveredAt), selfBvCenti: bv, groupBvCenti: bv },
                update: { selfBvCenti: { increment: bv }, groupBvCenti: { increment: bv } },
            });
            const pay = async (target, pctBp, type, gen, depth) => {
                const { amountPaise, remainderPaise } = (0, money_1.commissionOn)(bv, pctBp);
                if (amountPaise <= 0n)
                    return;
                const dedupeKey = `commission:${order.id}:${target.id}:${type}:${gen ?? '_'}`;
                await prisma.commission.create({
                    data: {
                        orderId: order.id, memberId: target.id, type, sourceBvCenti: bv, pctBp,
                        amountPaise, remainderPaise, generationLevel: gen ?? null, uplineDepth: depth ?? null,
                        planVersionId: ctx.plan.id, dedupeKey, createdAt: deliveredAt,
                    },
                });
                const w = wallet.get(target.id);
                w.income += amountPaise;
                const ledgerCategory = type === 'GENERATION' ? 'GENERATION_BONUS' : `${type}_INCOME`;
                await postLedger(target.id, 'INCOME', 'CREDIT', amountPaise, ledgerCategory, w.income, deliveredAt, dedupeKey, order.id);
                commissionCount++;
            };
            const selfBp = (0, plan_config_1.rankAt)(plan, volume.get(m.id).rank).selfPctBp;
            await pay(m, selfBp, 'SELF');
            if (isFirstMonth && chain[0])
                await pay(chain[0], plan.direct.pctBp, 'DIRECT', undefined, 1);
            let paidBp = selfBp;
            const topBp = Math.max(...plan.ranks.map((r) => r.selfPctBp));
            for (const [i, u] of chain.entries()) {
                if (paidBp >= topBp)
                    break;
                const upBp = (0, plan_config_1.rankAt)(plan, volume.get(u.id).rank).selfPctBp;
                if (upBp > paidBp) {
                    await pay(u, upBp - paidBp, 'TEAM', undefined, i + 1);
                    paidBp = upBp;
                }
            }
            let gen = 0;
            for (const [i, u] of chain.entries()) {
                if (gen >= plan.generation.levelsBp.length)
                    break;
                if (volume.get(u.id).rank < plan.generation.minRankIndex)
                    continue;
                await pay(u, plan.generation.levelsBp[gen], 'GENERATION', gen + 1, i + 1);
                gen++;
            }
            // Promotions apply from the next order, matching the engine.
            for (const target of [m, ...chain]) {
                const v = volume.get(target.id);
                const basis = plan.rankBasis === 'TEAM_BV' ? v.group - v.self : v.group;
                const next = (0, plan_config_1.rankIndexFor)(plan, basis);
                if (next > v.rank) {
                    await prisma.member.update({ where: { id: target.id }, data: { rankIndex: next } });
                    await prisma.rankChange.create({
                        data: { memberId: target.id, fromIndex: v.rank, toIndex: next, atBvCenti: BigInt(basis), planVersionId: ctx.plan.id, createdAt: deliveredAt },
                    });
                    v.rank = next;
                }
            }
            for (const fund of plan.royalty.funds) {
                await prisma.royaltyPool.upsert({ where: { fundKey: fund.key }, create: { fundKey: fund.key, accBvCenti: bv }, update: { accBvCenti: { increment: bv } } });
            }
        }
    }
    // --- sync materialised wallet balances ---
    for (const [memberId, bal] of wallet) {
        await prisma.wallet.update({ where: { memberId_kind: { memberId, kind: 'SHOPPING' } }, data: { balancePaise: bal.shopping } });
        await prisma.wallet.update({ where: { memberId_kind: { memberId, kind: 'INCOME' } }, data: { balancePaise: bal.income } });
    }
    console.log('→ pending items for the admin queue');
    // A few things left undecided, so the console has real work in it on day one.
    const busy = members.slice(0, 3);
    for (const [i, m] of busy.entries()) {
        await prisma.recharge.create({
            data: {
                memberId: m.id, claimedPaise: (0, money_1.rupeesToPaise)([5000, 2000, 30000][i]),
                utr: String(100000000000 + Math.floor(rnd() * 899999999999)),
                screenshotKey: `demo/receipts/pending-${i}.jpg`, status: 'PENDING',
                flags: i === 2 ? ['LARGE_AMOUNT'] : [],
                createdAt: new Date(now.getTime() - int(1, 20) * 36e5),
            },
        });
    }
    await prisma.securityAlert.create({
        data: { severity: 'HIGH', type: 'MULTIPLE_ACCOUNTS', message: '3 accounts created from one device', memberId: members[0].id, refType: 'device', refId: 'DEV-DEMO-0' },
    });
    const earner = [...wallet.entries()].sort((a, b) => Number(b[1].income - a[1].income))[0];
    if (earner && earner[1].income > (0, money_1.rupeesToPaise)(600)) {
        const amount = (0, money_1.rupeesToPaise)(500);
        const deduction = (amount * BigInt(plan_config_1.CLIENT_DEFAULT_PLAN.withdrawal.deductionBp)) / 10000n;
        await prisma.withdrawal.create({
            data: {
                memberId: earner[0], requestedPaise: amount, deductionPaise: deduction, netPaise: amount - deduction,
                deductionBp: plan_config_1.CLIENT_DEFAULT_PLAN.withdrawal.deductionBp, status: 'PENDING',
                payoutSnapshot: { upi: 'demo@ybl' }, createdAt: new Date(now.getTime() - 6 * 36e5),
            },
        });
    }
    console.log(`  ${orderCount} orders, ${commissionCount} commission legs, ${rechargeCount} recharges`);
    const totalRevenue = await prisma.order.aggregate({ _sum: { totalPaise: true }, where: { status: { not: 'CANCELLED' } } });
    const totalCommission = await prisma.commission.aggregate({ _sum: { amountPaise: true } });
    console.log(`  revenue ${(0, money_1.formatInr)(totalRevenue._sum.totalPaise ?? 0n)}, commission ${(0, money_1.formatInr)(totalCommission._sum.amountPaise ?? 0n)}`);
    console.log('\n  Demo member login: 9876510000 / demo123456');
    console.log('  Demo admin login:  admin@majesticcart.in / admin-demo-2026!\n');
}
let journalCounter = 0;
async function postLedger(memberId, kind, direction, amountPaise, category, balanceAfter, at, idempotencyKey, refId) {
    const w = await prisma.wallet.findUniqueOrThrow({ where: { memberId_kind: { memberId, kind } }, select: { id: true } });
    await prisma.ledgerEntry.create({
        data: {
            journalId: `seed-${journalCounter++}`, memberId, walletId: w.id, direction,
            amountPaise, category: category, balanceAfter,
            refType: refId ? 'order' : undefined, refId, idempotencyKey, createdAt: at,
        },
    });
}
function financialYear(d) {
    const year = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
    return `${year}-${String((year + 1) % 100).padStart(2, '0')}`;
}
/* ------------------------------------------------------------------ run */
async function main() {
    console.log(`Seeding${DEMO ? ' with demo data' : ''}…\n`);
    const ctx = await bootstrap();
    if (DEMO)
        await seedDemo(ctx);
    console.log('Done.');
}
main()
    .catch((e) => { console.error('\nSeed failed:', e); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
