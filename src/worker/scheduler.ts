import type { Proposal } from '../common/types.js';
import { t } from '../common/i18n.js';
import { workerConfig } from './config.js';
import { executeMoveItems } from './imap-move.js';
import { appendSentCopy } from './sent-copy.js';
import { DeliveryError, deliver } from './smtp.js';
import type { ProposalStore } from './store.js';

export type Scheduler = {
  runOnce: () => Promise<void>;
  stop: () => void;
};

export function startScheduler(store: ProposalStore): Scheduler {
  let stopped = false;
  let running = false;

  const processProposal = async (proposal: Proposal): Promise<void> => {
    if (proposal.kind === 'move') {
      try {
        const results = await executeMoveItems(proposal.moveItems);
        const outcome = await store.markMoveOutcome(proposal.id, results);
        console.error(
          `[mail-worker] proposal ${proposal.id} move finished: ${outcome.status}`
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        await store.markFailed(proposal.id, reason);
        console.error(
          `[mail-worker] proposal ${proposal.id} failed before the move`
        );
      }
      return;
    }

    try {
      const delivery = await deliver(proposal.message);
      let warning: string | null = null;
      try {
        await appendSentCopy(delivery.raw);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        warning = t.worker.sentCopyFailed(reason);
      }
      await store.markSent(proposal.id, warning);
      console.error(`[mail-worker] proposal ${proposal.id} sent`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (error instanceof DeliveryError && error.deliveryMayHaveOccurred) {
        await store.markUncertain(
          proposal.id,
          t.worker.uncertainDelivery(reason)
        );
        console.error(`[mail-worker] proposal ${proposal.id} outcome uncertain`);
      } else {
        await store.markFailed(proposal.id, reason);
        console.error(`[mail-worker] proposal ${proposal.id} failed before sending`);
      }
    }
  };

  const runOnce = async (): Promise<void> => {
    if (stopped || running) return;
    running = true;
    try {
      while (!stopped) {
        const proposal = await store.claimDue();
        if (!proposal) break;
        await processProposal(proposal);
      }
    } catch (error) {
      console.error(
        '[mail-worker] scheduler cycle failed:',
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void runOnce();
  }, workerConfig.SCHEDULER_INTERVAL_MS);
  timer.unref();
  void runOnce();

  return {
    runOnce,
    stop: () => {
      stopped = true;
      clearInterval(timer);
    }
  };
}
