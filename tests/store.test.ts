import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import type {
  CreatePreparedMoveProposal,
  CreateProposal
} from '../src/common/types.js';
import { ProposalStore } from '../src/worker/store.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

async function store(): Promise<{ path: string; store: ProposalStore }> {
  const directory = await mkdtemp(join(tmpdir(), 'mail-mcp-store-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'outbox.json');
  const proposalStore = new ProposalStore({ path, approvalTtlMinutes: 60 });
  await proposalStore.initialize();
  return { path, store: proposalStore };
}

function proposalInput(scheduledFor: string | null = null): CreateProposal {
  return {
    message: {
      to: ['recipient@example.com'],
      subject: 'Test',
      text: 'Test body'
    },
    scheduledFor,
    note: null
  };
}

function moveProposalInput(
  idempotencyKey = 'move-test-0001'
): CreatePreparedMoveProposal {
  return {
    idempotencyKey,
    note: null,
    moveItems: [
      {
        sourceMailbox: 'INBOX',
        destinationMailbox: 'INBOX.Newsletter',
        uid: 42,
        messageId: '<message@example.com>',
        subject: 'Newsletter',
        from: 'sender@example.com',
        date: '2026-07-25T12:00:00.000Z',
        flags: [],
        result: {
          status: 'pending',
          destinationUid: null,
          error: null
        }
      }
    ]
  };
}

test('immediate send follows atomic transitions through to sent', async () => {
  const context = await store();
  const created = await context.store.create(proposalInput());
  assert.equal(created.status, 'pending_approval');

  const approved = await context.store.approve(created.id);
  assert.equal(approved.status, 'approved');

  const claimed = await context.store.claimDue();
  assert.equal(claimed?.id, created.id);
  assert.equal(claimed?.status, 'sending');
  assert.equal(claimed?.attempts, 1);

  const sent = await context.store.markSent(created.id, null);
  assert.equal(sent.status, 'sent');
  assert.ok(sent.sentAt);
  assert.equal(await context.store.claimDue(), undefined);

  const persisted = JSON.parse(await readFile(context.path, 'utf8')) as unknown[];
  assert.equal(persisted.length, 1);
});

test('scheduled job is not claimed before its time', async () => {
  const context = await store();
  const scheduledFor = new Date(Date.now() + 3_600_000).toISOString();
  const created = await context.store.create(proposalInput(scheduledFor));
  const approved = await context.store.approve(created.id);
  assert.equal(approved.status, 'scheduled');

  assert.equal(await context.store.claimDue(new Date()), undefined);
  const claimed = await context.store.claimDue(new Date(Date.now() + 3_700_000));
  assert.equal(claimed?.status, 'sending');
});

test('restart during sending yields uncertain and does not retry', async () => {
  const context = await store();
  const created = await context.store.create(proposalInput());
  await context.store.approve(created.id);
  await context.store.claimDue();

  const restarted = new ProposalStore({
    path: context.path,
    approvalTtlMinutes: 60
  });
  await restarted.initialize();
  const recovered = await restarted.get(created.id);
  assert.equal(recovered?.status, 'uncertain');
  assert.match(recovered?.error ?? '', /no automatic retry/i);
  assert.equal(await restarted.claimDue(), undefined);
});

test('corrupted outbox fails closed without overwriting', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mail-mcp-corrupt-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'outbox.json');
  await writeFile(path, '{non-json', 'utf8');

  const proposalStore = new ProposalStore({ path, approvalTtlMinutes: 60 });
  await assert.rejects(proposalStore.initialize(), /corrupted/i);
  assert.equal(await readFile(path, 'utf8'), '{non-json');
});

test('move is idempotent and records the new UID', async () => {
  const context = await store();
  const created = await context.store.createMove(moveProposalInput());
  const duplicate = await context.store.createMove(moveProposalInput());
  assert.equal(duplicate.id, created.id);

  await context.store.approve(created.id);
  const claimed = await context.store.claimDue();
  assert.equal(claimed?.kind, 'move');
  if (!claimed || claimed.kind !== 'move') {
    assert.fail('Move proposal was not claimed.');
  }
  const result = structuredClone(claimed.moveItems);
  const firstResult = result[0];
  assert.ok(firstResult);
  firstResult.result = {
    status: 'moved',
    destinationUid: 99,
    error: null
  };
  const completed = await context.store.markMoveOutcome(created.id, result);
  assert.equal(completed.status, 'sent');
  assert.equal(completed.moveItems[0]?.result.destinationUid, 99);
});

test('idempotency key cannot be reused with different content', async () => {
  const context = await store();
  await context.store.createMove(moveProposalInput());
  const different = moveProposalInput();
  const firstItem = different.moveItems[0];
  assert.ok(firstItem);
  firstItem.uid = 43;
  await assert.rejects(
    context.store.createMove(different),
    /idempotency key.*different/i
  );
});
