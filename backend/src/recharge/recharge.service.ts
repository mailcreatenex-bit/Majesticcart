import { Injectable, Logger, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { LedgerService, idempotencyKey } from '../ledger/ledger.service';
import { parsePlan } from '../plan/plan.config';
import { commissionOn, formatInr, Paise } from '../common/money';
import { upiQrSvg } from './upi-qr';

/**
 * Manual UPI recharge.
 *
 * Members scan a static QR, pay, then submit the UTR and a screenshot. An admin
 * matches it against the bank statement and credits the shopping wallet. There
 * is no payment gateway callback, so the UTR is the only thing tying a claim to
 * real money — which makes duplicate-UTR detection the single most important
 * control in this module.
 */

const UTR_RE = /^[A-Z0-9]{12,22}$/;

export type Flag =
  | 'DUPLICATE_UTR'
  | 'REUSED_SCREENSHOT'
  | 'LARGE_AMOUNT'
  | 'VELOCITY'
  | 'SHARED_DEVICE';

export interface SubmitRechargeInput {
  memberId: string;
  claimedPaise: Paise;
  utr: string;
  screenshotKey: string;
  screenshotSha256: string;
  deviceId?: string;
}

interface SecuritySettings {
  largeRechargePaise: string;
  maxRechargesPerDay: number;
  maxAccountsPerDevice: number;
}

@Injectable()
export class RechargeService {
  private readonly log = new Logger(RechargeService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly ledger: LedgerService,
  ) {}

  private async settings(): Promise<{ security: SecuritySettings; payment: { minRechargePaise: string; maxRechargePaise: string } }> {
    const rows = await this.prisma.storeSetting.findMany({ where: { key: { in: ['security', 'payment'] } } });
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value as any]));
    return {
      security: map.security ?? { largeRechargePaise: '2500000', maxRechargesPerDay: 3, maxAccountsPerDevice: 2 },
      payment: map.payment ?? { minRechargePaise: '50000', maxRechargePaise: '10000000' },
    };
  }

  /**
   * The payee details and a QR for the recharge screen.
   *
   * No amount is encoded in the QR. A fixed-amount intent would have to be
   * regenerated on every keystroke, and worse: a member who scans it and then
   * edits the amount in their UPI app produces a payment that does not match
   * the request they submit, which is exactly the mismatch the admin then has
   * to chase. An open-amount QR means the number they type in their app is the
   * number they type here.
   */
  async payInfo() {
    const rows = await this.prisma.storeSetting.findMany({ where: { key: { in: ['payment'] } } });
    const payment = (rows.find((r) => r.key === 'payment')?.value ?? {}) as Record<string, string>;

    const upiId = payment.upiId ?? '';
    const payeeName = payment.payeeName ?? 'Majestic Cart';
    const minPaise = BigInt(payment.minRechargePaise ?? '50000');
    const maxPaise = BigInt(payment.maxRechargePaise ?? '10000000');

    // An unconfigured UPI ID is a setup error, and it must not render as a
    // broken QR the member scans anyway. The client shows "unavailable".
    if (!upiId) {
      throw new BadRequestException('Online payment is not configured yet. Please contact customer care.');
    }

    return {
      upiId,
      payeeName,
      qrUrl: `data:image/svg+xml;base64,${Buffer.from(
        await upiQrSvg({ vpa: upiId, name: payeeName }),
      ).toString('base64')}`,
      minPaise: Number(minPaise),
      maxPaise: Number(maxPaise),
      note: payment.note ?? 'Send the exact amount in one transfer, then submit the UTR below.',
    };
  }

  async submit(input: SubmitRechargeInput) {
    const utr = input.utr.trim().toUpperCase().replace(/\s+/g, '');
    if (!UTR_RE.test(utr)) {
      throw new BadRequestException('Enter the UTR exactly as shown in your UPI app (12 digits for UPI).');
    }

    const member = await this.prisma.member.findUniqueOrThrow({ where: { id: input.memberId } });
    if (member.status !== 'ACTIVE') throw new BadRequestException('Your account is on hold. Contact support.');

    const { security, payment } = await this.settings();
    const min = BigInt(payment.minRechargePaise);
    const max = BigInt(payment.maxRechargePaise);
    if (input.claimedPaise < min) throw new BadRequestException(`Minimum recharge is ${formatInr(min)}.`);
    if (input.claimedPaise > max) throw new BadRequestException(`Maximum per request is ${formatInr(max)}. Split larger payments.`);

    // Hard stop: this UTR has already been paid out once.
    const approvedSame = await this.prisma.recharge.findFirst({ where: { utr, status: 'APPROVED' } });
    if (approvedSame) {
      throw new ConflictException('This UTR has already been credited. Contact support if you think that is wrong.');
    }
    const ownPending = await this.prisma.recharge.findFirst({
      where: { utr, memberId: member.id, status: 'PENDING' },
    });
    if (ownPending) throw new ConflictException("You've already sent this UTR. It's in review.");

    const flags = await this.detectFlags({ ...input, utr }, member, security);

    const recharge = await this.prisma.recharge.create({
      data: {
        memberId: member.id,
        claimedPaise: input.claimedPaise,
        utr,
        screenshotKey: input.screenshotKey,
        screenshotSha256: input.screenshotSha256,
        flags,
        status: 'PENDING',
      },
    });

    for (const flag of flags) {
      await this.prisma.securityAlert.create({
        data: {
          severity: flag === 'DUPLICATE_UTR' || flag === 'REUSED_SCREENSHOT' ? 'HIGH' : 'MEDIUM',
          type: flag,
          message: this.flagMessage(flag, member.name, input.claimedPaise, utr),
          memberId: member.id,
          refType: 'recharge',
          refId: recharge.id,
        },
      });
    }

    await this.prisma.notification.create({
      data: {
        memberId: member.id,
        title: 'Payment proof received',
        body: `${formatInr(input.claimedPaise)} with UTR ${utr} is in review. Your wallet updates once it's verified.`,
        kind: 'WALLET',
      },
    });

    return recharge;
  }

  private async detectFlags(
    input: SubmitRechargeInput & { utr: string },
    member: { id: string; name: string },
    security: SecuritySettings,
  ): Promise<Flag[]> {
    const flags: Flag[] = [];
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    if (await this.prisma.recharge.findFirst({ where: { utr: input.utr } })) {
      flags.push('DUPLICATE_UTR');
    }
    // Same image bytes submitted before, usually from a different account.
    if (
      input.screenshotSha256 &&
      (await this.prisma.recharge.findFirst({ where: { screenshotSha256: input.screenshotSha256 } }))
    ) {
      flags.push('REUSED_SCREENSHOT');
    }
    if (input.claimedPaise >= BigInt(security.largeRechargePaise)) flags.push('LARGE_AMOUNT');

    const recent = await this.prisma.recharge.count({
      where: { memberId: member.id, createdAt: { gte: dayAgo } },
    });
    if (recent + 1 > security.maxRechargesPerDay) flags.push('VELOCITY');

    if (input.deviceId) {
      const sharing = await this.prisma.deviceLink.count({ where: { deviceId: input.deviceId } });
      if (sharing > security.maxAccountsPerDevice) flags.push('SHARED_DEVICE');
    }
    return flags;
  }

  private flagMessage(flag: Flag, name: string, paise: Paise, utr: string): string {
    switch (flag) {
      case 'DUPLICATE_UTR':
        return `UTR ${utr} from ${name} matches an earlier request`;
      case 'REUSED_SCREENSHOT':
        return `${name} uploaded a payment screenshot that was used before`;
      case 'LARGE_AMOUNT':
        return `Large recharge of ${formatInr(paise)} from ${name}`;
      case 'VELOCITY':
        return `${name} sent several recharge requests within 24 hours`;
      case 'SHARED_DEVICE':
        return `${name} is recharging from a device shared by several accounts`;
    }
  }

  /**
   * Approve and credit.
   *
   * creditedPaise is deliberately separate from claimedPaise: the admin enters
   * what the bank statement actually shows, which is not always what the member
   * typed. The partial unique index on (utr) WHERE status='APPROVED' is the
   * backstop if two admins approve the same UTR at the same moment.
   */
  async approve(rechargeId: string, args: { adminId: string; creditedPaise: Paise; note?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string; status: string }[]>`
        SELECT id, status::text FROM "Recharge" WHERE id = ${rechargeId} FOR UPDATE
      `;
      if (locked.length === 0) throw new BadRequestException('Request not found.');
      if (locked[0].status !== 'PENDING') throw new ConflictException('This request was already processed.');

      const recharge = await tx.recharge.findUniqueOrThrow({ where: { id: rechargeId }, include: { member: true } });
      if (args.creditedPaise <= 0n) throw new BadRequestException('Enter the amount to credit.');

      const clash = await tx.recharge.findFirst({
        where: { utr: recharge.utr, status: 'APPROVED', id: { not: rechargeId } },
      });
      if (clash) throw new ConflictException('Another request with this UTR is already approved. Reject this one.');

      try {
        await tx.recharge.update({
          where: { id: rechargeId },
          data: {
            status: 'APPROVED',
            creditedPaise: args.creditedPaise,
            reviewNote: args.note?.trim(),
            reviewedById: args.adminId,
            reviewedAt: new Date(),
          },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictException('Another admin approved this UTR a moment ago.');
        }
        throw e;
      }

      await this.ledger.post(tx, {
        memberId: recharge.memberId,
        wallet: 'SHOPPING',
        direction: 'CREDIT',
        amountPaise: args.creditedPaise,
        category: 'RECHARGE',
        idempotencyKey: idempotencyKey('recharge', recharge.id),
        refType: 'recharge',
        refId: recharge.id,
        note: `UTR ${recharge.utr}`,
      });

      // WALLET_RECHARGE basis: the plan can pay the sponsor on the top-up
      // itself. Kept here rather than in the commission engine because no
      // product has been sold, so no BV exists.
      await this.maybePayRechargeDirect(tx, recharge.memberId, recharge.id, args.creditedPaise);

      await tx.notification.create({
        data: {
          memberId: recharge.memberId,
          title: 'Wallet recharged',
          body: `${formatInr(args.creditedPaise)} was added to your shopping wallet.`,
          kind: 'WALLET',
        },
      });
      await tx.securityAlert.updateMany({
        where: { refType: 'recharge', refId: recharge.id, resolved: false },
        data: { resolved: true, resolvedBy: args.adminId, resolvedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorType: 'ADMIN',
          actorId: args.adminId,
          action: 'recharge.approve',
          detail: { rechargeId, utr: recharge.utr, creditedPaise: args.creditedPaise.toString(), memberId: recharge.memberId },
        },
      });

      return { ok: true as const };
    });
  }

  private async maybePayRechargeDirect(
    tx: Prisma.TransactionClient,
    memberId: string,
    rechargeId: string,
    creditedPaise: Paise,
  ) {
    const planRow = await tx.planVersion.findFirst({ orderBy: { version: 'desc' } });
    if (!planRow) return;
    const plan = parsePlan(planRow.config);
    if (!plan.direct.enabled || plan.direct.basis !== 'WALLET_RECHARGE') return;

    const member = await tx.member.findUniqueOrThrow({ where: { id: memberId }, select: { sponsorId: true, name: true } });
    if (!member.sponsorId) return;
    const sponsor = await tx.member.findUnique({ where: { id: member.sponsorId } });
    if (!sponsor || sponsor.isCompany || sponsor.status !== 'ACTIVE') return;

    // Percentage of money, not of BV — there is no BV on a top-up.
    const amountPaise = (creditedPaise * BigInt(plan.direct.pctBp)) / 10_000n;
    if (amountPaise <= 0n) return;

    await this.ledger.post(tx, {
      memberId: sponsor.id,
      wallet: 'INCOME',
      direction: 'CREDIT',
      amountPaise,
      category: 'DIRECT_INCOME',
      idempotencyKey: idempotencyKey('recharge-direct', rechargeId),
      refType: 'recharge',
      refId: rechargeId,
      note: `${plan.direct.pctBp / 100}% of ${member.name}'s wallet recharge`,
      planVersionId: planRow.id,
    });
    this.log.warn(
      `Paid direct income on a wallet recharge (${rechargeId}). This rewards deposits rather than product sales — see ARCHITECTURE.md.`,
    );
  }

  async reject(rechargeId: string, args: { adminId: string; note: string }) {
    const note = args.note?.trim();
    if (!note) throw new BadRequestException('Add a reason so the member knows what to fix.');

    return this.prisma.$transaction(async (tx) => {
      const recharge = await tx.recharge.findUniqueOrThrow({ where: { id: rechargeId } });
      if (recharge.status !== 'PENDING') throw new ConflictException('This request was already processed.');

      await tx.recharge.update({
        where: { id: rechargeId },
        data: { status: 'REJECTED', reviewNote: note, reviewedById: args.adminId, reviewedAt: new Date() },
      });
      await tx.notification.create({
        data: {
          memberId: recharge.memberId,
          title: 'Recharge not approved',
          body: `${formatInr(recharge.claimedPaise)} with UTR ${recharge.utr}. Reason: ${note}`,
          kind: 'WALLET',
        },
      });
      await tx.securityAlert.updateMany({
        where: { refType: 'recharge', refId: rechargeId, resolved: false },
        data: { resolved: true, resolvedBy: args.adminId, resolvedAt: new Date() },
      });
      await tx.auditLog.create({
        data: { actorType: 'ADMIN', actorId: args.adminId, action: 'recharge.reject', detail: { rechargeId, note } },
      });
      return { ok: true as const };
    });
  }
}
