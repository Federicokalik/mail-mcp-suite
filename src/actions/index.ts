#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { startMcpHttpServer } from '../common/mcp-http.js';
import { actionsConfig } from './config.js';
import { registerActionsTools } from './tools.js';

function buildServer(): McpServer {
  const server = new McpServer({ name: 'mail-actions', version: '3.0.0' });
  registerActionsTools(server);
  return server;
}

const httpServer = startMcpHttpServer({
  serviceName: 'mail-actions',
  host: actionsConfig.MCP_HOST,
  port: actionsConfig.MCP_PORT,
  token: actionsConfig.MCP_TOKEN,
  allowedHosts: actionsConfig.MCP_ALLOWED_HOSTS,
  // A send can now carry a text part, an HTML part and an MJML source. 1mb was enough for a
  // text-only body; going over it fails as an opaque 413 before any validation runs.
  jsonLimit: '2mb',
  buildServer,
  // Terminal clients approve through elicitation, which needs a session the
  // server can send requests back on. The reader stays stateless.
  stateful: true
});

function shutdown(signal: string): void {
  console.error(`[mail-actions] received ${signal}, shutting down`);
  httpServer.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
