import { Injectable, Logger, ConflictException, BadRequestException } from '@nestjs/common';
import { Prisma, PrismaClient, WalletKind, EntryDirection, LedgerCategory } from '@prisma/client';
import { Paise, formatInr, sumPaise } from '../common/money';

/**
 * The only way money moves.
 *
 * Nothing else in the codebase may write to Wallet.balancePaise or insert a
 * LedgerEntry. Every other service calls post() or transfer() inside a
 * transaction it owns.
 *
 * Three rules keep the books straight:
 *
 *  1. Locking. Wallet rows are taken with SELECT ... FOR UPDATE, always in
 *     ascending wallet-id order. Two concurrent commission runs touching the
 *     same uplines therefore queue instead of deadlocking.
 *
 *  2. Idempotency. Every posting carries a caller-supplied key that is UNIQUE on
 *     the table. A retried BullMQ job or a double-tapped button collides on the
 *     index and is swallowed, so nobody is ever paid twice for one event.
 *
 *  3. Append only. A mistake is fixed by posting its reverse, never by UPDATE or
 *     DELETE, so balanceAfter on every row stays a true running total.
 */

export type Tx = Prisma.TransactionClient;

export interface PostingRequest {
  memberId: string;
  wallet: WalletKind;
  direction: EntryDirection;
  amountPaise: Paise;
  category: LedgerCategory;
  /** Must be globally unique and deterministic. See idempotencyKey() below. */
  idempotencyKey: string;
  journalId?: string;
  refType?: string;
  refId?: string;
  note?: string;
  planVersionId?: string;
  /** Set true only for admin corrections that are meant to overdraw. */
  allowNegative?: boolean;
}

export interface PostingResult {
  entryId: string;
  balanceAfter: Paise;
  /** True when the key had already been used and nothing new was written. */
  deduplicated: boolean;
}

export class InsufficientFundsError extends BadRequestException {
  constructor(wallet: WalletKind, available: Paise, needed: Paise) {
    super(
      `The ${wallet === 'SHOPPING' ? 'shopping' : 'income'} wallet has ${formatInr(available)}, ` +
        `which is short of ${formatInr(needed)}.`,
    );
  }
}

/**
 * Deterministic key builder. The same business event must always produce the
 * same string, which is what makes a replay a no-op.
 *
 *   idempotencyKey('commission', orderId, memberId, 'TEAM', '2')
 *   -> "commission:ckx1:ckx9:TEAM:2"
 */
export function idempotencyKey(...parts: (string | number | null | undefined)[]): string {
  return parts.map((p) => (p === null || p === undefined ? '_' : String(p))).join(':');
}

@Injectable()
export class LedgerService {
  private readonly log = new Logger(LedgerService.name);

  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Lock a member's wallet for the rest of the transaction.
   *
   * Callers that touch several members in one transaction must go through
   * lockWallets() instead, so the ordering rule is not left to chance.
   */
  private async lockWallet(tx: Tx, memberId: string, kind: WalletKind) {
    const rows = await tx.$queryRaw<{ id: string; balancePaise: bigint }[]>`
      SELECT id, "balancePaise"
      FROM "Wallet"
      WHERE "memberId" = ${memberId} AND kind = ${kind}::"WalletKind"
      FOR UPDATE
    `;
    if (rows.length === 0) {
      throw new BadRequestException(`No ${kind} wallet exists for member ${memberId}`);
    }
    return rows[0];
  }

