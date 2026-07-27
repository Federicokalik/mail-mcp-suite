import { z } from 'zod';
import { t } from './i18n.js';

const emailList = z.array(z.string().email()).max(50);
const safeHeader = z
  .string()
  .min(1)
  .max(1_000)
  .refine((value) => !/[\r\n]/.test(value), t.validation.headerNoCrLf);
const safeMailbox = z
  .string()
  .min(1)
  .max(500)
  .refine((value) => !/[\r\n]/.test(value), t.validation.mailboxNoCrLf);
const idempotencyKey = z
  .string()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/, t.validation.invalidIdempotencyKey);

export const OutgoingMessageSchema = z.object({
  to: emailList.min(1),
  cc: emailList.optional(),
  bcc: emailList.optional(),
  subject: safeHeader,
  // text stays mandatory even when html is present: it is the representation a human can
  // review without a renderer, and it makes the delivered message a proper
  // multipart/alternative rather than an HTML-only one.
  text: z.string().min(1).max(200_000),
  html: z.string().min(1).max(200_000).optional(),
  inReplyTo: safeHeader.optional(),
  references: z.array(safeHeader).max(100).optional()
});

export type OutgoingMessage = z.infer<typeof OutgoingMessageSchema>;

export const ProposalStatusSchema = z.enum([
  'pending_approval',
  'approved',
  'scheduled',
  'sending',
  'sent',
  'cancelled',
  'expired',
  'failed',
  'uncertain'
]);

export type ProposalStatus = z.infer<typeof ProposalStatusSchema>;

export const ProposalKindSchema = z.enum(['send', 'move']);
export type ProposalKind = z.infer<typeof ProposalKindSchema>;

export const MoveRequestItemSchema = z.object({
  sourceMailbox: safeMailbox,
  uid: z.number().int().positive(),
  destinationMailbox: safeMailbox
});

export type MoveRequestItem = z.infer<typeof MoveRequestItemSchema>;

export const MoveResultSchema = z.object({
  status: z.enum(['pending', 'moved', 'failed', 'uncertain']),
  destinationUid: z.number().int().positive().nullable(),
  error: z.string().max(2_000).nullable()
});

export type MoveResult = z.infer<typeof MoveResultSchema>;

export const MoveItemSchema = MoveRequestItemSchema.extend({
  messageId: safeHeader.nullable(),
  subject: safeHeader,
  from: safeHeader,
  date: z.string().datetime().nullable(),
  flags: z.array(z.string().max(200)).max(100),
  result: MoveResultSchema
});

export type MoveItem = z.infer<typeof MoveItemSchema>;

const proposalBase = {
  id: z.string().uuid(),
  status: ProposalStatusSchema,
  createdAt: z.string().datetime(),
  approvalExpiresAt: z.string().datetime(),
  scheduledFor: z.string().datetime().nullable(),
  approvedAt: z.string().datetime().nullable(),
  sentAt: z.string().datetime().nullable(),
  attempts: z.number().int().nonnegative(),
  error: z.string().nullable(),
  note: z.string().max(500).nullable()
};

export const SendProposalSchema = z.object({
  ...proposalBase,
  kind: z.literal('send'),
  message: OutgoingMessageSchema
});

export type SendProposal = z.infer<typeof SendProposalSchema>;

export const MoveProposalSchema = z.object({
  ...proposalBase,
  kind: z.literal('move'),
  scheduledFor: z.null(),
  idempotencyKey,
  moveItems: z.array(MoveItemSchema).min(1).max(25)
});

export type MoveProposal = z.infer<typeof MoveProposalSchema>;

const proposalUnionSchema = z.discriminatedUnion('kind', [
  SendProposalSchema,
  MoveProposalSchema
]);

// Earlier versions did not persist "kind". The presence of "message" identifies
// a send proposal unambiguously and allows a read-time migration.
export const ProposalSchema = z.preprocess((value) => {
  if (
    typeof value === 'object' &&
    value !== null &&
    !('kind' in value) &&
    'message' in value
  ) {
    return { ...(value as Record<string, unknown>), kind: 'send' };
  }
  return value;
}, proposalUnionSchema);

export type Proposal = SendProposal | MoveProposal;

const publicProposalBase = {
  id: z.string().uuid(),
  status: ProposalStatusSchema,
  createdAt: z.string().datetime(),
  approvalExpiresAt: z.string().datetime(),
  scheduledFor: z.string().datetime().nullable(),
  approvedAt: z.string().datetime().nullable(),
  sentAt: z.string().datetime().nullable(),
  attempts: z.number().int().nonnegative(),
  error: z.string().nullable()
};

export const PublicSendProposalSchema = z.object({
  ...publicProposalBase,
  kind: z.literal('send'),
  subject: z.string(),
  to: z.array(z.string()),
  cc: z.array(z.string())
});

