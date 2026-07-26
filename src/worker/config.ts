import { z } from 'zod';
import {
  assertEncryptedTransport,
  boolish,
  csv,
  optional,
  parseEnvironment,
  readSecret
} from '../common/env.js';
import { dateLocale, t } from '../common/i18n.js';

const safeText = z
  .string()
  .refine((value) => !/[\r\n]/.test(value), t.validation.crLfNotAllowed);

const WorkerEnvironmentSchema = z.object({
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_SECURE: boolish.default('true'),
  SMTP_USER: z.string().min(1),
  FROM_NAME: safeText.default(''),
  FROM_ADDRESS: z.string().email(),
  ALLOW_INSECURE_MAIL_TRANSPORT: boolish.default('false'),
  SMTP_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(15_000),
  SMTP_SOCKET_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(600_000).default(60_000),

  SAVE_SENT_COPY: boolish.default('false'),
  SENT_IMAP_HOST: optional(z.string().min(1)),
  SENT_IMAP_PORT: z.coerce.number().int().positive().default(993),
  SENT_IMAP_SECURE: boolish.default('true'),
  SENT_IMAP_USER: optional(z.string().min(1)),
  SENT_MAILBOX: z.string().default('Sent'),

  MOVE_IMAP_HOST: optional(z.string().min(1)),
  MOVE_IMAP_PORT: z.coerce.number().int().positive().default(993),
  MOVE_IMAP_SECURE: boolish.default('true'),
  MOVE_IMAP_USER: optional(z.string().min(1)),
  MOVE_SOURCE_ALLOWLIST: csv.default(
    'INBOX,INBOX.Social,INBOX.Newsletters,INBOX.Updates'
  ),
  MOVE_DESTINATION_ALLOWLIST: csv.default(
    'INBOX,INBOX.Social,INBOX.Newsletters,INBOX.Updates'
  ),
  MOVE_MAX_BATCH: z.coerce.number().int().min(1).max(25).default(25),

  OUTBOX_PATH: z.string().default('/data/outbox.json'),
  APPROVAL_TTL_MINUTES: z.coerce.number().int().min(1).max(10_080).default(1_440),
  APPROVAL_TIMEZONE: z.string().default('UTC'),
  MAX_RECIPIENTS: z.coerce.number().int().min(1).max(100).default(10),
  RECIPIENT_DOMAIN_ALLOWLIST: csv.default(''),
  RECIPIENT_DOMAIN_DENYLIST: csv.default(''),
  MAX_SCHEDULE_DAYS: z.coerce.number().int().min(1).max(3_650).default(365),
  MIN_SCHEDULE_LEAD_SECONDS: z.coerce.number().int().min(0).max(86_400).default(60),
  SCHEDULER_INTERVAL_MS: z.coerce.number().int().min(500).max(60_000).default(2_000),

  WORKER_HOST: z.string().default('0.0.0.0'),
  WORKER_PORT: z.coerce.number().int().positive().default(7337),
  WORKER_ALLOWED_HOSTS: csv.default('localhost,127.0.0.1,worker'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(2).default(0)
});

const environment = parseEnvironment(WorkerEnvironmentSchema);
assertEncryptedTransport(
  'SMTP',
  environment.SMTP_SECURE,
  environment.ALLOW_INSECURE_MAIL_TRANSPORT
);

if (environment.SAVE_SENT_COPY) {
  if (!environment.SENT_IMAP_HOST || !environment.SENT_IMAP_USER) {
    throw new Error(
      'SAVE_SENT_COPY=true requires SENT_IMAP_HOST and SENT_IMAP_USER.'
    );
  }
  assertEncryptedTransport(
    'SENT_IMAP',
    environment.SENT_IMAP_SECURE,
    environment.ALLOW_INSECURE_MAIL_TRANSPORT
  );
}

assertEncryptedTransport(
  'MOVE_IMAP',
  environment.MOVE_IMAP_SECURE,
  environment.ALLOW_INSECURE_MAIL_TRANSPORT
);

try {
  new Intl.DateTimeFormat(dateLocale, {
    timeZone: environment.APPROVAL_TIMEZONE
  }).format(new Date());
} catch {
  throw new Error(`Invalid APPROVAL_TIMEZONE: ${environment.APPROVAL_TIMEZONE}`);
}

export const workerConfig = {
  ...environment,
  WORKER_ALLOWED_HOSTS: [...new Set(environment.WORKER_ALLOWED_HOSTS)],
  MOVE_IMAP_HOST: environment.MOVE_IMAP_HOST ?? environment.SMTP_HOST,
  MOVE_IMAP_USER: environment.MOVE_IMAP_USER ?? environment.SMTP_USER,
  MOVE_SOURCE_ALLOWLIST: [...new Set(environment.MOVE_SOURCE_ALLOWLIST)],
  MOVE_DESTINATION_ALLOWLIST: [...new Set(environment.MOVE_DESTINATION_ALLOWLIST)],
  RECIPIENT_DOMAIN_ALLOWLIST: environment.RECIPIENT_DOMAIN_ALLOWLIST.map((item) =>
    item.toLowerCase()
  ),
  RECIPIENT_DOMAIN_DENYLIST: environment.RECIPIENT_DOMAIN_DENYLIST.map((item) =>
    item.toLowerCase()
  ),
  SMTP_PASSWORD: readSecret('SMTP_PASSWORD'),
  SENT_IMAP_PASSWORD: environment.SAVE_SENT_COPY ? readSecret('SENT_IMAP_PASSWORD') : null,
  MOVE_IMAP_PASSWORD: readSecret('MOVE_IMAP_PASSWORD'),
  QUEUE_API_TOKEN: readSecret('QUEUE_API_TOKEN', 32),
  APPROVAL_SECRET: readSecret('APPROVAL_SECRET', 10),
  APPROVAL_CSRF_SECRET: readSecret('APPROVAL_CSRF_SECRET', 32)
};

export const recipientPolicy = {
  maximum: workerConfig.MAX_RECIPIENTS,
  allowlist: workerConfig.RECIPIENT_DOMAIN_ALLOWLIST,
  denylist: workerConfig.RECIPIENT_DOMAIN_DENYLIST
};

export const movePolicy = {
  maximum: workerConfig.MOVE_MAX_BATCH,
  sourceAllowlist: workerConfig.MOVE_SOURCE_ALLOWLIST,
  destinationAllowlist: workerConfig.MOVE_DESTINATION_ALLOWLIST
};
