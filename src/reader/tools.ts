import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SearchObject } from 'imapflow';
import { z } from 'zod';
import { guardTool, toolOk } from '../common/tool-result.js';
import { t } from '../common/i18n.js';
import { readerConfig } from './config.js';
import { getMessage, listMailboxes, searchMessages } from './imap.js';

const untrustedWarning = t.reader.untrustedWarning;

export function registerReaderTools(server: McpServer): void {
  server.registerTool(
    'mail_list_mailboxes',
    {
      title: t.reader.listMailboxes.title,
      description: t.reader.listMailboxes.description,
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async () =>
      guardTool(async () =>
        toolOk(
          {
            securityNotice: untrustedWarning,
            mailboxes: await listMailboxes()
          },
          readerConfig.CHARACTER_LIMIT
        )
      )
  );

  server.registerTool(
    'mail_search',
    {
      title: t.reader.search.title,
      description: `${t.reader.search.description} ${untrustedWarning}`,
      inputSchema: {
        mailbox: z.string().default('INBOX'),
        from: z.string().max(500).optional(),
        to: z.string().max(500).optional(),
        subject: z.string().max(500).optional(),
        body: z.string().max(1_000).optional(),
        since: z.string().datetime().optional(),
        before: z.string().datetime().optional(),
        unseenOnly: z.boolean().default(false),
        limit: z
          .number()
          .int()
          .min(1)
          .max(readerConfig.MAX_SEARCH_RESULTS)
          .default(Math.min(25, readerConfig.MAX_SEARCH_RESULTS))
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (arguments_) =>
      guardTool(async () => {
        const criteria: SearchObject = {};
        if (arguments_.from) criteria.from = arguments_.from;
        if (arguments_.to) criteria.to = arguments_.to;
        if (arguments_.subject) criteria.subject = arguments_.subject;
        if (arguments_.body) criteria.body = arguments_.body;
        if (arguments_.since) criteria.since = new Date(arguments_.since);
        if (arguments_.before) criteria.before = new Date(arguments_.before);
        if (arguments_.unseenOnly) criteria.seen = false;
        if (Object.keys(criteria).length === 0) criteria.all = true;

        const messages = await searchMessages({
          mailbox: arguments_.mailbox,
          criteria,
          limit: arguments_.limit
        });
        return toolOk(
          {
            securityNotice: untrustedWarning,
            count: messages.length,
            messages
          },
          readerConfig.CHARACTER_LIMIT
        );
      })
  );

  server.registerTool(
    'mail_get_message',
    {
      title: t.reader.getMessage.title,
      description: `${t.reader.getMessage.description} ${untrustedWarning}`,
      inputSchema: {
        mailbox: z.string(),
        uid: z.number().int().positive()
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (arguments_) =>
      guardTool(async () =>
        toolOk(
          await getMessage({ mailbox: arguments_.mailbox, uid: arguments_.uid }),
          readerConfig.CHARACTER_LIMIT
        )
      )
  );
}
