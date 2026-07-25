#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { startMcpHttpServer } from '../common/mcp-http.js';
import { readerConfig } from './config.js';
import { registerReaderTools } from './tools.js';

function buildServer(): McpServer {
  const server = new McpServer({ name: 'mail-reader', version: '2.0.0' });
  registerReaderTools(server);
  return server;
}

const httpServer = startMcpHttpServer({
  serviceName: 'mail-reader',
  host: readerConfig.MCP_HOST,
  port: readerConfig.MCP_PORT,
  token: readerConfig.MCP_TOKEN,
  access: readerConfig.CLOUDFLARE_ACCESS,
  allowedHosts: readerConfig.MCP_ALLOWED_HOSTS,
  jsonLimit: '1mb',
  buildServer
});

function shutdown(signal: string): void {
  console.error(`[mail-reader] received ${signal}, shutting down`);
  httpServer.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
