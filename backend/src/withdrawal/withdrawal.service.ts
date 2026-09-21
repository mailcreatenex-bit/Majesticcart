import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { LedgerService, idempotencyKey } from '../ledger/ledger.service';
import { parsePlan, PlanConfig } from '../plan/plan.config';
import { pctOfPaise, formatInr, centiToBvString, Paise } from '../common/money';
import { isoPeriod } from '../common/period';
import { decryptIfNeeded, lastFour, ctx as encCtx } from '../common/crypto';

/**
 * Income withdrawal.
 *
 * Money leaves the income wallet the moment the member requests it, not when
 * the admin pays out. Holding it up front stops a member from requesting twice
 * against the same balance, or from spending it while the request is in the
 * queue. If the request is rejected, the hold is reversed back into the wallet.
 *
 * Payouts are executed by hand in the bank or UPI app; this service only
 * records the reference. There is no payout gateway in scope.
 */

export interface WithdrawalQuote {
  requestedPaise: Paise;
  deductionPaise: Paise;
  netPaise: Paise;
  deductionBp: number;
}

@Injectable()
export class WithdrawalService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly ledger: LedgerService,
  ) {}

  /** The plan version currently in force. Controllers need it for quotes. */
  async currentPlan(): Promise<PlanConfig> {
    const row = await this.prisma.planVersion.findFirstOrThrow({ orderBy: { version: 'desc' } });
    return parsePlan(row.config);
  }

  quote(plan: PlanConfig, requestedPaise: Paise): WithdrawalQuote {
    const { amountPaise: deductionPaise } = pctOfPaise(requestedPaise, plan.withdrawal.deductionBp);
    return {
      requestedPaise,
      deductionPaise,
      netPaise: requestedPaise - deductionPaise,
      deductionBp: plan.withdrawal.deductionBp,
    };
  }

  /**
   * The plan can require a member to buy N BV this month before withdrawals
   * unlock. Reads the MonthlyVolume rollup rather than scanning orders.
   */
  async repurchaseStatus(memberId: string, plan: PlanConfig) {
    const target = plan.repurchase.monthlyBvCenti;
    if (!plan.repurchase.enabled || target <= 0) return { met: true, boughtCenti: 0, targetCenti: 0 };
    const row = await this.prisma.monthlyVolume.findUnique({
      where: { memberId_period: { memberId, period: isoPeriod(new Date()) } },
      select: { selfBvCenti: true },
    });
    const boughtCenti = row?.selfBvCenti ?? 0;
    return { met: boughtCenti >= target, boughtCenti, targetCenti: target };
  }

  async request(memberId: string, requestedPaise: Paise) {
    return this.prisma.$transaction(async (tx) => {
      const planRow = await tx.planVersion.findFirstOrThrow({ orderBy: { version: 'desc' } });
      const plan = parsePlan(planRow.config);
      const member = await tx.member.findUniqueOrThrow({ where: { id: memberId } });

      if (member.status !== 'ACTIVE') throw new BadRequestException('Your account is on hold. Contact support.');
      if (!member.payoutUpi && !member.payoutAccount) {
        throw new BadRequestException('Add a UPI ID or bank account under Account before withdrawing.');
      }

      const min = BigInt(plan.withdrawal.minPaise);
      if (requestedPaise < min) throw new BadRequestException(`Minimum withdrawal is ${formatInr(min)}.`);

      if (plan.repurchase.blocksWithdrawal) {
        const rp = await this.repurchaseStatus(memberId, plan);
        if (!rp.met) {
          const shortfall = centiToBvString(rp.targetCenti - rp.boughtCenti);
          throw new BadRequestException(
            `This month's purchase target isn't met yet. Buy ${shortfall} more BV to unlock withdrawals.`,
          );
        }
      }

      // Advisory lock: two concurrent requests from the same member could
      // both pass the "no open request" check below before either has
      // created one — there's no existing row to lock against on a member's
      // first withdrawal, so this serialises on the member id itself instead.
      // Transaction-scoped; releases itself on commit or rollback.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${memberId}))`;

      const open = await tx.withdrawal.findFirst({ where: { memberId, status: 'PENDING' } });
      if (open) throw new ConflictException('You already have a withdrawal in review.');

      const q = this.quote(plan, requestedPaise);
      const withdrawal = await tx.withdrawal.create({
        data: {
          memberId,
          requestedPaise: q.requestedPaise,
          deductionPaise: q.deductionPaise,
          netPaise: q.netPaise,
          deductionBp: q.deductionBp,
          // Decrypted into the snapshot because finance has to read it to make
          // the transfer. It also records what the payout was actually sent to,
          // which matters if a member later changes their account and disputes
          // where the money went.
          payoutSnapshot: {
            upi: decryptIfNeeded(member.payoutUpi, encCtx.payoutUpi(member.id)),
            holder: member.payoutHolder,
            bank: member.payoutBank,
            account: decryptIfNeeded(member.payoutAccount, encCtx.payoutAccount(member.id)),
            accountLastFour: member.payoutAccount
              ? lastFour(decryptIfNeeded(member.payoutAccount, encCtx.payoutAccount(member.id))!)
              : null,
            ifsc: decryptIfNeeded(member.payoutIfsc, encCtx.payoutIfsc(member.id)),
          },
        },
      });

      // Hold immediately. InsufficientFundsError surfaces here if the balance
      // moved between the UI reading it and this transaction running.
      await this.ledger.post(tx, {
        memberId,
        wallet: 'INCOME',
        direction: 'DEBIT',
        amountPaise: q.requestedPaise,
        category: 'WITHDRAWAL_HOLD',
        idempotencyKey: idempotencyKey('withdrawal-hold', withdrawal.id),
        refType: 'withdrawal',
        refId: withdrawal.id,
        note: 'Held until the payout is sent',
      });

      await tx.notification.create({
        data: {
          memberId,
          title: 'Withdrawal requested',
          body: `${formatInr(q.netPaise)} will be sent to your payout account after review.`,
          kind: 'WALLET',
        },
      });

      return withdrawal;
    });
  }

  /** Admin has transferred the money by hand and is recording the reference. */
  async markPaid(withdrawalId: string, args: { adminId: string; transferRef: string }) {
    const ref = args.transferRef?.trim();
    if (!ref || ref.length < 6) {
      throw new BadRequestException('Enter the bank or UPI transfer reference you paid with.');
    }
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string; status: string }[]>`
        SELECT id, status::text FROM "Withdrawal" WHERE id = ${withdrawalId} FOR UPDATE
      `;
      if (locked.length === 0) throw new BadRequestException('Request not found.');
      if (locked[0].status !== 'PENDING') throw new ConflictException('This request was already processed.');

      const w = await tx.withdrawal.update({
        where: { id: withdrawalId },
        data: { status: 'PAID', transferRef: ref, reviewedById: args.adminId, reviewedAt: new Date() },
      });
      // No ledger movement here: the money left the wallet at request time.
      await tx.notification.create({
        data: {
          memberId: w.memberId,
          title: 'Withdrawal paid',
          body: `${formatInr(w.netPaise)} was sent. Reference ${ref}.`,
          kind: 'WALLET',
        },
      });
      await tx.auditLog.create({
        data: {
          actorType: 'ADMIN',
          actorId: args.adminId,
          action: 'withdrawal.paid',
          detail: { withdrawalId, netPaise: w.netPaise.toString(), transferRef: ref },
        },
      });
      return w;
    });
  }

  /** Return the request and put the full requested amount back in the wallet. */
  async reject(withdrawalId: string, args: { adminId: string; note: string }) {
    const note = args.note?.trim();
    if (!note) throw new BadRequestException('Add a reason for returning this request.');

    return this.prisma.$transaction(async (tx) => {
      const w = await tx.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
      if (w.status !== 'PENDING') throw new ConflictException('This request was already processed.');

      await tx.withdrawal.update({
        where: { id: withdrawalId },
        data: { status: 'REJECTED', reviewNote: note, reviewedById: args.adminId, reviewedAt: new Date() },
      });
      // Reverse the full request, not the net: the deduction was never taken.
      await this.ledger.post(tx, {
        memberId: w.memberId,
        wallet: 'INCOME',
        direction: 'CREDIT',
        amountPaise: w.requestedPaise,
        category: 'WITHDRAWAL_REVERSAL',
        idempotencyKey: idempotencyKey('withdrawal-reverse', w.id),
        refType: 'withdrawal',
        refId: w.id,
        note,
      });
      await tx.notification.create({
        data: {
          memberId: w.memberId,
          title: 'Withdrawal returned',
          body: `${formatInr(w.requestedPaise)} is back in your income wallet. ${note}`,
          kind: 'WALLET',
        },
      });
      await tx.auditLog.create({
        data: { actorType: 'ADMIN', actorId: args.adminId, action: 'withdrawal.reject', detail: { withdrawalId, note } },
      });
      return { ok: true as const };
    });
  }
}
