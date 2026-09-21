import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { CommissionService } from './commission.service';

/**
 * Commission worker.
 *
 * Payouts run here rather than inline in the delivery request for three
 * reasons: a deep genealogy walk must not hold a database transaction open
 * while an admin waits on a button; a transient failure gets retried instead of
 * silently losing someone's income; and a failed run stays on the queue where
 * it is visible, rather than disappearing into a request that already returned
 * 200.
 *
 * Concurrency is 1 on purpose. Two orders delivering at the same moment share
 * most of their upline, so parallel workers would spend their time contending
 * for the same wallet locks. The engine is idempotent and lock-ordered anyway —
 * this is a throughput choice, not a correctness one, and it can be raised once
 * there are real numbers to tune against.
 */
@Processor('commission', { concurrency: 1 })
export class CommissionProcessor extends WorkerHost {
  private readonly log = new Logger(CommissionProcessor.name);

  constructor(private readonly commission: CommissionService) {
    super();
  }

  async process(job: Job<{ orderId: string }>): Promise<unknown> {
    const { orderId } = job.data;

    const result = await this.commission.runForOrder(orderId);

    if (result.skipped) {
      // Not an error. Either the job was replayed, or the order left DELIVERED
      // before the worker picked it up.
      this.log.log(`Order ${orderId} skipped: ${result.reason}`);
      return result;
    }

    this.log.log(
      `Order ${orderId}: ${result.payouts.length} payouts, ${result.totalPaise} paise, plan ${result.planVersionId}`,
    );
    return result;
  }

  /**
   * After the final attempt the payout is genuinely stuck and needs a human.
   * Wire this to whatever the ops channel is — the members involved are owed
   * money and will not know anything went wrong.
   */
  async onFailed(job: Job<{ orderId: string }>, err: Error): Promise<void> {
    const exhausted = job.attemptsMade >= (job.opts.attempts ?? 1);
    this.log.error(
      `Commission run failed for order ${job.data.orderId} (attempt ${job.attemptsMade}): ${err.message}`,
      err.stack,
    );
    if (exhausted) {
      this.log.error(`ALERT: order ${job.data.orderId} has exhausted its retries and owes unpaid commission.`);
    }
  }
}
