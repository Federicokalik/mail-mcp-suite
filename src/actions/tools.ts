import { readFile } from 'node:fs/promises';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  RESOURCE_MIME_TYPE,
  getUiCapability,
  registerAppResource,
  registerAppTool
} from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import {
  MoveRequestItemSchema,
  OutgoingMessageSchema,
  ProposalStatusSchema,
  type OutgoingMessage,
  type PublicProposal
} from '../common/types.js';
import { guardTool, toolOk, type ToolResult } from '../common/tool-result.js';
import { t } from '../common/i18n.js';
import { actionsConfig } from './config.js';
import {
  cancelProposal,
  createMoveProposal,
  createProposal,
  getProposal,
  listProposals,
  restoreMoveProposal,
  type CreatedProposal
} from './worker-client.js';

const APPROVAL_RESOURCE_URI = 'ui://mail-approval/app.html';
const approvalAppFile = new URL('../app/index.html', import.meta.url);

let approvalAppHtml: string | undefined;

// A fresh McpServer is built per request, so the bundle is cached at module
// scope rather than re-read from disk on every resources/read.
async function readApprovalApp(): Promise<string> {
  approvalAppHtml ??= await readFile(approvalAppFile, 'utf8');
  return approvalAppHtml;
}

const approvalUiMeta = {
  ui: {
    // Deny-by-default: the app may reach the worker and nothing else.
    csp: { connectDomains: [actionsConfig.APPROVAL_ORIGIN] }
  }
} as const;

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

const APPROVAL_POLL_MS = 2_000;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Clients that cannot render the app — terminals, mostly — get the approval
 * page offered as a URL-mode elicitation instead, and the call waits for the
 * outcome so the conversation reports what actually happened. Only the URL
 * travels through the client: the proposal is still reviewed and the secret
 * still typed in the browser, against the worker.
 */
async function awaitApproval(
  server: McpServer,
  created: CreatedProposal
): Promise<PublicProposal | undefined> {
  if (actionsConfig.APPROVAL_WAIT_MS <= 0) return undefined;
  const capabilities = server.server.getClientCapabilities();
  if (!capabilities?.elicitation?.url) return undefined;
  // Hosts that render the app already have a better surface than a link.
  if (getUiCapability(capabilities)) return undefined;

  let settled = false;
  const elicited = server.server
    .elicitInput({
      mode: 'url',
      message: t.actions.elicitation.message,
      elicitationId: created.proposal.id,
      url: created.approvalUrl
    })
    .then(
      () => undefined,
      () => undefined
    )
    .finally(() => {
      settled = true;
    });

  const deadline = Date.now() + actionsConfig.APPROVAL_WAIT_MS;
  let outcome: PublicProposal | undefined;
  while (!settled && Date.now() < deadline) {
    await delay(APPROVAL_POLL_MS);
    const current = await getProposal(created.proposal.id).catch(
      () => undefined
    );
    if (current && current.status !== 'pending_approval') {
      outcome = current;
      break;
    }
  }

  await server.server
    .createElicitationCompletionNotifier(created.proposal.id)()
    .catch(() => undefined);
  await elicited;
  return outcome;
}

/**
 * The text half stays exactly as before: recipients, subject and status, never
 * the body or the Bcc list. The capability token rides in `_meta`, which hosts
 * hand to the app instead of the model, and the app fetches the full proposal
 * straight from the worker. Nothing here lets the model approve on its own.
 */
async function proposalResult(
  server: McpServer,
  created: CreatedProposal,
  extra: Record<string, unknown>
): Promise<ToolResult> {
  const outcome = await awaitApproval(server, created);
  return {
    ...toolOk(
      outcome
        ? { ...outcome, approvalUrl: created.approvalUrl }
        : {
            ...created.proposal,
            approvalUrl: created.approvalUrl,
            ...extra
          },
      actionsConfig.CHARACTER_LIMIT
    ),
    _meta: {
      'mail/approval': {
        proposalId: created.proposal.id,
        appToken: created.appToken,
        approvalOrigin: actionsConfig.APPROVAL_ORIGIN
      }
    }
  };
}

export function registerActionsTools(server: McpServer): void {
  registerAppResource(
    server,
    'mail-approval',
    APPROVAL_RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE, _meta: approvalUiMeta },
    async () => ({
      contents: [
        {
          uri: APPROVAL_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: await readApprovalApp()
        }
      ],
      _meta: approvalUiMeta
    })
  );

  registerAppTool(
    server,
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
      },
      _meta: { ui: { resourceUri: APPROVAL_RESOURCE_URI } }
    },
    async (arguments_) =>
      guardTool(async () =>
        proposalResult(
          server,
          await createProposal({
            message: messageFromArguments(arguments_),
            scheduledFor: null,
            note: arguments_.note ?? null
          }),
          { sent: false, nextStep: t.actions.nextStep.send }
        )
      )
  );

  registerAppTool(
    server,
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
      },
      _meta: { ui: { resourceUri: APPROVAL_RESOURCE_URI } }
    },
    async (arguments_) =>
      guardTool(async () =>
        proposalResult(
          server,
          await createProposal({
            message: messageFromArguments(arguments_),
            scheduledFor: arguments_.scheduledFor,
            note: arguments_.note ?? null
          }),
          { scheduled: false, nextStep: t.actions.nextStep.schedule }
        )
      )
  );

  registerAppTool(
    server,
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
      },
      _meta: { ui: { resourceUri: APPROVAL_RESOURCE_URI } }
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
        return proposalResult(server, result, {
          moved: false,
          nextStep: t.actions.nextStep.move
        });
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

  registerAppTool(
    server,
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
      },
      _meta: { ui: { resourceUri: APPROVAL_RESOURCE_URI } }
    },
    async (arguments_) =>
      guardTool(async () => {
        const result = await restoreMoveProposal(arguments_.id, {
          idempotencyKey: arguments_.idempotencyKey,
          note: arguments_.note ?? null
        });
        expectKind(result.proposal, 'move');
        return proposalResult(server, result, {
          restored: false,
          nextStep: t.actions.nextStep.restore
        });
      })
  );
}