export const PublicMoveProposalSchema = z.object({
  ...publicProposalBase,
  kind: z.literal('move'),
  idempotencyKey,
  itemCount: z.number().int().positive(),
  items: z.array(MoveItemSchema)
});

export const PublicProposalSchema = z.discriminatedUnion('kind', [
  PublicSendProposalSchema,
  PublicMoveProposalSchema
]);

export type PublicProposal = z.infer<typeof PublicProposalSchema>;
export type PublicSendProposal = z.infer<typeof PublicSendProposalSchema>;
export type PublicMoveProposal = z.infer<typeof PublicMoveProposalSchema>;

export const CreateProposalSchema = z.object({
  kind: z.literal('send').optional(),
  message: OutgoingMessageSchema,
  scheduledFor: z.string().datetime({ offset: true }).nullable(),
  note: z.string().max(500).nullable()
});

export type CreateProposal = z.infer<typeof CreateProposalSchema>;

export const CreateMoveProposalSchema = z.object({
  kind: z.literal('move'),
  items: z.array(MoveRequestItemSchema).min(1).max(25),
  idempotencyKey,
  note: z.string().max(500).nullable()
});

export type CreateMoveProposal = z.infer<typeof CreateMoveProposalSchema>;

export type CreatePreparedMoveProposal = {
  moveItems: MoveItem[];
  idempotencyKey: string;
  note: string | null;
};

export const RestoreMoveProposalSchema = z.object({
  idempotencyKey,
  note: z.string().max(500).nullable()
});

export function publicProposal(proposal: Proposal): PublicProposal {
  const base = {
    id: proposal.id,
    status: proposal.status,
    createdAt: proposal.createdAt,
    approvalExpiresAt: proposal.approvalExpiresAt,
    scheduledFor: proposal.scheduledFor,
    approvedAt: proposal.approvedAt,
    sentAt: proposal.sentAt,
    attempts: proposal.attempts,
    error: proposal.error
  };
  if (proposal.kind === 'move') {
    return {
      ...base,
      kind: 'move',
      idempotencyKey: proposal.idempotencyKey,
      itemCount: proposal.moveItems.length,
      items: proposal.moveItems
    };
  }
  return {
    ...base,
    kind: 'send',
    subject: proposal.message.subject,
    to: proposal.message.to,
    cc: proposal.message.cc ?? []
  };
}

export type RecipientPolicy = {
  maximum: number;
  allowlist: string[];
  denylist: string[];
};

export function validateRecipients(message: OutgoingMessage, policy: RecipientPolicy): string | null {
  const recipients = [...message.to, ...(message.cc ?? []), ...(message.bcc ?? [])];
  if (recipients.length === 0) return t.validation.atLeastOneRecipient;
  if (recipients.length > policy.maximum) {
    return t.validation.tooManyRecipients(recipients.length, policy.maximum);
  }

  const domains = recipients.map((address) => address.split('@')[1]?.toLowerCase() ?? '');
  const denied = domains.filter((domain) => policy.denylist.includes(domain));
  if (denied.length > 0) {
    return t.validation.recipientDomainDenied([...new Set(denied)].join(', '));
  }

  if (policy.allowlist.length > 0) {
    const notAllowed = domains.filter((domain) => !policy.allowlist.includes(domain));
    if (notAllowed.length > 0) {
      return t.validation.recipientDomainNotAllowed(
        [...new Set(notAllowed)].join(', ')
      );
    }
  }
  return null;
}

export type MovePolicy = {
  maximum: number;
  sourceAllowlist: string[];
  destinationAllowlist: string[];
};

export function validateMoveRequest(
  items: MoveRequestItem[],
  policy: MovePolicy
): string | null {
  if (items.length === 0) return t.validation.atLeastOneMessageToMove;
  if (items.length > policy.maximum) {
    return t.validation.tooManyMessages(items.length, policy.maximum);
  }

  const seen = new Set<string>();
  for (const item of items) {
    if (!policy.sourceAllowlist.includes(item.sourceMailbox)) {
      return t.validation.sourceMailboxNotAllowed(item.sourceMailbox);
    }
    if (!policy.destinationAllowlist.includes(item.destinationMailbox)) {
      return t.validation.destinationMailboxNotAllowed(item.destinationMailbox);
    }
    if (item.sourceMailbox === item.destinationMailbox) {
      return t.validation.sameSourceAndDestination(item.uid);
    }
    const key = `${item.sourceMailbox}\u0000${item.uid}`;
    if (seen.has(key)) {
      return t.validation.duplicateMessage(item.sourceMailbox, item.uid);
    }
    seen.add(key);
  }
  return null;
}
