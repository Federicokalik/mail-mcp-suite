import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  MoveRequestItemSchema,
  OutgoingMessageSchema,
  ProposalStatusSchema,
  type OutgoingMessage,
  type PublicProposal
} from '../common/types.js';
import { guardTool, toolOk } from '../common/tool-result.js';
import { t } from '../common/i18n.js';
import { actionsConfig } from './config.js';
import {
  cancelProposal,
  createMoveProposal,
  createProposal,
  getProposal,
  listProposals,
  restoreMoveProposal
} from './worker-client.js';

const emailList = z.array(z.string().email()).max(50);
const headerValue = z
  .string()
  .min(1)
  .max(1_000)
  .refine((value) => !/[\r\n]/.test(value), t.validation.crLfNotAllowed);
const idempotencyKey = z
  .string()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/);

const messageInput = {
  to: emailList.min(1),
  cc: emailList.optional(),
  bcc: emailList.optional(),
  subject: headerValue,
  text: z.string().min(1).max(200_000),
  inReplyTo: headerValue.optional(),
  references: z.array(headerValue).max(100).optional(),
  note: z.string().max(500).optional()
};

function messageFromArguments(arguments_: {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
  inReplyTo?: string;
  references?: string[];
}): OutgoingMessage {
  return OutgoingMessageSchema.parse({
    to: arguments_.to,
    cc: arguments_.cc,
    bcc: arguments_.bcc,
    subject: arguments_.subject,
    text: arguments_.text,
    inReplyTo: arguments_.inReplyTo,
    references: arguments_.references
  });
}

function expectKind(
  proposal: PublicProposal,
  kind: PublicProposal['kind']
): PublicProposal {
  if (proposal.kind !== kind) {
    throw new Error(
      kind === 'send' ? t.actions.notASend : t.actions.notAMove
    );
  }
  return proposal;
}

export function registerActionsTools(server: McpServer): void {
  server.registerTool(
    'mail_send',
    {
      title: t.actions.send.title,
      description: t.actions.send.description,
      inputSchema: messageInput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (arguments_) =>
      guardTool(async () => {
        const result = await createProposal({
          message: messageFromArguments(arguments_),
          scheduledFor: null,
          note: arguments_.note ?? null
        });
        return toolOk(
          {
            ...result.proposal,
            approvalUrl: result.approvalUrl,
            sent: false,
            nextStep: t.actions.nextStep.send
          },
          actionsConfig.CHARACTER_LIMIT
        );
      })
  );

  server.registerTool(
    'mail_schedule',
    {
      title: t.actions.schedule.title,
      description: t.actions.schedule.description,
      inputSchema: {
        ...messageInput,
        scheduledFor: z
          .string()
          .datetime({ offset: true })
          .describe(t.actions.schedule.scheduledFor)
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (arguments_) =>
      guardTool(async () => {
        const result = await createProposal({
          message: messageFromArguments(arguments_),
          scheduledFor: arguments_.scheduledFor,
          note: arguments_.note ?? null
        });
        return toolOk(
          {
            ...result.proposal,
            approvalUrl: result.approvalUrl,
            scheduled: false,
            nextStep: t.actions.nextStep.schedule
          },
          actionsConfig.CHARACTER_LIMIT
        );
      })
  );

  server.registerTool(
    'mail_move_propose',
    {
      title: t.actions.movePropose.title,
      description: t.actions.movePropose.description,
      inputSchema: {
        items: z.array(MoveRequestItemSchema).min(1).max(25),
        idempotencyKey: idempotencyKey.describe(
          t.actions.movePropose.idempotencyKey
        ),
        note: z.string().max(500).optional()
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (arguments_) =>
      guardTool(async () => {
        const result = await createMoveProposal({
          kind: 'move',
          items: arguments_.items,
          idempotencyKey: arguments_.idempotencyKey,
          note: arguments_.note ?? null
        });
        expectKind(result.proposal, 'move');
        return toolOk(
          {
            ...result.proposal,
            approvalUrl: result.approvalUrl,
            moved: false,
            nextStep: t.actions.nextStep.move
          },
          actionsConfig.CHARACTER_LIMIT
        );
      })
  );

  server.registerTool(
    'mail_delivery_list',
    {
      title: t.actions.deliveryList.title,
      description: t.actions.deliveryList.description,
      inputSchema: {
        status: ProposalStatusSchema.optional(),
        limit: z.number().int().min(1).max(100).default(20)
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (arguments_) =>
      guardTool(async () =>
        toolOk(
          await listProposals(arguments_.status, arguments_.limit, 'send'),
          actionsConfig.CHARACTER_LIMIT
        )
      )
  );

  server.registerTool(
    'mail_delivery_get',
    {
      title: t.actions.deliveryGet.title,
      description: t.actions.deliveryGet.description,
      inputSchema: { id: z.string().uuid() },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (arguments_) =>
      guardTool(async () => {
        const proposal = expectKind(await getProposal(arguments_.id), 'send');
        return toolOk(proposal, actionsConfig.CHARACTER_LIMIT);
      })
  );

  server.registerTool(
    'mail_delivery_cancel',
    {
      title: t.actions.deliveryCancel.title,
      description: t.actions.deliveryCancel.description,
      inputSchema: { id: z.string().uuid() },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (arguments_) =>
      guardTool(async () => {
        expectKind(await getProposal(arguments_.id), 'send');
        return toolOk(
          await cancelProposal(arguments_.id),
          actionsConfig.CHARACTER_LIMIT
        );
      })
  );

  server.registerTool(
    'mail_move_list',
    {
      title: t.actions.moveList.title,
      description: t.actions.moveList.description,
      inputSchema: {
        status: ProposalStatusSchema.optional(),
        limit: z.number().int().min(1).max(100).default(20)
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (arguments_) =>
      guardTool(async () =>
        toolOk(
          await listProposals(arguments_.status, arguments_.limit, 'move'),
          actionsConfig.CHARACTER_LIMIT
        )
      )
  );

  server.registerTool(
    'mail_move_get',
    {
      title: t.actions.moveGet.title,
      description: t.actions.moveGet.description,
      inputSchema: { id: z.string().uuid() },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (arguments_) =>
      guardTool(async () => {
        const proposal = expectKind(await getProposal(arguments_.id), 'move');
        return toolOk(proposal, actionsConfig.CHARACTER_LIMIT);
      })
  );

  server.registerTool(
    'mail_move_cancel',
    {
      title: t.actions.moveCancel.title,
      description: t.actions.moveCancel.description,
      inputSchema: { id: z.string().uuid() },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (arguments_) =>
      guardTool(async () => {
        expectKind(await getProposal(arguments_.id), 'move');
        return toolOk(
          await cancelProposal(arguments_.id),
          actionsConfig.CHARACTER_LIMIT
        );
      })
  );

  server.registerTool(
    'mail_move_restore',
    {
      title: t.actions.moveRestore.title,
      description: t.actions.moveRestore.description,
      inputSchema: {
        id: z.string().uuid(),
        idempotencyKey,
        note: z.string().max(500).optional()
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (arguments_) =>
      guardTool(async () => {
        const result = await restoreMoveProposal(arguments_.id, {
          idempotencyKey: arguments_.idempotencyKey,
          note: arguments_.note ?? null
        });
        expectKind(result.proposal, 'move');
        return toolOk(
          {
            ...result.proposal,
            approvalUrl: result.approvalUrl,
            restored: false,
            nextStep: t.actions.nextStep.restore
          },
          actionsConfig.CHARACTER_LIMIT
        );
      })
  );
}
