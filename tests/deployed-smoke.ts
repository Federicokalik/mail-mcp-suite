import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

function secret(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r?\n$/, '');
}

async function connect(url: string, token: string): Promise<Client> {
  const client = new Client({ name: 'deployed-smoke', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: {
      headers: { Authorization: `Bearer ${token}` }
    }
  });
  await client.connect(transport);
  return client;
}

const secretsDirectory =
  process.env.MAIL_MCP_SECRETS_DIR ?? './local-config/secrets';

const reader = await connect(
  process.env.READER_MCP_URL ?? 'http://127.0.0.1:3333/mcp',
  secret(
    process.env.READER_MCP_TOKEN_FILE ??
      join(secretsDirectory, 'reader_mcp_token')
  )
);
const readerTools = await reader.listTools();
assert.deepEqual(
  readerTools.tools.map((tool) => tool.name).sort(),
  ['mail_get_message', 'mail_list_mailboxes', 'mail_search']
);
const mailboxes = await reader.callTool({
  name: 'mail_list_mailboxes',
  arguments: {}
});
assert.notEqual(mailboxes.isError, true);
await reader.close();

const actions = await connect(
  process.env.ACTIONS_MCP_URL ?? 'http://127.0.0.1:3334/mcp',
  secret(
    process.env.ACTIONS_MCP_TOKEN_FILE ??
      join(secretsDirectory, 'actions_mcp_token')
  )
);
const actionTools = await actions.listTools();
assert.deepEqual(
  actionTools.tools.map((tool) => tool.name).sort(),
  [
    'mail_delivery_cancel',
    'mail_delivery_get',
    'mail_delivery_list',
    'mail_move_cancel',
    'mail_move_get',
    'mail_move_list',
    'mail_move_propose',
    'mail_move_restore',
    'mail_schedule',
    'mail_send'
  ]
);
const deliveries = await actions.callTool({
  name: 'mail_delivery_list',
  arguments: { limit: 1 }
});
assert.notEqual(deliveries.isError, true);
await actions.close();

console.log(
  'Deployment verified: authentication, Reader IMAP and Actions→Worker are operational.'
);
