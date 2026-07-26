import { z } from 'zod';
import {
  assertEncryptedTransport,
  boolish,
  csv,
  optional,
  parseEnvironment,
  readSecret
} from '../common/env.js';

const ReaderEnvironmentSchema = z.object({
  IMAP_HOST: z.string().min(1),
  IMAP_PORT: z.coerce.number().int().positive().default(993),
  IMAP_SECURE: boolish.default('true'),
  IMAP_USER: z.string().min(1),
  ALLOW_INSECURE_MAIL_TRANSPORT: boolish.default('false'),
  MAILBOX_ALLOWLIST: csv.default('INBOX'),
  MAX_SEARCH_RESULTS: z.coerce.number().int().min(1).max(250).default(100),
  MAX_MESSAGE_BYTES: z.coerce.number().int().min(64_000).max(50_000_000).default(5_000_000),
  CHARACTER_LIMIT: z.coerce.number().int().min(1_000).max(200_000).default(30_000),
  IMAP_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(15_000),
  IMAP_SOCKET_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(600_000).default(60_000),
  MCP_HOST: z.string().default('0.0.0.0'),
  MCP_PORT: z.coerce.number().int().positive().default(3333),
  MCP_ALLOWED_HOSTS: csv.default('localhost,127.0.0.1'),
  CLOUDFLARE_ACCESS_TEAM_DOMAIN: optional(z.string().url()),
  CLOUDFLARE_ACCESS_AUD: optional(z.string().min(1)),
  CLOUDFLARE_ACCESS_EMAILS: csv.default('')
}).refine(
  (value) => {
    const configured = [
      Boolean(value.CLOUDFLARE_ACCESS_TEAM_DOMAIN),
      Boolean(value.CLOUDFLARE_ACCESS_AUD),
      value.CLOUDFLARE_ACCESS_EMAILS.length > 0
    ];
    return configured.every(Boolean) || configured.every((item) => !item);
  },
  {
    message:
      'CLOUDFLARE_ACCESS_TEAM_DOMAIN, CLOUDFLARE_ACCESS_AUD and CLOUDFLARE_ACCESS_EMAILS must be configured together or omitted.'
  }
);

const environment = parseEnvironment(ReaderEnvironmentSchema);
assertEncryptedTransport(
  'IMAP',
  environment.IMAP_SECURE,
  environment.ALLOW_INSECURE_MAIL_TRANSPORT
);

export const readerConfig = {
  ...environment,
  MAILBOX_ALLOWLIST: [...new Set(environment.MAILBOX_ALLOWLIST)],
  MCP_ALLOWED_HOSTS: [...new Set(environment.MCP_ALLOWED_HOSTS)],
  CLOUDFLARE_ACCESS:
    environment.CLOUDFLARE_ACCESS_TEAM_DOMAIN && environment.CLOUDFLARE_ACCESS_AUD
      ? {
          teamDomain: environment.CLOUDFLARE_ACCESS_TEAM_DOMAIN,
          audience: environment.CLOUDFLARE_ACCESS_AUD,
          allowedEmails: [...new Set(environment.CLOUDFLARE_ACCESS_EMAILS)]
        }
      : undefined,
  IMAP_PASSWORD: readSecret('IMAP_PASSWORD'),
  MCP_TOKEN: readSecret('MCP_TOKEN', 32)
};
