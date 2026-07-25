import { randomUUID } from 'node:crypto';
import nodemailer, { type Transporter } from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import type Mail from 'nodemailer/lib/mailer/index.js';
import type { OutgoingMessage } from '../common/types.js';
import { t } from '../common/i18n.js';
import { workerConfig } from './config.js';

function fromValue(): Mail.Address {
  return {
    name: workerConfig.FROM_NAME,
    address: workerConfig.FROM_ADDRESS
  };
}

function messageId(): string {
  const domain = workerConfig.FROM_ADDRESS.split('@')[1] ?? 'localhost';
  return `<${randomUUID()}@${domain}>`;
}

function mailOptions(message: OutgoingMessage): Mail.Options {
  return {
    from: fromValue(),
    to: message.to,
    cc: message.cc?.length ? message.cc : undefined,
    bcc: message.bcc?.length ? message.bcc : undefined,
    subject: message.subject,
    text: message.text,
    inReplyTo: message.inReplyTo,
    references: message.references?.length ? message.references : undefined,
    date: new Date(),
    messageId: messageId(),
    disableFileAccess: true,
    disableUrlAccess: true
  };
}

export function buildRaw(message: OutgoingMessage): Promise<Buffer> {
  const composer = new MailComposer(mailOptions(message));
  return new Promise((resolve, reject) => {
    composer.compile().build((error: Error | null, raw: Buffer) => {
      if (error) reject(error);
      else resolve(raw);
    });
  });
}

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: workerConfig.SMTP_HOST,
      port: workerConfig.SMTP_PORT,
      secure: workerConfig.SMTP_SECURE,
      auth: {
        user: workerConfig.SMTP_USER,
        pass: workerConfig.SMTP_PASSWORD
      },
      connectionTimeout: workerConfig.SMTP_CONNECTION_TIMEOUT_MS,
      greetingTimeout: workerConfig.SMTP_CONNECTION_TIMEOUT_MS,
      socketTimeout: workerConfig.SMTP_SOCKET_TIMEOUT_MS,
      disableFileAccess: true,
      disableUrlAccess: true
    });
  }
  return transporter;
}

export async function deliver(
  message: OutgoingMessage
): Promise<{ raw: Buffer; messageId: string }> {
  const raw = await buildRaw(message);
  const recipients = [...message.to, ...(message.cc ?? []), ...(message.bcc ?? [])];
  let info: Awaited<ReturnType<Transporter['sendMail']>>;
  try {
    info = await getTransporter().sendMail({
      envelope: {
        from: workerConfig.FROM_ADDRESS,
        to: recipients
      },
      raw,
      disableFileAccess: true,
      disableUrlAccess: true
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new DeliveryError(t.worker.smtpError(reason), true);
  }
  return { raw, messageId: info.messageId };
}

export class DeliveryError extends Error {
  readonly deliveryMayHaveOccurred: boolean;

  constructor(message: string, deliveryMayHaveOccurred: boolean) {
    super(message);
    this.name = 'DeliveryError';
    this.deliveryMayHaveOccurred = deliveryMayHaveOccurred;
  }
}

export async function verifySmtp(): Promise<void> {
  await getTransporter().verify();
}

export function closeSmtp(): void {
  transporter?.close();
  transporter = null;
}
