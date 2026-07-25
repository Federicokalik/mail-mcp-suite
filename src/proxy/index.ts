#!/usr/bin/env node
import http, { type IncomingHttpHeaders } from 'node:http';
import { verifyCloudflareAccessJwt } from '../common/access-jwt.js';
import { readSecret } from '../common/env.js';
import { hostAllowed } from '../common/security.js';

const host = process.env.PROXY_HOST ?? '0.0.0.0';
const port = Number.parseInt(process.env.PROXY_PORT ?? '3334', 10);
const target = new URL(process.env.PROXY_TARGET ?? 'http://actions:3334');
const timeoutMs = Number.parseInt(process.env.PROXY_TIMEOUT_MS ?? '30000', 10);
const allowedHosts = (process.env.PROXY_ALLOWED_HOSTS ?? 'localhost,127.0.0.1')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const accessTeamDomain = process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN;
const accessAudience = process.env.CLOUDFLARE_ACCESS_AUD;
const accessEmails = (process.env.CLOUDFLARE_ACCESS_EMAILS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const internalMcpToken = readSecret('MCP_TOKEN', 32);
const hasAnyAccessSetting = Boolean(
  accessTeamDomain || accessAudience || accessEmails.length > 0
);
const accessOptions =
  accessTeamDomain && accessAudience && accessEmails.length > 0
    ? {
        teamDomain: accessTeamDomain,
        audience: accessAudience,
        allowedEmails: accessEmails
      }
    : null;

if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
  throw new Error('Invalid PROXY_PORT.');
}
if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
  throw new Error('Invalid PROXY_TIMEOUT_MS.');
}
if (target.protocol !== 'http:') {
  throw new Error('PROXY_TARGET must use HTTP on the internal Docker network.');
}
if (allowedHosts.length === 0) {
  throw new Error('PROXY_ALLOWED_HOSTS must contain at least one hostname.');
}
if (hasAnyAccessSetting && !accessOptions) {
  throw new Error(
    'Configure CLOUDFLARE_ACCESS_TEAM_DOMAIN, CLOUDFLARE_ACCESS_AUD and CLOUDFLARE_ACCESS_EMAILS together, or omit all of them.'
  );
}

function forwardedHeaders(
  headers: IncomingHttpHeaders,
  useInternalToken: boolean
): IncomingHttpHeaders {
  const output = { ...headers };
  delete output.connection;
  delete output.host;
  delete output['proxy-authorization'];
  delete output['cf-access-jwt-assertion'];
  if (useInternalToken) {
    output.authorization = `Bearer ${internalMcpToken}`;
  }
  output.host = target.host;
  return output;
}

const server = http.createServer(async (request, response) => {
  if (!hostAllowed(request.headers.host, allowedHosts)) {
    response.writeHead(421, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'host_not_allowed' }));
    return;
  }

  if (request.url === '/healthz' && request.method === 'GET') {
    response.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    response.end(JSON.stringify({ status: 'ok', service: 'mail-actions-proxy' }));
    return;
  }

  if (request.url !== '/mcp') {
    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'not_found' }));
    return;
  }

  const accessAuthorized =
    accessOptions !== null &&
    (await verifyCloudflareAccessJwt(
      typeof request.headers['cf-access-jwt-assertion'] === 'string'
        ? request.headers['cf-access-jwt-assertion']
        : undefined,
      accessOptions
    ));

  const upstream = http.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: '/mcp',
      method: request.method,
      headers: forwardedHeaders(request.headers, accessAuthorized),
      timeout: timeoutMs
    },
    (upstreamResponse) => {
      response.writeHead(
        upstreamResponse.statusCode ?? 502,
        upstreamResponse.headers
      );
      upstreamResponse.pipe(response);
    }
  );

  upstream.once('timeout', () => {
    upstream.destroy(new Error('Timeout upstream.'));
  });
  upstream.once('error', () => {
    if (!response.headersSent) {
      response.writeHead(502, { 'Content-Type': 'application/json' });
    }
    response.end(JSON.stringify({ error: 'upstream_unavailable' }));
  });
  request.pipe(upstream);
});

server.once('listening', () => {
  console.error(`[mail-actions-proxy] ${host}:${port} -> ${target.origin}`);
});
server.once('error', (error) => {
  console.error(
    '[mail-actions-proxy] cannot start HTTP:',
    error instanceof Error ? error.message : String(error)
  );
  process.exitCode = 1;
});
server.listen(port, host);

function shutdown(signal: string): void {
  console.error(`[mail-actions-proxy] received ${signal}, shutting down`);
  server.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
