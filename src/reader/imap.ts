import { ImapFlow, type MailboxLockObject, type SearchObject } from 'imapflow';
import { simpleParser, type ParsedMail } from 'mailparser';
import { t } from '../common/i18n.js';
import { readerConfig } from './config.js';

export type MessageHeader = {
  uid: number;
  mailbox: string;
  subject: string;
  from: string;
  to: string[];
  date: string | null;
  flags: string[];
  seen: boolean;
  hasAttachments: boolean;
  messageId: string | null;
};

export type MessageDetail = MessageHeader & {
  text: string;
  references: string[];
  inReplyTo: string | null;
  cc: string[];
  attachments: Array<{ filename: string; contentType: string; size: number }>;
  untrustedContent: true;
  securityNotice: string;
};

function createClient(): ImapFlow {
  return new ImapFlow({
    host: readerConfig.IMAP_HOST,
    port: readerConfig.IMAP_PORT,
    secure: readerConfig.IMAP_SECURE,
    auth: {
      user: readerConfig.IMAP_USER,
      pass: readerConfig.IMAP_PASSWORD
    },
    connectionTimeout: readerConfig.IMAP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: readerConfig.IMAP_CONNECTION_TIMEOUT_MS,
    socketTimeout: readerConfig.IMAP_SOCKET_TIMEOUT_MS,
    logger: false,
    emitLogs: false
  });
}

async function withClient<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const client = createClient();
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

export function assertMailboxAllowed(mailbox: string): void {
  if (!readerConfig.MAILBOX_ALLOWLIST.includes(mailbox)) {
    throw new Error(
      t.reader.mailboxNotAllowed(
        mailbox,
        readerConfig.MAILBOX_ALLOWLIST.join(', ')
      )
    );
  }
}

async function withReadOnlyMailbox<T>(
  mailbox: string,
  fn: (client: ImapFlow) => Promise<T>
): Promise<T> {
  assertMailboxAllowed(mailbox);
  return withClient(async (client) => {
    let lock: MailboxLockObject | undefined;
    try {
      lock = await client.getMailboxLock(mailbox, { readOnly: true });
    } catch {
      throw new Error(t.reader.mailboxNotReadable(mailbox));
    }

    try {
      return await fn(client);
    } finally {
      lock.release();
    }
  });
}

function addressList(value: unknown): string[] {
  const parsed = value as
    | { value?: Array<{ address?: string; name?: string }> }
    | Array<{ value?: Array<{ address?: string; name?: string }> }>
    | undefined;
  const lists = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  return lists
    .flatMap((item) => item.value ?? [])
    .map((address) =>
      address.name
        ? `${address.name} <${address.address ?? ''}>`
        : (address.address ?? '')
    )
    .filter(Boolean);
}

function hasAttachments(node: unknown): boolean {
  const part = node as { disposition?: string; childNodes?: unknown[] } | undefined;
  if (!part) return false;
  if (part.disposition?.toLowerCase() === 'attachment') return true;
  return (part.childNodes ?? []).some(hasAttachments);
}

function envelopeAddress(
  address: { name?: string; address?: string } | undefined,
  fallback: string
): string {
  if (!address) return fallback;
  if (address.name) return `${address.name} <${address.address ?? ''}>`;
  return address.address ?? fallback;
}

function stripHtml(html: string | false): string {
  if (!html) return '';
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n');
}

export async function listMailboxes(): Promise<
  Array<{ path: string; specialUse: string | null }>
> {
  return withClient(async (client) => {
    const mailboxes = await client.list();
    return mailboxes
      .filter((mailbox) => readerConfig.MAILBOX_ALLOWLIST.includes(mailbox.path))
      .map((mailbox) => ({
        path: mailbox.path,
        specialUse: mailbox.specialUse ?? null
      }));
  });
}

export async function searchMessages(parameters: {
  mailbox: string;
  criteria: SearchObject;
  limit: number;
}): Promise<MessageHeader[]> {
  const limit = Math.min(parameters.limit, readerConfig.MAX_SEARCH_RESULTS);
  return withReadOnlyMailbox(parameters.mailbox, async (client) => {
    const uids = await client.search(parameters.criteria, { uid: true });
    if (!uids || uids.length === 0) return [];

    const selected = uids.slice(-limit).reverse();
    const messages: MessageHeader[] = [];
    for await (const message of client.fetch(
      selected,
      { uid: true, envelope: true, flags: true, bodyStructure: true },
      { uid: true }
    )) {
      const envelope = message.envelope;
      messages.push({
        uid: message.uid,
        mailbox: parameters.mailbox,
        subject: envelope?.subject ?? t.reader.noSubject,
        from: envelopeAddress(envelope?.from?.[0], t.reader.unknownSender),
        to: (envelope?.to ?? []).map((address) => address.address ?? '').filter(Boolean),
        date: envelope?.date ? new Date(envelope.date).toISOString() : null,
        flags: [...(message.flags ?? [])],
        seen: message.flags?.has('\\Seen') ?? false,
        hasAttachments: hasAttachments(message.bodyStructure),
        messageId: envelope?.messageId ?? null
      });
    }
    messages.sort((left, right) => (right.date ?? '').localeCompare(left.date ?? ''));
    return messages;
  });
}

export async function getMessage(parameters: {
  mailbox: string;
  uid: number;
}): Promise<MessageDetail> {
  return withReadOnlyMailbox(parameters.mailbox, async (client) => {
    const metadata = await client.fetchOne(
      String(parameters.uid),
      { uid: true, size: true, flags: true },
      { uid: true }
    );
    if (!metadata) {
      throw new Error(
        t.reader.messageNotFound(parameters.uid, parameters.mailbox)
      );
    }
    if (typeof metadata.size !== 'number') {
      throw new Error(t.reader.messageSizeUnavailable(parameters.uid));
    }
    if (metadata.size > readerConfig.MAX_MESSAGE_BYTES) {
      throw new Error(
        t.reader.messageTooLarge(metadata.size, readerConfig.MAX_MESSAGE_BYTES)
      );
    }

    const message = await client.fetchOne(
      String(parameters.uid),
      { uid: true, source: true, flags: true },
      { uid: true }
    );
    if (!message || !message.source) {
      throw new Error(t.reader.messageContentUnavailable(parameters.uid));
    }

    const parsed: ParsedMail = await simpleParser(message.source, {
      maxHtmlLengthToParse: readerConfig.MAX_MESSAGE_BYTES
    });
    const text = (parsed.text ?? stripHtml(parsed.html || '')).trim();

    return {
      uid: parameters.uid,
      mailbox: parameters.mailbox,
      subject: parsed.subject ?? t.reader.noSubject,
      from: parsed.from?.text ?? t.reader.unknownSender,
      to: addressList(parsed.to),
      cc: addressList(parsed.cc),
      date: parsed.date ? parsed.date.toISOString() : null,
      flags: [...(message.flags ?? [])],
      seen: message.flags?.has('\\Seen') ?? false,
      hasAttachments: parsed.attachments.length > 0,
      messageId: parsed.messageId ?? null,
      inReplyTo: parsed.inReplyTo ?? null,
      references: Array.isArray(parsed.references)
        ? parsed.references
        : parsed.references
          ? [parsed.references]
          : [],
      text,
      attachments: parsed.attachments.map((attachment) => ({
        filename: attachment.filename ?? t.reader.unnamedAttachment,
        contentType: attachment.contentType,
        size: attachment.size
      })),
      untrustedContent: true,
      securityNotice: t.reader.bodyUntrustedNotice
    };
  });
}
