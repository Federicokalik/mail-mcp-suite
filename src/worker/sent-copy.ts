import { ImapFlow } from 'imapflow';
import { t } from '../common/i18n.js';
import { workerConfig } from './config.js';

export async function appendSentCopy(raw: Buffer): Promise<void> {
  if (!workerConfig.SAVE_SENT_COPY) return;
  if (
    !workerConfig.SENT_IMAP_HOST ||
    !workerConfig.SENT_IMAP_USER ||
    !workerConfig.SENT_IMAP_PASSWORD
  ) {
    throw new Error(t.worker.sentCopyConfigIncomplete);
  }

  const client = new ImapFlow({
    host: workerConfig.SENT_IMAP_HOST,
    port: workerConfig.SENT_IMAP_PORT,
    secure: workerConfig.SENT_IMAP_SECURE,
    auth: {
      user: workerConfig.SENT_IMAP_USER,
      pass: workerConfig.SENT_IMAP_PASSWORD
    },
    connectionTimeout: workerConfig.SMTP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: workerConfig.SMTP_CONNECTION_TIMEOUT_MS,
    socketTimeout: workerConfig.SMTP_SOCKET_TIMEOUT_MS,
    logger: false,
    emitLogs: false
  });

  await client.connect();
  try {
    await client.append(workerConfig.SENT_MAILBOX, raw, ['\\Seen'], new Date());
  } finally {
    await client.logout().catch(() => client.close());
  }
}
