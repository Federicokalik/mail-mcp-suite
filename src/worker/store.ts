import { randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  type CreatePreparedMoveProposal,
  type CreateProposal,
  type MoveItem,
  type MoveProposal,
  type Proposal,
  ProposalSchema,
  type ProposalKind,
  type ProposalStatus,
  type SendProposal
} from '../common/types.js';
import { t } from '../common/i18n.js';

type StoreOptions = {
  path: string;
  approvalTtlMinutes: number;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class ProposalStore {
  readonly #path: string;
  readonly #approvalTtlMinutes: number;
  #entries: Proposal[] | null = null;
  #tail: Promise<void> = Promise.resolve();

  constructor(options: StoreOptions) {
    this.#path = options.path;
    this.#approvalTtlMinutes = options.approvalTtlMinutes;
  }

  async #exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#tail.then(fn, fn);
    this.#tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async #load(): Promise<Proposal[]> {
    if (this.#entries) return this.#entries;
    try {
      const raw = await readFile(this.#path, 'utf8');
      this.#entries = ProposalSchema.array().parse(JSON.parse(raw));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(t.worker.outboxUnreadable(reason));
      }
      this.#entries = [];
    }
    return this.#entries;
  }

  async #persist(entries: Proposal[]): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    const temporary = `${this.#path}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify(entries, null, 2), 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, this.#path);
    await chmod(this.#path, 0o600);
    this.#entries = entries;
  }

  async #expire(entries: Proposal[], now: Date): Promise<boolean> {
    let changed = false;
    for (const entry of entries) {
      if (
        entry.status === 'pending_approval' &&
        new Date(entry.approvalExpiresAt).getTime() <= now.getTime()
      ) {
        entry.status = 'expired';
        changed = true;
      }
    }
    return changed;
  }

  async initialize(): Promise<void> {
    await this.#exclusive(async () => {
      const entries = await this.#load();
      let changed = await this.#expire(entries, new Date());
      for (const entry of entries) {
        if (entry.status === 'sending') {
          entry.status = 'uncertain';
          entry.error =
            entry.kind === 'send'
              ? t.worker.restartedDuringSend
              : t.worker.restartedDuringMove;
          changed = true;
        }
      }
      if (changed) await this.#persist(entries);
    });
  }

  async create(input: CreateProposal): Promise<SendProposal> {
    return this.#exclusive(async () => {
      const entries = await this.#load();
      const now = new Date();
      await this.#expire(entries, now);
      const proposal: SendProposal = {
        id: randomUUID(),
        kind: 'send',
        status: 'pending_approval',
        createdAt: now.toISOString(),
        approvalExpiresAt: new Date(
          now.getTime() + this.#approvalTtlMinutes * 60_000
        ).toISOString(),
        scheduledFor: input.scheduledFor
          ? new Date(input.scheduledFor).toISOString()
          : null,
        approvedAt: null,
        sentAt: null,
        attempts: 0,
        error: null,
        note: input.note,
        message: input.message
      };
      entries.push(proposal);
      await this.#persist(entries);
      return clone(proposal);
    });
  }

  async createMove(input: CreatePreparedMoveProposal): Promise<MoveProposal> {
    return this.#exclusive(async () => {
      const entries = await this.#load();
      const now = new Date();
      await this.#expire(entries, now);

      const existing = entries.find(
        (entry): entry is MoveProposal =>
          entry.kind === 'move' && entry.idempotencyKey === input.idempotencyKey
      );
      if (existing) {
        const identity = (items: MoveItem[]) =>
          items.map((item) => ({
            sourceMailbox: item.sourceMailbox,
            uid: item.uid,
            destinationMailbox: item.destinationMailbox
          }));
        if (
          JSON.stringify(identity(existing.moveItems)) !==
          JSON.stringify(identity(input.moveItems))
        ) {
          throw new Error(t.worker.idempotencyKeyReused);
        }
        return clone(existing);
      }

      const proposal: MoveProposal = {
        id: randomUUID(),
        kind: 'move',
        status: 'pending_approval',
        createdAt: now.toISOString(),
        approvalExpiresAt: new Date(
          now.getTime() + this.#approvalTtlMinutes * 60_000
        ).toISOString(),
        scheduledFor: null,
        approvedAt: null,
        sentAt: null,
        attempts: 0,
        error: null,
        note: input.note,
        idempotencyKey: input.idempotencyKey,
        moveItems: input.moveItems
      };
      entries.push(proposal);
      await this.#persist(entries);
      return clone(proposal);
    });
  }

  async get(id: string): Promise<Proposal | undefined> {
    return this.#exclusive(async () => {
      const entries = await this.#load();
      if (await this.#expire(entries, new Date())) await this.#persist(entries);
      const proposal = entries.find((entry) => entry.id === id);
      return proposal ? clone(proposal) : undefined;
    });
  }

  async list(
    status?: ProposalStatus,
    limit = 20,
    kind?: ProposalKind
  ): Promise<Proposal[]> {
    return this.#exclusive(async () => {
      const entries = await this.#load();
      if (await this.#expire(entries, new Date())) await this.#persist(entries);
      return entries
        .filter(
          (entry) =>
            (!status || entry.status === status) && (!kind || entry.kind === kind)
        )
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, limit)
        .map(clone);
    });
  }

  async approve(id: string, now = new Date()): Promise<Proposal> {
    return this.#exclusive(async () => {
      const entries = await this.#load();
      if (await this.#expire(entries, now)) await this.#persist(entries);
      const proposal = entries.find((entry) => entry.id === id);
      if (!proposal) throw new Error(t.worker.proposalNotFound);
      if (proposal.status !== 'pending_approval') {
        throw new Error(t.worker.notApprovable(proposal.status));
      }

      proposal.approvedAt = now.toISOString();
      proposal.status = proposal.scheduledFor ? 'scheduled' : 'approved';
      await this.#persist(entries);
      return clone(proposal);
    });
  }

  async cancel(id: string): Promise<Proposal> {
    return this.#exclusive(async () => {
      const entries = await this.#load();
      if (await this.#expire(entries, new Date())) await this.#persist(entries);
      const proposal = entries.find((entry) => entry.id === id);
      if (!proposal) throw new Error(t.worker.proposalNotFound);
      if (proposal.status === 'cancelled') return clone(proposal);
      if (!['pending_approval', 'approved', 'scheduled'].includes(proposal.status)) {
        throw new Error(t.worker.notCancellable(proposal.status));
      }
      proposal.status = 'cancelled';
      await this.#persist(entries);
      return clone(proposal);
    });
  }

  async claimDue(now = new Date()): Promise<Proposal | undefined> {
    return this.#exclusive(async () => {
      const entries = await this.#load();
      const changed = await this.#expire(entries, now);
      const due = entries
        .filter(
          (entry) =>
            entry.status === 'approved' ||
            (entry.status === 'scheduled' &&
              entry.scheduledFor !== null &&
              new Date(entry.scheduledFor).getTime() <= now.getTime())
        )
        .sort((left, right) =>
          (left.scheduledFor ?? left.approvedAt ?? left.createdAt).localeCompare(
            right.scheduledFor ?? right.approvedAt ?? right.createdAt
          )
        )[0];

      if (!due) {
        if (changed) await this.#persist(entries);
        return undefined;
      }

      due.status = 'sending';
      due.attempts += 1;
      due.error = null;
      await this.#persist(entries);
      return clone(due);
    });
  }

  async markSent(id: string, warning: string | null, now = new Date()): Promise<Proposal> {
    return this.#exclusive(async () => {
      const entries = await this.#load();
      const proposal = entries.find((entry) => entry.id === id);
      if (!proposal) throw new Error(t.worker.proposalNotFound);
      if (proposal.status !== 'sending') {
        throw new Error(t.worker.invalidTransitionToSent(proposal.status));
      }
      if (proposal.kind !== 'send') {
        throw new Error(t.worker.markSentOnlySend);
      }
      proposal.status = 'sent';
      proposal.sentAt = now.toISOString();
      proposal.error = warning;
      await this.#persist(entries);
      return clone(proposal);
    });
  }

  async markMoveOutcome(
    id: string,
    moveItems: MoveItem[],
    now = new Date()
  ): Promise<MoveProposal> {
    return this.#exclusive(async () => {
      const entries = await this.#load();
      const proposal = entries.find((entry) => entry.id === id);
      if (!proposal) throw new Error(t.worker.proposalNotFound);
      if (proposal.status !== 'sending') {
        throw new Error(t.worker.invalidMoveTransition(proposal.status));
      }
      if (proposal.kind !== 'move') {
        throw new Error(t.worker.markMoveOutcomeOnlyMove);
      }

      proposal.moveItems = moveItems;
      proposal.sentAt = now.toISOString();
      const moved = moveItems.filter((item) => item.result.status === 'moved').length;
      const failed = moveItems.filter((item) => item.result.status === 'failed').length;
      const uncertain = moveItems.filter(
        (item) => item.result.status === 'uncertain'
      ).length;

      if (uncertain > 0) {
        proposal.status = 'uncertain';
        proposal.error = t.worker.moveUncertainSummary(uncertain, moved, failed);
      } else if (failed > 0) {
        proposal.status = 'failed';
        proposal.error = t.worker.moveFailedSummary(moved, failed);
      } else {
        proposal.status = 'sent';
        proposal.error = null;
      }
      await this.#persist(entries);
      return clone(proposal);
    });
  }

  async markFailed(id: string, error: string): Promise<Proposal> {
    return this.#exclusive(async () => {
      const entries = await this.#load();
      const proposal = entries.find((entry) => entry.id === id);
      if (!proposal) throw new Error(t.worker.proposalNotFound);
      if (proposal.status !== 'sending') {
        throw new Error(t.worker.invalidTransitionToFailed(proposal.status));
      }
      proposal.status = 'failed';
      proposal.error = error.slice(0, 2_000);
      await this.#persist(entries);
      return clone(proposal);
    });
  }

  async markUncertain(id: string, error: string): Promise<Proposal> {
    return this.#exclusive(async () => {
      const entries = await this.#load();
      const proposal = entries.find((entry) => entry.id === id);
      if (!proposal) throw new Error(t.worker.proposalNotFound);
      if (proposal.status !== 'sending') {
        throw new Error(t.worker.invalidTransitionToUncertain(proposal.status));
      }
      proposal.status = 'uncertain';
      proposal.error = error.slice(0, 2_000);
      await this.#persist(entries);
      return clone(proposal);
    });
  }
}
