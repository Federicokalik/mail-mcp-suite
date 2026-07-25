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
  verifyFormSignature
} from '../common/security.js';
import { t } from '../common/i18n.js';
import { movePolicy, recipientPolicy, workerConfig } from './config.js';
import { prepareMoveItems, reverseMovedItems } from './imap-move.js';
import { renderApproval, renderSimple, renderStatus } from './approval-ui.js';
import type { ProposalStore } from './store.js';

function securityHeaders(_request: Request, response: Response, next: NextFunction): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
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

  app.use('/api', apiAuthentication, express.json({ limit: '1mb' }));

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
      response.status(201).json({ proposal: publicProposal(proposal) });
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
    response.status(201).json({ proposal: publicProposal(proposal) });
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
    response.status(201).json({ proposal: publicProposal(proposal) });
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

  app.use(
    (
      error: unknown,
      request: Request,
      response: Response,
      _next: NextFunction
    ) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[mail-worker] ${request.method} ${request.path}: ${message}`);
      if (request.path.startsWith('/api/')) {
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
