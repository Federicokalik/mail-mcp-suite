import type { Server } from 'node:http';
import express, {
  type NextFunction,
  type Request,
  type Response
} from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import {
  CreateMoveProposalSchema,
  CreateProposalSchema,
  ProposalKindSchema,
  ProposalStatusSchema,
  RestoreMoveProposalSchema,
  publicProposal,
  validateMoveRequest,
  validateRecipients
} from '../common/types.js';
import {
  bearerToken,
  hostAllowed,
  secretMatches,
  signForm,
  verifyFormSignature
} from '../common/security.js';
import { t } from '../common/i18n.js';
import { movePolicy, recipientPolicy, workerConfig } from './config.js';
import { prepareMoveItems, reverseMovedItems } from './imap-move.js';
import {
  approvalView,
  renderApproval,
  renderPreviewDocument,
  renderSimple,
  renderStatus
} from './approval-ui.js';
import type { ProposalStore } from './store.js';

const APP_ROUTE = /^\/approval\/[^/]+\/app(-approve|-cancel)?$/;

/**
 * Capability token for the in-chat approval app. It is handed to Actions over
 * the internal control network and forwarded to the app, never to the model in
 * a form it can use on its own: approving still requires the CSRF signature and
 * the human approval secret, neither of which travels through the LLM host.
 */
function appToken(proposal: { id: string; createdAt: string }): string {
  return signForm(
    workerConfig.APPROVAL_CSRF_SECRET,
    proposal.id,
    proposal.createdAt,
    'app'
  );
}

function securityHeaders(_request: Request, response: Response, next: NextFunction): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  // frame-src 'self' exists for one thing: the sandboxed HTML preview of a message body, served
  // by /approval/:id/preview. Nothing else on this origin is framed.
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; frame-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
  );
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
}

