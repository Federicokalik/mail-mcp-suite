import { z } from 'zod';
import { csv, parseEnvironment, readSecret } from '../common/env.js';

const ActionsEnvironmentSchema = z.object({
  WORKER_INTERNAL_URL: z.string().url().default('http://mail-worker:7337'),
  APPROVAL_BASE_URL: z.string().url().default('http://127.0.0.1:7337'),
  WORKER_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(15_000),
  CHARACTER_LIMIT: z.coerce.number().int().min(1_000).max(100_000).default(20_000),
  MCP_HOST: z.string().default('0.0.0.0'),
  MCP_PORT: z.coerce.number().int().positive().default(3334),
  MCP_ALLOWED_HOSTS: csv.default('localhost,127.0.0.1,actions')
});

const environment = parseEnvironment(ActionsEnvironmentSchema);

export const actionsConfig = {
  ...environment,
  MCP_ALLOWED_HOSTS: [...new Set(environment.MCP_ALLOWED_HOSTS)],
  MCP_TOKEN: readSecret('MCP_TOKEN', 32),
  QUEUE_API_TOKEN: readSecret('QUEUE_API_TOKEN', 32)
};
