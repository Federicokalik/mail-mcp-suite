import type { Server } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type NextFunction, type Request, type Response } from 'express';
import {
  type CloudflareAccessOptions,
  verifyCloudflareAccessJwt
} from './access-jwt.js';
import { bearerToken, hostAllowed, secretMatches } from './security.js';

type McpHttpOptions = {
  serviceName: string;
  host: string;
  port: number;
  token: string;
  access?: CloudflareAccessOptions;
  allowedHosts: readonly string[];
  jsonLimit: string;
  buildServer: () => McpServer;
};

function securityHeaders(_request: Request, response: Response, next: NextFunction): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  next();
}

export function startMcpHttpServer(options: McpHttpOptions): Server {
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use((request, response, next) => {
    if (!hostAllowed(request.header('host'), options.allowedHosts)) {
      response.status(421).json({ error: 'host_not_allowed' });
      return;
    }
    next();
  });

  app.get('/healthz', (_request, response) => {
    response.json({ status: 'ok', service: options.serviceName });
  });

  app.use('/mcp', async (request, response, next) => {
    const authorization = request.header('authorization');
    const candidate = bearerToken(authorization);
    const staticTokenAuthorized = Boolean(
      candidate && secretMatches(candidate, options.token)
    );
    const accessAuthorized =
      !staticTokenAuthorized &&
      options.access !== undefined &&
      (await verifyCloudflareAccessJwt(
        request.header('cf-access-jwt-assertion'),
        options.access
      ));
    const authorized = staticTokenAuthorized || accessAuthorized;
    if (!authorized) {
      response.setHeader('WWW-Authenticate', 'Bearer');
      response.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  });
  app.use('/mcp', express.json({ limit: options.jsonLimit }));

  app.post('/mcp', async (request, response) => {
    const server = options.buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });

    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      void transport.close();
      void server.close();
    };
    response.once('close', close);

    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      console.error(
        `[${options.serviceName}] MCP request failed:`,
        error instanceof Error ? error.message : String(error)
      );
      if (!response.headersSent) {
        response.status(500).json({ error: 'mcp_request_failed' });
      } else {
        response.end();
      }
      close();
    }
  });

  app.all('/mcp', (_request, response) => {
    response.setHeader('Allow', 'POST');
    response.status(405).json({ error: 'method_not_allowed' });
  });

  const httpServer = app.listen(options.port, options.host);
  httpServer.once('listening', () => {
    console.error(
      `[${options.serviceName}] MCP HTTP listening on ${options.host}:${options.port}/mcp`
    );
  });
  httpServer.once('error', (error) => {
    console.error(
      `[${options.serviceName}] cannot start HTTP:`,
      error instanceof Error ? error.message : String(error)
    );
    process.exitCode = 1;
  });
  return httpServer;
}
