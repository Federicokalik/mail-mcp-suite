import { z } from 'zod';
import { csv, parseEnvironment, readSecret } from '../common/env.js';

const ActionsEnvironmentSchema = z.object({
  WORKER_INTERNAL_URL: z.string().url().default('http://mail-worker:7337'),
  APPROVAL_BASE_URL: z.string().url().default('http://127.0.0.1:7337'),
  WORKER_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(15_000),
  CHARACTER_LIMIT: z.coerce.number().int().min(1_000).max(100_000).default(20_000),
  // How long a tool call may wait for a URL-mode elicitation to be resolved on
  // clients that cannot render the approval app. 0 disables the wait entirely.
  APPROVAL_WAIT_MS: z.coerce.number().int().min(0).max(600_000).default(120_000),
  MCP_HOST: z.string().default('0.0.0.0'),
  MCP_PORT: z.coerce.number().int().positive().default(3334),
  MCP_ALLOWED_HOSTS: csv.default('localhost,127.0.0.1,actions')
});

const environment = parseEnvironment(ActionsEnvironmentSchema);

export const actionsConfig = {
  ...environment,
  MCP_ALLOWED_HOSTS: [...new Set(environment.MCP_ALLOWED_HOSTS)],
  // Declared to the host as the only origin the approval app may reach, and
  // used by the app itself as the worker base for its fetches.
  APPROVAL_ORIGIN: new URL(environment.APPROVAL_BASE_URL).origin,
  MCP_TOKEN: readSecret('MCP_TOKEN', 32),
  QUEUE_API_TOKEN: readSecret('QUEUE_API_TOKEN', 32)
};
