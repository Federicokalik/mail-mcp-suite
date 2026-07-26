import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response
} from 'express';
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
  /**
   * Keep one server per MCP session instead of one per request. Required for
   * server-initiated requests such as elicitation, which cannot be delivered on
   * a single JSON response. Only enable it where those are actually used: a
   * session registry is state a stateless service does not have to defend.
   */
  stateful?: boolean;
  sessionIdleMs?: number;
  maxSessions?: number;
};

const DEFAULT_SESSION_IDLE_MS = 10 * 60_000;
const DEFAULT_MAX_SESSIONS = 64;

type Session = {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  lastSeen: number;
};

function securityHeaders(_request: Request, response: Response, next: NextFunction): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  next();
}

function failed(
  serviceName: string,
  response: Response,
  error: unknown,
  close: () => void
): void {
  console.error(
    `[${serviceName}] MCP request failed:`,
    error instanceof Error ? error.message : String(error)
  );
  if (!response.headersSent) {
    response.status(500).json({ error: 'mcp_request_failed' });
  } else {
    response.end();
  }
  close();
}

function registerStateless(app: Express, options: McpHttpOptions): void {
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
      failed(options.serviceName, response, error, close);
    }
  });

  app.all('/mcp', (_request, response) => {
    response.setHeader('Allow', 'POST');
    response.status(405).json({ error: 'method_not_allowed' });
  });
}

function registerStateful(
  app: Express,
  options: McpHttpOptions
): { shutdown: () => void } {
  const idleMs = options.sessionIdleMs ?? DEFAULT_SESSION_IDLE_MS;
  const maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
  const sessions = new Map<string, Session>();

  const drop = (sessionId: string): void => {
    const session = sessions.get(sessionId);
    if (!session) return;
    sessions.delete(sessionId);
    void session.transport.close();
    void session.server.close();
  };

  // Without this an abandoned client leaves a server and its transport pinned
  // in memory for the lifetime of the process.
  const sweeper = setInterval(() => {
    const cutoff = Date.now() - idleMs;
    for (const [sessionId, session] of sessions) {
      if (session.lastSeen < cutoff) drop(sessionId);
    }
  }, Math.max(30_000, Math.floor(idleMs / 4)));
  sweeper.unref();

  const existing = (request: Request): Session | undefined => {
    const header = request.header('mcp-session-id');
    if (!header) return undefined;
    const session = sessions.get(header);
    if (session) session.lastSeen = Date.now();
    return session;
  };

  app.post('/mcp', async (request, response) => {
    const session = existing(request);
    if (session) {
      try {
        await session.transport.handleRequest(request, response, request.body);
      } catch (error) {
        failed(options.serviceName, response, error, () => undefined);
      }
      return;
    }

    if (request.header('mcp-session-id')) {
      response.status(404).json({ error: 'session_not_found' });
      return;
    }
    if (sessions.size >= maxSessions) {
      response.status(503).json({ error: 'too_many_sessions' });
      return;
    }

    const server = options.buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        sessions.set(sessionId, { server, transport, lastSeen: Date.now() });
      },
      onsessionclosed: (sessionId) => {
        sessions.delete(sessionId);
      }
    });
    transport.onclose = () => {
      const sessionId = transport.sessionId;
      if (sessionId) sessions.delete(sessionId);
    };

    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      failed(options.serviceName, response, error, () => {
        void transport.close();
        void server.close();
      });
    }
  });

  // The standalone SSE stream carries server-to-client requests; DELETE ends
  // the session. Both only make sense for an already established session.
  for (const method of ['get', 'delete'] as const) {
    app[method]('/mcp', async (request, response) => {
      const session = existing(request);
      if (!session) {
        response.status(404).json({ error: 'session_not_found' });
        return;
      }
      try {
        await session.transport.handleRequest(request, response);
      } catch (error) {
        failed(options.serviceName, response, error, () => undefined);
      }
    });
  }

  app.all('/mcp', (_request, response) => {
    response.setHeader('Allow', 'POST, GET, DELETE');
    response.status(405).json({ error: 'method_not_allowed' });
  });

  return {
    shutdown: () => {
      clearInterval(sweeper);
      for (const sessionId of [...sessions.keys()]) drop(sessionId);
    }
  };
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

  const stateful = options.stateful ? registerStateful(app, options) : undefined;
  if (!stateful) registerStateless(app, options);

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
  if (stateful) httpServer.once('close', stateful.shutdown);
  return httpServer;
}
