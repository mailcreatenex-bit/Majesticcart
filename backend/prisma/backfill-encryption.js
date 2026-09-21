"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/* eslint-disable no-console */
const client_1 = require("@prisma/client");
const crypto_1 = require("../src/common/crypto");
/**
 * Encrypt payout details and TOTP secrets that were written before field
 * encryption existed, and re-encrypt anything still on a retired key.
 *
 * Safe to re-run: encryptIfNeeded is a no-op on an already-encrypted value, so
 * a half-finished run can simply be started again.
 *
 *   npx ts-node prisma/backfill-encryption.ts
 */
const prisma = new client_1.PrismaClient();
async function main() {
    (0, crypto_1.initEncryption)();
    console.log('Backfilling field encryption…\n');
    const members = await prisma.member.findMany({
        select: { id: true, memberCode: true, payoutUpi: true, payoutAccount: true, payoutIfsc: true },
    });
    let encrypted = 0, rotated = 0;
    for (const m of members) {
        if (!m.payoutUpi && !m.payoutAccount && !m.payoutIfsc)
            continue;
        const wasEncrypted = (0, crypto_1.isEncrypted)(m.payoutAccount ?? m.payoutUpi ?? '');
        const needsKeyRotation = wasEncrypted && (0, crypto_1.needsRotation)(m.payoutAccount ?? m.payoutUpi ?? '');
        // Blind indexes are computed from plaintext, so they must be written before
        // the value is encrypted — or read back out of an already-encrypted one.
        const plainUpi = wasEncrypted ? null : m.payoutUpi;
        const plainAccount = wasEncrypted ? null : m.payoutAccount;
        await prisma.member.update({
            where: { id: m.id },
            data: {
                payoutUpi: needsKeyRotation && m.payoutUpi
                    ? (0, crypto_1.rotateField)(m.payoutUpi, crypto_1.ctx.payoutUpi(m.id))
                    : (0, crypto_1.encryptIfNeeded)(m.payoutUpi, crypto_1.ctx.payoutUpi(m.id)),
                payoutAccount: needsKeyRotation && m.payoutAccount
                    ? (0, crypto_1.rotateField)(m.payoutAccount, crypto_1.ctx.payoutAccount(m.id))
                    : (0, crypto_1.encryptIfNeeded)(m.payoutAccount, crypto_1.ctx.payoutAccount(m.id)),
                payoutIfsc: needsKeyRotation && m.payoutIfsc
                    ? (0, crypto_1.rotateField)(m.payoutIfsc, crypto_1.ctx.payoutIfsc(m.id))
                    : (0, crypto_1.encryptIfNeeded)(m.payoutIfsc, crypto_1.ctx.payoutIfsc(m.id)),
                ...(plainUpi ? { payoutUpiIndex: (0, crypto_1.blindIndex)(plainUpi, 'upi') } : {}),
                ...(plainAccount ? { payoutAccountIndex: (0, crypto_1.blindIndex)(plainAccount, 'account') } : {}),
            },
        });
        if (needsKeyRotation)
            rotated++;
        else if (!wasEncrypted)
            encrypted++;
    }
    const admins = await prisma.adminUser.findMany({ select: { id: true, email: true, totpSecret: true } });
    let secrets = 0;
    for (const a of admins) {
        if (!a.totpSecret)
            continue;
        const next = (0, crypto_1.needsRotation)(a.totpSecret)
            ? (0, crypto_1.rotateField)(a.totpSecret, crypto_1.ctx.totpSecret(a.id))
            : (0, crypto_1.encryptIfNeeded)(a.totpSecret, crypto_1.ctx.totpSecret(a.id));
        if (next !== a.totpSecret) {
            await prisma.adminUser.update({ where: { id: a.id }, data: { totpSecret: next } });
            secrets++;
        }
    }
    console.log(`  ${encrypted} payout record(s) encrypted, ${rotated} rotated, ${secrets} TOTP secret(s) handled`);
    console.log('Done.');
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