  /**
   * Take every lock this transaction will need, up front and in a fixed order.
   *
   * Deadlocks in a genealogy payout are not hypothetical: two orders delivering
   * at once share most of their upline. Sorting the ids means both transactions
   * grab the same rows in the same sequence, so one simply waits.
   */
  async lockWallets(tx: Tx, targets: { memberId: string; wallet: WalletKind }[]): Promise<void> {
    const unique = [...new Map(targets.map((t) => [`${t.memberId}:${t.wallet}`, t])).values()];
    if (unique.length === 0) return;
    const ids = await tx.wallet.findMany({
      where: { OR: unique.map((t) => ({ memberId: t.memberId, kind: t.wallet })) },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    if (ids.length === 0) return;
    await tx.$queryRaw`
      SELECT id FROM "Wallet"
      WHERE id IN (${Prisma.join(ids.map((r) => r.id))})
      ORDER BY id ASC
      FOR UPDATE
    `;
  }

  /** Post one leg. Must run inside a transaction the caller owns. */
  async post(tx: Tx, req: PostingRequest): Promise<PostingResult> {
    if (req.amountPaise <= 0n) {
      throw new BadRequestException(`A posting must be positive, got ${req.amountPaise}`);
    }

    const wallet = await this.lockWallet(tx, req.memberId, req.wallet);
    const delta = req.direction === 'CREDIT' ? req.amountPaise : -req.amountPaise;
    const balanceAfter = wallet.balancePaise + delta;

    if (balanceAfter < 0n && !req.allowNegative) {
      throw new InsufficientFundsError(req.wallet, wallet.balancePaise, req.amountPaise);
    }

    try {
      const entry = await tx.ledgerEntry.create({
        data: {
          journalId: req.journalId ?? req.idempotencyKey,
          memberId: req.memberId,
          walletId: wallet.id,
          direction: req.direction,
          amountPaise: req.amountPaise,
          category: req.category,
          balanceAfter,
          refType: req.refType,
          refId: req.refId,
          note: req.note,
          idempotencyKey: req.idempotencyKey,
          planVersionId: req.planVersionId,
        },
        select: { id: true },
      });

      await tx.wallet.update({
        where: { id: wallet.id },
        data: { balancePaise: balanceAfter, version: { increment: 1 } },
      });

      return { entryId: entry.id, balanceAfter, deduplicated: false };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        // Someone already posted this exact event. Return what is on record.
        const existing = await tx.ledgerEntry.findUnique({
          where: { idempotencyKey: req.idempotencyKey },
          select: { id: true, balanceAfter: true },
        });
        this.log.warn(`Duplicate posting suppressed: ${req.idempotencyKey}`);
        if (existing) {
          return { entryId: existing.id, balanceAfter: existing.balanceAfter, deduplicated: true };
        }
      }
      throw e;
    }
  }

  /**
   * Move money between two wallets as one journal. Either both legs land or
   * neither does, because they share the caller's transaction.
   */
  async transfer(
    tx: Tx,
    args: {
      memberId: string;
      from: WalletKind;
      to: WalletKind;
      amountPaise: Paise;
      category: LedgerCategory;
      idempotencyKey: string;
      note?: string;
    },
  ): Promise<{ debit: PostingResult; credit: PostingResult }> {
    const journalId = args.idempotencyKey;
    await this.lockWallets(tx, [
      { memberId: args.memberId, wallet: args.from },
      { memberId: args.memberId, wallet: args.to },
    ]);

    const debit = await this.post(tx, {
      memberId: args.memberId,
      wallet: args.from,
      direction: 'DEBIT',
      amountPaise: args.amountPaise,
      category: args.category,
      idempotencyKey: `${args.idempotencyKey}:debit`,
      journalId,
      note: args.note,
    });
    const credit = await this.post(tx, {
      memberId: args.memberId,
      wallet: args.to,
      direction: 'CREDIT',
      amountPaise: args.amountPaise,
      category: args.category,
      idempotencyKey: `${args.idempotencyKey}:credit`,
      journalId,
      note: args.note,
    });
    return { debit, credit };
  }

  /**
   * Post many credits in one shot — the shape a commission run needs.
   * Locks everything first, then writes, so the run cannot deadlock midway.
   */
  async postMany(tx: Tx, requests: PostingRequest[]): Promise<PostingResult[]> {
    await this.lockWallets(tx, requests.map((r) => ({ memberId: r.memberId, wallet: r.wallet })));
    const out: PostingResult[] = [];
    for (const req of requests) out.push(await this.post(tx, req));
    return out;
  }

  async balance(memberId: string, kind: WalletKind): Promise<Paise> {
    const w = await this.prisma.wallet.findUnique({
      where: { memberId_kind: { memberId, kind } },
      select: { balancePaise: true },
    });
    return w?.balancePaise ?? 0n;
  }

  /**
   * Reconciliation: recompute a wallet from its entries and compare with the
   * stored balance. Run nightly. A non-zero drift means something wrote to
   * Wallet outside this service, and that is a production incident.
   */
  async audit(memberId: string, kind: WalletKind): Promise<{ stored: Paise; derived: Paise; drift: Paise }> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { memberId_kind: { memberId, kind } },
      select: { id: true, balancePaise: true },
    });
    if (!wallet) throw new BadRequestException(`No ${kind} wallet for ${memberId}`);

    const entries = await this.prisma.ledgerEntry.findMany({
      where: { walletId: wallet.id },
      select: { direction: true, amountPaise: true },
    });
    const derived = sumPaise(
      entries.map((e) => (e.direction === 'CREDIT' ? e.amountPaise : -e.amountPaise)),
    );
    return { stored: wallet.balancePaise, derived, drift: wallet.balancePaise - derived };
  }

  /**
   * Undo a posting by writing its mirror image. Used for order cancellation and
   * for clawing back a commission run that should not have happened.
   */
  async reverse(
    tx: Tx,
    entryId: string,
    reason: string,
    actorId?: string,
  ): Promise<PostingResult> {
    const original = await tx.ledgerEntry.findUnique({ where: { id: entryId } });
    if (!original) throw new BadRequestException(`Ledger entry ${entryId} not found`);

    const wallet = await tx.wallet.findUnique({ where: { id: original.walletId }, select: { kind: true } });
    if (!wallet) throw new ConflictException(`Wallet for entry ${entryId} is missing`);

    return this.post(tx, {
      memberId: original.memberId,
      wallet: wallet.kind,
      direction: original.direction === 'CREDIT' ? 'DEBIT' : 'CREDIT',
      amountPaise: original.amountPaise,
      category: original.category,
      idempotencyKey: `reverse:${entryId}`,
      journalId: original.journalId,
      refType: original.refType ?? undefined,
      refId: original.refId ?? undefined,
      note: `Reversal: ${reason}${actorId ? ` (by ${actorId})` : ''}`,
      allowNegative: true, // a clawback may legitimately overdraw a spent wallet
    });
  }
}
