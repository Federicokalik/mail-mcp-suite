import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MoveRequestItemSchema,
  OutgoingMessageSchema,
  ProposalSchema,
  publicProposal,
  validateMoveRequest,
  validateRecipients,
  type Proposal
} from '../src/common/types.js';

test('schema rejects header injection', () => {
  const result = OutgoingMessageSchema.safeParse({
    to: ['recipient@example.com'],
    subject: 'Subject\r\nBcc: attacker@example.com',
    text: 'Body'
  });
  assert.equal(result.success, false);
});

test('recipient policy enforces limit, allowlist and denylist', () => {
  const message = OutgoingMessageSchema.parse({
    to: ['one@example.com'],
    cc: ['two@blocked.example'],
    subject: 'Subject',
    text: 'Body'
  });
  assert.match(
    validateRecipients(message, {
      maximum: 10,
      allowlist: [],
      denylist: ['blocked.example']
    }) ?? '',
    /denylist/
  );
  assert.match(
    validateRecipients(message, {
      maximum: 1,
      allowlist: [],
      denylist: []
    }) ?? '',
    /Too many recipients/
  );
});

test('public view contains neither body nor Bcc', () => {
  const proposal: Proposal = {
    id: '2478a6a1-23ca-4f97-bfa7-74e9d50efca0',
    kind: 'send',
    status: 'pending_approval',
    createdAt: '2026-07-25T12:00:00.000Z',
    approvalExpiresAt: '2026-07-25T13:00:00.000Z',
    scheduledFor: null,
    approvedAt: null,
    sentAt: null,
    attempts: 0,
    error: null,
    note: null,
    message: {
      to: ['recipient@example.com'],
      bcc: ['hidden@example.com'],
      subject: 'Subject',
      text: 'Secret in the body'
    }
  };
  const visible = publicProposal(proposal) as Record<string, unknown>;
  assert.equal('message' in visible, false);
  assert.equal('bcc' in visible, false);
  assert.equal(JSON.stringify(visible).includes('Secret in the body'), false);
  assert.equal(JSON.stringify(visible).includes('hidden@example.com'), false);
});

test('schema migrates legacy send proposals without kind', () => {
  const legacy = {
    id: '2478a6a1-23ca-4f97-bfa7-74e9d50efca0',
    status: 'pending_approval',
    createdAt: '2026-07-25T12:00:00.000Z',
    approvalExpiresAt: '2026-07-25T13:00:00.000Z',
    scheduledFor: null,
    approvedAt: null,
    sentAt: null,
    attempts: 0,
    error: null,
    note: null,
    message: {
      to: ['recipient@example.com'],
      subject: 'Legacy',
      text: 'Body'
    }
  };
  const migrated = ProposalSchema.parse(legacy);
  assert.equal(migrated.kind, 'send');
});

test('move policy blocks disallowed folders and duplicates', () => {
  const policy = {
    maximum: 25,
    sourceAllowlist: ['INBOX', 'INBOX.Social'],
    destinationAllowlist: ['INBOX', 'INBOX.Social']
  };
  const item = MoveRequestItemSchema.parse({
    sourceMailbox: 'INBOX',
    uid: 42,
    destinationMailbox: 'INBOX.Social'
  });
  assert.equal(validateMoveRequest([item], policy), null);
  assert.match(
    validateMoveRequest(
      [{ ...item, destinationMailbox: 'INBOX.spam' }],
      policy
    ) ?? '',
    /destination mailbox not allowed/i
  );
  assert.match(validateMoveRequest([item, item], policy) ?? '', /duplicate/i);
});
