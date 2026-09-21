import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { LedgerService, idempotencyKey } from '../ledger/ledger.service';
import { formatInr, Paise } from '../common/money';

/**
 * Mobile/DTH recharge, paid from the shopping wallet.
 *
 * For a member who topped up their shopping wallet and then decided not to
 * buy anything: this spends that balance on a top-up instead, without ever
 * turning the wallet into a cash-out channel. It works exactly like buying a
 * product — the balance leaves the wallet the moment the request is made, and
 * Majestic Cart is the one fulfilling it — because there is no payment
 * gateway or telecom-operator API wired up yet, fulfilment is a person on the
 * admin side using their own recharge account, the same manual step the UPI
 * side of this business already runs on (see recharge/recharge.service.ts).
 *
 * If that manual step fails, the hold is reversed, same as a rejected
 * withdrawal — see withdrawal.service.ts, which this deliberately mirrors.
 */

const MOBILE_REGEX = /^[6-9]\d{9}$/;
const MIN_PAISE = 1000n; // ₹10 — below most operators' smallest top-up
const MAX_PAISE = 500000n; // ₹5,000 — a sanity ceiling, not a plan-configured limit

export interface MobileRechargeRequestInput {
  mobileNumber: string;
  operator: 'JIO' | 'AIRTEL' | 'VI' | 'BSNL' | 'OTHER';
  amountPaise: Paise;
}

@Injectable()
export class MobileRechargeService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly ledger: LedgerService,
  ) {}

  async request(memberId: string, input: MobileRechargeRequestInput) {
    const mobileNumber = input.mobileNumber.trim();
    if (!MOBILE_REGEX.test(mobileNumber)) {
      throw new BadRequestException('Enter a valid 10-digit Indian mobile number.');
    }
    if (input.amountPaise < MIN_PAISE) throw new BadRequestException(`Minimum recharge is ${formatInr(MIN_PAISE)}.`);
    if (input.amountPaise > MAX_PAISE) throw new BadRequestException(`Maximum recharge is ${formatInr(MAX_PAISE)}.`);

    return this.prisma.$transaction(async (tx) => {
      const member = await tx.member.findUniqueOrThrow({ where: { id: memberId } });
      if (member.status !== 'ACTIVE') throw new BadRequestException('Your account is on hold. Contact support.');

      // Advisory lock, not a row lock: there is no existing row to lock
      // against when this is the member's first request, but two concurrent
      // requests still need to serialise on *something* or both can pass the
      // "no open request" check below before either has created one.
      // Transaction-scoped, so it releases itself on commit or rollback —
      // nothing to remember to unlock.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${memberId}))`;

      // One in flight at a time, same reasoning as withdrawal: without this,
      // the same balance could be quoted against two simultaneous requests
      // before either resolves.
      const open = await tx.mobileRechargeRequest.findFirst({ where: { memberId, status: 'PENDING' } });
      if (open) throw new ConflictException('You already have a recharge in progress.');

      const reqRow = await tx.mobileRechargeRequest.create({
        data: { memberId, mobileNumber, operator: input.operator, amountPaise: input.amountPaise },
      });

      // Held immediately, from SHOPPING — same wallet a product purchase
      // spends from, and InsufficientFundsError surfaces here exactly as it
      // would at checkout.
      await this.ledger.post(tx, {
        memberId,
        wallet: 'SHOPPING',
        direction: 'DEBIT',
        amountPaise: input.amountPaise,
        category: 'MOBILE_RECHARGE_HOLD',
        idempotencyKey: idempotencyKey('mobile-recharge-hold', reqRow.id),
        refType: 'mobile_recharge',
        refId: reqRow.id,
        note: `Recharge for ${mobileNumber} — held until completed`,
      });

      await tx.notification.create({
        data: {
          memberId,
          title: 'Recharge requested',
          body: `${formatInr(input.amountPaise)} will recharge ${mobileNumber} shortly.`,
          kind: 'WALLET',
        },
      });

      return reqRow;
    });
  }

  async listForMember(memberId: string) {
    return this.prisma.mobileRechargeRequest.findMany({
      where: { memberId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async listPendingForAdmin() {
    return this.prisma.mobileRechargeRequest.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      include: { member: { select: { memberCode: true, name: true, phone: true } } },
    });
  }

  /** Admin has actually topped up the number with the operator. No ledger movement: the money left at request time. */
  async complete(id: string, args: { adminId: string; operatorRef: string }) {
    const ref = args.operatorRef?.trim();
    if (!ref) throw new BadRequestException('Enter the operator/recharge-dashboard reference.');

    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string; status: string }[]>`
        SELECT id, status::text FROM "MobileRechargeRequest" WHERE id = ${id} FOR UPDATE
      `;
      if (locked.length === 0) throw new BadRequestException('Request not found.');
      if (locked[0].status !== 'PENDING') throw new ConflictException('This request was already processed.');

      const r = await tx.mobileRechargeRequest.update({
        where: { id },
        data: { status: 'COMPLETED', operatorRef: ref, reviewedById: args.adminId, reviewedAt: new Date() },
      });
      await tx.notification.create({
        data: {
          memberId: r.memberId,
          title: 'Recharge completed',
          body: `${r.mobileNumber} was recharged with ${formatInr(r.amountPaise)}.`,
          kind: 'WALLET',
        },
      });
      await tx.auditLog.create({
        data: { actorType: 'ADMIN', actorId: args.adminId, action: 'mobileRecharge.complete', detail: { id, operatorRef: ref } },
      });
      return r;
    });
  }

  /** Couldn't complete it — return the hold to the shopping wallet. */
  async fail(id: string, args: { adminId: string; reason: string }) {
    const reason = args.reason?.trim();
    if (!reason) throw new BadRequestException('Add a reason for returning this request.');

    return this.prisma.$transaction(async (tx) => {
      const r = await tx.mobileRechargeRequest.findUniqueOrThrow({ where: { id } });
      if (r.status !== 'PENDING') throw new ConflictException('This request was already processed.');

      await tx.mobileRechargeRequest.update({
        where: { id },
        data: { status: 'FAILED', failureReason: reason, reviewedById: args.adminId, reviewedAt: new Date() },
      });
      await this.ledger.post(tx, {
        memberId: r.memberId,
        wallet: 'SHOPPING',
        direction: 'CREDIT',
        amountPaise: r.amountPaise,
        category: 'MOBILE_RECHARGE_REVERSAL',
        idempotencyKey: idempotencyKey('mobile-recharge-reverse', r.id),
        refType: 'mobile_recharge',
        refId: r.id,
        note: reason,
      });
      await tx.notification.create({
        data: {
          memberId: r.memberId,
          title: 'Recharge could not be completed',
          body: `${formatInr(r.amountPaise)} is back in your shopping wallet. ${reason}`,
          kind: 'WALLET',
        },
      });
      await tx.auditLog.create({
        data: { actorType: 'ADMIN', actorId: args.adminId, action: 'mobileRecharge.fail', detail: { id, reason } },
      });
      return { ok: true as const };
    });
  }
}