function apiAuthentication(request: Request, response: Response, next: NextFunction): void {
  const candidate = bearerToken(request.header('authorization'));
  if (!candidate || !secretMatches(candidate, workerConfig.QUEUE_API_TOKEN)) {
    response.setHeader('WWW-Authenticate', 'Bearer');
    response.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}

function validateSchedule(value: string | null): void {
  if (!value) return;
  const scheduled = new Date(value).getTime();
  const now = Date.now();
  const minimum = now + workerConfig.MIN_SCHEDULE_LEAD_SECONDS * 1_000;
  const maximum = now + workerConfig.MAX_SCHEDULE_DAYS * 86_400_000;
  if (scheduled < minimum) {
    throw new Error(
      t.worker.scheduleTooSoon(workerConfig.MIN_SCHEDULE_LEAD_SECONDS)
    );
  }
  if (scheduled > maximum) {
    throw new Error(t.worker.scheduleTooFar(workerConfig.MAX_SCHEDULE_DAYS));
  }
}

export function startWorkerServer(store: ProposalStore): Server {
  const app = express();
  app.set(
    'trust proxy',
    workerConfig.TRUST_PROXY_HOPS > 0
      ? workerConfig.TRUST_PROXY_HOPS
      : false
  );
  app.disable('x-powered-by');
  app.disable('etag');
  app.use(securityHeaders);
  app.use((request, response, next) => {
    if (!hostAllowed(request.header('host'), workerConfig.WORKER_ALLOWED_HOSTS)) {
      response.status(421).json({ error: 'host_not_allowed' });
      return;
    }
    next();
  });

  app.get('/healthz', (_request, response) => {
    response.json({ status: 'ok', service: 'mail-worker' });
  });

  // Matches the Actions transport limit: a proposal may carry both a text and an HTML part.
  app.use('/api', apiAuthentication, express.json({ limit: '2mb' }));

  app.post('/api/proposals', async (request, response) => {
    if (request.body?.kind === 'move') {
      const input = CreateMoveProposalSchema.parse(request.body);
      const moveProblem = validateMoveRequest(input.items, movePolicy);
      if (moveProblem) {
        response.status(400).json({ error: 'move_policy', message: moveProblem });
        return;
      }
      const moveItems = await prepareMoveItems(input.items);
      const proposal = await store.createMove({
        moveItems,
        idempotencyKey: input.idempotencyKey,
        note: input.note
      });
      response.status(201).json({
        proposal: publicProposal(proposal),
        appToken: appToken(proposal)
      });
      return;
    }

    const input = CreateProposalSchema.parse(request.body);
    const recipientProblem = validateRecipients(input.message, recipientPolicy);
    if (recipientProblem) {
      response
        .status(400)
        .json({ error: 'recipient_policy', message: recipientProblem });
      return;
    }
    validateSchedule(input.scheduledFor);
    const proposal = await store.create(input);
    response
      .status(201)
      .json({ proposal: publicProposal(proposal), appToken: appToken(proposal) });
  });

  app.get('/api/proposals', async (request, response) => {
    const status = request.query.status
      ? ProposalStatusSchema.parse(request.query.status)
      : undefined;
    const kind = request.query.kind
      ? ProposalKindSchema.parse(request.query.kind)
      : undefined;
    const limit = z.coerce.number().int().min(1).max(100).default(20).parse(request.query.limit);
    const proposals = await store.list(status, limit, kind);
    response.json({ proposals: proposals.map(publicProposal) });
  });

  app.get('/api/proposals/:id', async (request, response) => {
    const id = z.string().uuid().parse(request.params.id);
    const proposal = await store.get(id);
    if (!proposal) {
      response.status(404).json({ error: 'not_found' });
      return;
    }
    response.json({ proposal: publicProposal(proposal) });
  });

  app.post('/api/proposals/:id/cancel', async (request, response) => {
    const id = z.string().uuid().parse(request.params.id);
    const proposal = await store.cancel(id);
    response.json({ proposal: publicProposal(proposal) });
  });

  app.post('/api/proposals/:id/restore', async (request, response) => {
    const id = z.string().uuid().parse(request.params.id);
    const input = RestoreMoveProposalSchema.parse(request.body);
    const original = await store.get(id);
    if (!original) {
      response.status(404).json({ error: 'not_found' });
      return;
    }
    if (original.kind !== 'move') {
      response.status(400).json({
        error: 'not_move',
        message: t.worker.onlyMoveRestorable
      });
      return;
    }

    const reversed = reverseMovedItems(original.moveItems);
    const moveProblem = validateMoveRequest(reversed, movePolicy);
    if (moveProblem) {
      response.status(400).json({ error: 'move_policy', message: moveProblem });
      return;
    }
    const moveItems = await prepareMoveItems(reversed);
    const proposal = await store.createMove({
      moveItems,
      idempotencyKey: input.idempotencyKey,
      note: input.note ?? t.worker.restoreNote(original.id)
    });
    response.status(201).json({
      proposal: publicProposal(proposal),
      appToken: appToken(proposal)
    });
  });

  app.use('/approval', express.urlencoded({ extended: false, limit: '16kb' }));

  app.get('/approval/:id', async (request, response) => {
    const parsed = z.string().uuid().safeParse(request.params.id);
    if (!parsed.success) {
      response
        .status(404)
        .send(renderSimple(t.worker.notFoundTitle, t.worker.proposalNotFound));
      return;
    }
    const proposal = await store.get(parsed.data);
    if (!proposal) {
      response
        .status(404)
        .send(renderSimple(t.worker.notFoundTitle, t.worker.proposalNotFound));
      return;
    }
    response.send(proposal.status === 'pending_approval' ? renderApproval(proposal) : renderStatus(proposal));
  });

  /**
   * The HTML body of a proposal, as its own document, for the sandboxed frame on the approval
   * page. Two properties make showing untrusted markup here acceptable, and both have to hold:
   * the frame carries `sandbox=""`, and this response replaces the site-wide policy with one
   * that permits inline styles and data: images and nothing else. No script runs, and no remote
   * fetch leaves the page — which is also why a tracking pixel cannot report that a message was
   * reviewed. Remote images simply do not load, and the frame says so above it.
   */
  app.get('/approval/:id/preview', async (request, response) => {
    const parsed = z.string().uuid().safeParse(request.params.id);
    const proposal = parsed.success ? await store.get(parsed.data) : null;
    if (!proposal || proposal.kind !== 'send' || !proposal.message.html) {
      response.status(404).type('html').send('');
      return;
    }
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; " +
        "frame-ancestors 'self'; base-uri 'none'; form-action 'none'; sandbox"
    );
    // The site-wide DENY would block the approval page's own frame.
    response.setHeader('X-Frame-Options', 'SAMEORIGIN');
    response.type('html').send(renderPreviewDocument(proposal));
  });

  const approvalLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: t.worker.tooManyAttempts
  });

  app.post('/approval/:id/approve', approvalLimiter, async (request, response) => {
    const parsed = z.string().uuid().safeParse(request.params.id);
    if (!parsed.success) {
      response
        .status(403)
        .send(renderSimple(t.worker.requestRejectedTitle, t.worker.invalidRequest));
      return;
    }
    const proposal = await store.get(parsed.data);
    if (!proposal) {
      response
        .status(404)
        .send(renderSimple(t.worker.notFoundTitle, t.worker.proposalNotFound));
      return;
    }
    const validCsrf = verifyFormSignature(
      request.body?.csrf,
      workerConfig.APPROVAL_CSRF_SECRET,
      proposal.id,
      proposal.createdAt,
      'approve'
    );
    if (!validCsrf) {
      response
        .status(403)
        .send(renderSimple(t.worker.requestRejectedTitle, t.worker.invalidCsrf));
      return;
    }
    if (!secretMatches(request.body?.secret, workerConfig.APPROVAL_SECRET)) {
      response
        .status(401)
        .send(renderApproval(proposal, t.worker.wrongApprovalSecret));
      return;
    }
    const approved = await store.approve(proposal.id);
    response.send(renderStatus(approved));
  });

  app.post('/approval/:id/cancel', approvalLimiter, async (request, response) => {
    const parsed = z.string().uuid().safeParse(request.params.id);
    if (!parsed.success) {
      response
        .status(403)
        .send(renderSimple(t.worker.requestRejectedTitle, t.worker.invalidRequest));
      return;
    }
    const proposal = await store.get(parsed.data);
    if (!proposal) {
      response
        .status(404)
        .send(renderSimple(t.worker.notFoundTitle, t.worker.proposalNotFound));
      return;
    }
    const validCsrf = verifyFormSignature(
      request.body?.csrf,
      workerConfig.APPROVAL_CSRF_SECRET,
      proposal.id,
      proposal.createdAt,
      'cancel'
    );
    if (!validCsrf) {
      response
        .status(403)
        .send(renderSimple(t.worker.requestRejectedTitle, t.worker.invalidCsrf));
      return;
    }
    if (!secretMatches(request.body?.secret, workerConfig.APPROVAL_SECRET)) {
      response
        .status(401)
        .send(renderApproval(proposal, t.worker.wrongApprovalSecret));
      return;
    }
    const cancelled = await store.cancel(proposal.id);
    response.send(renderStatus(cancelled));
  });

  // The in-chat approval app runs in a sandboxed iframe: its requests carry
  // "Origin: null" and no cookies, so these routes authenticate on the
  // capability token alone and never rely on a browser session. Approving still
  // needs the CSRF signature and the human approval secret on top of it.
  const appCors = (
    request: Request,
    response: Response,
    next: NextFunction
  ): void => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.setHeader(
      'Access-Control-Allow-Headers',
      'authorization, content-type'
    );
    response.setHeader('Access-Control-Max-Age', '600');
    if (request.method === 'OPTIONS') {
      response.status(204).end();
      return;
    }
    next();
  };

  // A missing proposal and a bad token answer identically so that these
  // Access-exempt routes cannot be used to probe which proposals exist.
  const proposalForApp = async (
    request: Request,
    response: Response
  ): Promise<Awaited<ReturnType<ProposalStore['get']>>> => {
    const unauthorized = (): undefined => {
      response.setHeader('WWW-Authenticate', 'Bearer');
      response.status(401).json({ error: 'unauthorized' });
      return undefined;
    };
    const parsed = z.string().uuid().safeParse(request.params.id);
    if (!parsed.success) return unauthorized();
    const proposal = await store.get(parsed.data);
    if (!proposal) return unauthorized();
    const presented = bearerToken(request.header('authorization'));
    const valid = verifyFormSignature(
      presented,
      workerConfig.APPROVAL_CSRF_SECRET,
      proposal.id,
      proposal.createdAt,
      'app'
    );
    return valid ? proposal : unauthorized();
  };

  const appJson = express.json({ limit: '16kb' });

  for (const path of [
    '/approval/:id/app',
    '/approval/:id/app-approve',
    '/approval/:id/app-cancel'
  ]) {
    app.options(path, appCors);
  }

  app.get('/approval/:id/app', appCors, async (request, response) => {
    const proposal = await proposalForApp(request, response);
    if (!proposal) return;
    response.json({ view: approvalView(proposal) });
  });

  for (const action of ['approve', 'cancel'] as const) {
    app.post(
      `/approval/:id/app-${action}`,
      appCors,
      approvalLimiter,
      appJson,
      async (request, response) => {
        const proposal = await proposalForApp(request, response);
        if (!proposal) return;

        const validCsrf = verifyFormSignature(
          request.body?.csrf,
          workerConfig.APPROVAL_CSRF_SECRET,
          proposal.id,
          proposal.createdAt,
          action
        );
        if (!validCsrf) {
          response
            .status(403)
            .json({ error: 'invalid_csrf', message: t.worker.invalidCsrf });
          return;
        }
        if (!secretMatches(request.body?.secret, workerConfig.APPROVAL_SECRET)) {
          response.status(401).json({
            error: 'wrong_secret',
            message: t.worker.wrongApprovalSecret
          });
          return;
        }

        const updated =
          action === 'approve'
            ? await store.approve(proposal.id)
            : await store.cancel(proposal.id);
        response.json({ view: approvalView(updated) });
      }
    );
  }

  app.use(
    (
      error: unknown,
      request: Request,
      response: Response,
      _next: NextFunction
    ) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[mail-worker] ${request.method} ${request.path}: ${message}`);
      if (request.path.startsWith('/api/') || APP_ROUTE.test(request.path)) {
        response.status(400).json({ error: 'request_failed', message });
      } else {
        response
          .status(400)
          .send(renderSimple(t.worker.operationFailedTitle, message));
      }
    }
  );

  const httpServer = app.listen(workerConfig.WORKER_PORT, workerConfig.WORKER_HOST);
  httpServer.once('listening', () => {
    console.error(
      `[mail-worker] API and approval on ${workerConfig.WORKER_HOST}:${workerConfig.WORKER_PORT}`
    );
  });
  httpServer.once('error', (error) => {
    console.error(
      '[mail-worker] cannot start HTTP:',
      error instanceof Error ? error.message : String(error)
    );
    process.exitCode = 1;
  });
  return httpServer;
}
