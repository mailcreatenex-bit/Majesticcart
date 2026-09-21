/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';
import { encryptIfNeeded, blindIndex, isEncrypted, needsRotation, rotateField, initEncryption, ctx } from '../src/common/crypto';

/**
 * Encrypt payout details and TOTP secrets that were written before field
 * encryption existed, and re-encrypt anything still on a retired key.
 *
 * Safe to re-run: encryptIfNeeded is a no-op on an already-encrypted value, so
 * a half-finished run can simply be started again.
 *
 *   npx ts-node prisma/backfill-encryption.ts
 */
const prisma = new PrismaClient();

async function main() {
  initEncryption();
  console.log('Backfilling field encryption…\n');

  const members = await prisma.member.findMany({
    select: { id: true, memberCode: true, payoutUpi: true, payoutAccount: true, payoutIfsc: true },
  });

  let encrypted = 0, rotated = 0;
  for (const m of members) {
    if (!m.payoutUpi && !m.payoutAccount && !m.payoutIfsc) continue;

    const wasEncrypted = isEncrypted(m.payoutAccount ?? m.payoutUpi ?? '');
    const needsKeyRotation = wasEncrypted && needsRotation(m.payoutAccount ?? m.payoutUpi ?? '');

    // Blind indexes are computed from plaintext, so they must be written before
    // the value is encrypted — or read back out of an already-encrypted one.
    const plainUpi = wasEncrypted ? null : m.payoutUpi;
    const plainAccount = wasEncrypted ? null : m.payoutAccount;

    await prisma.member.update({
      where: { id: m.id },
      data: {
        payoutUpi: needsKeyRotation && m.payoutUpi
          ? rotateField(m.payoutUpi, ctx.payoutUpi(m.id))
          : encryptIfNeeded(m.payoutUpi, ctx.payoutUpi(m.id)),
        payoutAccount: needsKeyRotation && m.payoutAccount
          ? rotateField(m.payoutAccount, ctx.payoutAccount(m.id))
          : encryptIfNeeded(m.payoutAccount, ctx.payoutAccount(m.id)),
        payoutIfsc: needsKeyRotation && m.payoutIfsc
          ? rotateField(m.payoutIfsc, ctx.payoutIfsc(m.id))
          : encryptIfNeeded(m.payoutIfsc, ctx.payoutIfsc(m.id)),
        ...(plainUpi ? { payoutUpiIndex: blindIndex(plainUpi, 'upi') } : {}),
        ...(plainAccount ? { payoutAccountIndex: blindIndex(plainAccount, 'account') } : {}),
      },
    });
    if (needsKeyRotation) rotated++; else if (!wasEncrypted) encrypted++;
  }

  const admins = await prisma.adminUser.findMany({ select: { id: true, email: true, totpSecret: true } });
  let secrets = 0;
  for (const a of admins) {
    if (!a.totpSecret) continue;
    const next = needsRotation(a.totpSecret)
      ? rotateField(a.totpSecret, ctx.totpSecret(a.id))
      : encryptIfNeeded(a.totpSecret, ctx.totpSecret(a.id));
    if (next !== a.totpSecret) {
      await prisma.adminUser.update({ where: { id: a.id }, data: { totpSecret: next } });
      secrets++;
    }
  }

  console.log(`  ${encrypted} payout record(s) encrypted, ${rotated} rotated, ${secrets} TOTP secret(s) handled`);
  console.log('Done.');
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
