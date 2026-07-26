import { z } from 'zod';
import {
  type CreateMoveProposal,
  type CreateProposal,
  PublicProposalSchema,
  type ProposalKind,
  type ProposalStatus,
  type PublicProposal
} from '../common/types.js';
import { actionsConfig } from './config.js';

type ErrorPayload = { error?: string; message?: string };

/**
 * A created proposal plus the two handles the in-chat approval app needs: where
 * to reach the worker and the capability token that authenticates it there.
 * Actions never learns the approval secret, so it still cannot approve.
 */
export type CreatedProposal = {
  proposal: PublicProposal;
  approvalUrl: string;
  appToken: string;
};

function created(payload: unknown): CreatedProposal {
  const body = payload as { proposal?: unknown; appToken?: unknown };
  const proposal = PublicProposalSchema.parse(body.proposal);
  return {
    proposal,
    approvalUrl: `${actionsConfig.APPROVAL_BASE_URL}/approval/${proposal.id}`,
    appToken: z.string().min(1).parse(body.appToken)
  };
}

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(new URL(path, actionsConfig.WORKER_INTERNAL_URL), {
    ...init,
    signal: AbortSignal.timeout(actionsConfig.WORKER_REQUEST_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${actionsConfig.QUEUE_API_TOKEN}`,
      'Content-Type': 'application/json',
      ...init.headers
    }
  });

  const payload = (await response.json().catch(() => ({}))) as ErrorPayload;
  if (!response.ok) {
    throw new Error(payload.message ?? payload.error ?? `Worker HTTP ${response.status}`);
  }
  return payload;
}

export async function createProposal(
  input: CreateProposal
): Promise<CreatedProposal> {
  return created(
    await request('/api/proposals', {
      method: 'POST',
      body: JSON.stringify(input)
    })
  );
}

export async function createMoveProposal(
  input: CreateMoveProposal
): Promise<CreatedProposal> {
  return created(
    await request('/api/proposals', {
      method: 'POST',
      body: JSON.stringify(input)
    })
  );
}

export async function listProposals(
  status: ProposalStatus | undefined,
  limit: number,
  kind?: ProposalKind
): Promise<PublicProposal[]> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (status) query.set('status', status);
  if (kind) query.set('kind', kind);
  const payload = (await request(`/api/proposals?${query.toString()}`)) as {
    proposals?: unknown;
  };
  return PublicProposalSchema.array().parse(payload.proposals);
}

export async function getProposal(id: string): Promise<PublicProposal> {
  const payload = (await request(`/api/proposals/${encodeURIComponent(id)}`)) as {
    proposal?: unknown;
  };
  return PublicProposalSchema.parse(payload.proposal);
}

export async function cancelProposal(id: string): Promise<PublicProposal> {
  const payload = (await request(`/api/proposals/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    body: '{}'
  })) as { proposal?: unknown };
  return PublicProposalSchema.parse(payload.proposal);
}

export async function restoreMoveProposal(
  id: string,
  input: { idempotencyKey: string; note: string | null }
): Promise<CreatedProposal> {
  return created(
    await request(`/api/proposals/${encodeURIComponent(id)}/restore`, {
      method: 'POST',
      body: JSON.stringify(input)
    })
  );
}
