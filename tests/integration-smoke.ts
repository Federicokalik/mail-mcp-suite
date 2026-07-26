import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const readerToken = 'r'.repeat(32);
const actionsToken = 'a'.repeat(32);
const queueToken = 'q'.repeat(32);
const csrfSecret = 'c'.repeat(32);
const workerPort = 17337;
const readerPort = 13333;
const actionsPort = 13334;
const actionsProxyPort = 13335;
const children: ChildProcessWithoutNullStreams[] = [];
const logs: string[] = [];

function start(entrypoint: string, environment: NodeJS.ProcessEnv): ChildProcessWithoutNullStreams {
  const child = spawn(process.execPath, [entrypoint], {
    cwd: process.cwd(),
    env: { ...process.env, ...environment },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  child.stdout.on('data', (chunk: Buffer) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => logs.push(chunk.toString()));
  children.push(child);
  return child;
}

async function waitForHealth(url: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The process may still be starting up.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timeout healthcheck ${url}`);
}

async function mcpClient(url: string, token: string): Promise<Client> {
  const client = new Client({ name: 'integration-smoke', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  });
  await client.connect(transport);
  return client;
}

function toolText(result: unknown): string {
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) throw new Error('MCP result without content.');
  const item = content.find(
    (candidate): candidate is { type: 'text'; text: string } =>
      typeof candidate === 'object' &&
      candidate !== null &&
      (candidate as { type?: unknown }).type === 'text' &&
      typeof (candidate as { text?: unknown }).text === 'string'
  );
  if (!item) throw new Error('MCP result without textual content.');
  return item.text;
}

const directory = await mkdtemp(join(tmpdir(), 'mail-mcp-integration-'));

try {
  start('dist/worker/index.js', {
    SMTP_HOST: 'invalid.local',
    SMTP_USER: 'test@example.com',
    SMTP_PASSWORD: 'dummy-password',
    MOVE_IMAP_PASSWORD: 'dummy-password',
    FROM_ADDRESS: 'test@example.com',
    QUEUE_API_TOKEN: queueToken,
    APPROVAL_SECRET: 'approval-dummy',
    APPROVAL_CSRF_SECRET: csrfSecret,
    OUTBOX_PATH: join(directory, 'outbox.json'),
    WORKER_HOST: '127.0.0.1',
    WORKER_PORT: String(workerPort),
    // Keeps the scheduler from claiming the proposal we approve below, so the
    // assertion sees "approved" rather than a transient "sending".
    SCHEDULER_INTERVAL_MS: '60000'
  });
  await waitForHealth(`http://127.0.0.1:${workerPort}/healthz`);

  start('dist/reader/index.js', {
    IMAP_HOST: 'invalid.local',
    IMAP_USER: 'test@example.com',
    IMAP_PASSWORD: 'dummy-password',
    MCP_TOKEN: readerToken,
    MCP_HOST: '127.0.0.1',
    MCP_PORT: String(readerPort)
  });
  start('dist/actions/index.js', {
    WORKER_INTERNAL_URL: `http://127.0.0.1:${workerPort}`,
    APPROVAL_BASE_URL: `http://127.0.0.1:${workerPort}`,
    QUEUE_API_TOKEN: queueToken,
    MCP_TOKEN: actionsToken,
    MCP_HOST: '127.0.0.1',
    MCP_PORT: String(actionsPort)
  });
  start('dist/proxy/index.js', {
    PROXY_HOST: '127.0.0.1',
    PROXY_PORT: String(actionsProxyPort),
    PROXY_TARGET: `http://127.0.0.1:${actionsPort}`,
    MCP_TOKEN: actionsToken
  });

  await Promise.all([
    waitForHealth(`http://127.0.0.1:${readerPort}/healthz`),
    waitForHealth(`http://127.0.0.1:${actionsPort}/healthz`),
    waitForHealth(`http://127.0.0.1:${actionsProxyPort}/healthz`)
  ]);

  const unauthorized = await fetch(`http://127.0.0.1:${readerPort}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert.equal(unauthorized.status, 401);

  const reader = await mcpClient(
    `http://127.0.0.1:${readerPort}/mcp`,
    readerToken
  );
  const readerTools = await reader.listTools();
  assert.deepEqual(
    readerTools.tools.map((tool) => tool.name).sort(),
    ['mail_get_message', 'mail_list_mailboxes', 'mail_search']
  );
  await reader.close();

  const actions = await mcpClient(
    `http://127.0.0.1:${actionsProxyPort}/mcp`,
    actionsToken
  );
  const actionsTools = await actions.listTools();
  assert.ok(actionsTools.tools.some((tool) => tool.name === 'mail_send'));
  assert.ok(actionsTools.tools.some((tool) => tool.name === 'mail_schedule'));
  assert.ok(actionsTools.tools.some((tool) => tool.name === 'mail_move_propose'));

  const created = await actions.callTool({
    name: 'mail_send',
    arguments: {
      to: ['recipient@example.com'],
      subject: 'Smoke test',
      text: 'Do not send: integration test'
    }
  });
  assert.equal(created.isError, undefined);
  const payload = JSON.parse(toolText(created)) as { id: string; approvalUrl: string };
  assert.match(payload.approvalUrl, /\/approval\//);

  const approval = await fetch(payload.approvalUrl);
  assert.equal(approval.status, 200);
  const approvalHtml = await approval.text();
  assert.match(approvalHtml, /Do not send: integration test/);
  const csrf = approvalHtml.match(/name="csrf" value="([^"]+)"/)?.[1];
  assert.ok(csrf);

  const publicOriginPost = await fetch(`${payload.approvalUrl}/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: 'https://approval.example.test'
    },
    body: new URLSearchParams({
      csrf,
      secret: 'deliberately-wrong-secret'
    })
  });
  assert.equal(publicOriginPost.status, 401);
  assert.match(await publicOriginPost.text(), /Wrong approval secret/);

  const cancelled = await actions.callTool({
    name: 'mail_delivery_cancel',
    arguments: { id: payload.id }
  });
  assert.equal(
    (JSON.parse(toolText(cancelled)) as { status: string }).status,
    'cancelled'
  );

  // In-chat approval: the tool result hands the app a capability token, and the
  // app then talks to the worker directly. The body and the approval secret
  // never travel through the MCP channel.
  const body = 'Body reviewed only inside the approval app';
  const forApp = await actions.callTool({
    name: 'mail_send',
    arguments: {
      to: ['recipient@example.com'],
      subject: 'App approval',
      text: body
    }
  });
  assert.doesNotMatch(toolText(forApp), new RegExp(body));

  const appPayload = JSON.parse(toolText(forApp)) as { id: string };
  const appContext = (
    forApp._meta as
      | Record<
          string,
          { proposalId: string; appToken: string; approvalOrigin: string }
        >
      | undefined
  )?.['mail/approval'];
  assert.ok(appContext, 'the tool result carries the approval app context');
  assert.equal(appContext.proposalId, appPayload.id);

  const appBase = `${appContext.approvalOrigin}/approval/${appPayload.id}`;
  const authorized = { Authorization: `Bearer ${appContext.appToken}` };

  const preflight = await fetch(`${appBase}/app`, { method: 'OPTIONS' });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*');

  const forged = await fetch(`${appBase}/app`, {
    headers: { Authorization: 'Bearer not-the-right-token' }
  });
  assert.equal(forged.status, 401);

  const view = await fetch(`${appBase}/app`, { headers: authorized });
  assert.equal(view.status, 200);
  const { view: proposalView } = (await view.json()) as {
    view: {
      status: string;
      body: string;
      actions: { approveCsrf: string; cancelCsrf: string };
    };
  };
  assert.equal(proposalView.body, body);
  assert.ok(proposalView.actions);

  const post = async (action: string, payload: unknown): Promise<Response> =>
    fetch(`${appBase}/app-${action}`, {
      method: 'POST',
      headers: { ...authorized, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

  const wrongSecret = await post('approve', {
    csrf: proposalView.actions.approveCsrf,
    secret: 'deliberately-wrong-secret'
  });
  assert.equal(wrongSecret.status, 401);

  const wrongCsrf = await post('approve', {
    csrf: proposalView.actions.cancelCsrf,
    secret: 'approval-dummy'
  });
  assert.equal(wrongCsrf.status, 403);

  const approved = await post('approve', {
    csrf: proposalView.actions.approveCsrf,
    secret: 'approval-dummy'
  });
  assert.equal(approved.status, 200);
  assert.equal(
    ((await approved.json()) as { view: { status: string } }).view.status,
    'approved'
  );

  await actions.close();

  console.log(
    'Smoke test passed: MCP auth, tool discovery, queue, cancellation and in-chat approval OK.'
  );
} catch (error) {
  console.error(logs.join(''));
  throw error;
} finally {
  for (const child of children) {
    child.kill('SIGTERM');
  }
  await Promise.all(
    children.map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null) resolve();
          else child.once('exit', () => resolve());
        })
    )
  );
  await rm(directory, { recursive: true, force: true });
}
