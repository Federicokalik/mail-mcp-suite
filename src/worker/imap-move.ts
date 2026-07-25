import { ImapFlow, type FetchMessageObject } from 'imapflow';
import type { MoveItem, MoveRequestItem } from '../common/types.js';
import { t } from '../common/i18n.js';
import { workerConfig } from './config.js';

function createClient(): ImapFlow {
  return new ImapFlow({
    host: workerConfig.MOVE_IMAP_HOST,
    port: workerConfig.MOVE_IMAP_PORT,
    secure: workerConfig.MOVE_IMAP_SECURE,
    auth: {
      user: workerConfig.MOVE_IMAP_USER,
      pass: workerConfig.MOVE_IMAP_PASSWORD
    },
    connectionTimeout: workerConfig.SMTP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: workerConfig.SMTP_CONNECTION_TIMEOUT_MS,
    socketTimeout: workerConfig.SMTP_SOCKET_TIMEOUT_MS,
    logger: false,
    emitLogs: false
  });
}

function envelopeAddress(
  address: { name?: string; address?: string } | undefined,
  fallback: string
): string {
  if (!address) return fallback;
  if (address.name) return `${address.name} <${address.address ?? ''}>`;
  return address.address ?? fallback;
}

function snapshot(
  message: FetchMessageObject,
  request: MoveRequestItem
): MoveItem {
  const envelope = message.envelope;
  return {
    ...request,
    messageId: envelope?.messageId ?? null,
    subject: envelope?.subject ?? t.reader.noSubject,
    from: envelopeAddress(envelope?.from?.[0], t.reader.unknownSender),
    date: envelope?.date ? new Date(envelope.date).toISOString() : null,
    flags: [...(message.flags ?? [])],
    result: {
      status: 'pending',
      destinationUid: null,
      error: null
    }
  };
}

function assertIdentity(message: FetchMessageObject, expected: MoveItem): void {
  const current = snapshot(message, expected);
  if (expected.messageId && current.messageId !== expected.messageId) {
    throw new Error(t.worker.move.messageIdChanged(expected.uid));
  }
  if (
    !expected.messageId &&
    (current.subject !== expected.subject ||
      current.from !== expected.from ||
      current.date !== expected.date)
  ) {
    throw new Error(t.worker.move.headersChanged(expected.uid));
  }
}

async function verifyMailboxes(
  client: ImapFlow,
  requests: MoveRequestItem[]
): Promise<void> {
  const available = new Set((await client.list()).map((mailbox) => mailbox.path));
  for (const request of requests) {
    if (!available.has(request.sourceMailbox)) {
      throw new Error(
        t.worker.move.sourceMailboxNotFound(request.sourceMailbox)
      );
    }
    if (!available.has(request.destinationMailbox)) {
      throw new Error(
        t.worker.move.destinationMailboxNotFound(request.destinationMailbox)
      );
    }
  }
}

export async function prepareMoveItems(
  requests: MoveRequestItem[]
): Promise<MoveItem[]> {
  const client = createClient();
  await client.connect();
  try {
    await verifyMailboxes(client, requests);
    const items: MoveItem[] = [];
    for (const request of requests) {
      const lock = await client.getMailboxLock(request.sourceMailbox, {
        readOnly: true
      });
      try {
        const message = await client.fetchOne(
          String(request.uid),
          { uid: true, envelope: true, flags: true },
          { uid: true }
        );
        if (!message) {
          throw new Error(
            t.worker.move.messageNotFound(request.uid, request.sourceMailbox)
          );
        }
        items.push(snapshot(message, request));
      } finally {
        lock.release();
      }
    }
    return items;
  } finally {
    await client.logout().catch(() => client.close());
  }
}

function failed(item: MoveItem, error: unknown): MoveItem {
  const reason = error instanceof Error ? error.message : String(error);
  return {
    ...item,
    result: {
      status: 'failed',
      destinationUid: null,
      error: reason.slice(0, 2_000)
    }
  };
}

function uncertain(item: MoveItem, error: unknown): MoveItem {
  const reason = error instanceof Error ? error.message : String(error);
  return {
    ...item,
    result: {
      status: 'uncertain',
      destinationUid: null,
      error: `${reason}. ${t.worker.move.verifyBeforeRetry}`.slice(0, 2_000)
    }
  };
}

export async function executeMoveItems(items: MoveItem[]): Promise<MoveItem[]> {
  const client = createClient();
  await client.connect();
  try {
    await verifyMailboxes(client, items);
    const results: MoveItem[] = [];
    for (const item of items) {
      let lock;
      try {
        lock = await client.getMailboxLock(item.sourceMailbox);
        const message = await client.fetchOne(
          String(item.uid),
          { uid: true, envelope: true, flags: true },
          { uid: true }
        );
        if (!message) {
          results.push(
            failed(
              item,
              new Error(
                t.worker.move.messageGone(item.uid, item.sourceMailbox)
              )
            )
          );
          continue;
        }
        try {
          assertIdentity(message, item);
        } catch (error) {
          results.push(failed(item, error));
          continue;
        }

        try {
          const response = await client.messageMove(
            String(item.uid),
            item.destinationMailbox,
            { uid: true }
          );
          if (!response) {
            results.push(
              uncertain(item, new Error(t.worker.move.notConfirmed))
            );
            continue;
          }
          results.push({
            ...item,
            result: {
              status: 'moved',
              destinationUid: response.uidMap?.get(item.uid) ?? null,
              error: response.uidMap?.has(item.uid)
                ? null
                : t.worker.move.movedWithoutNewUid
            }
          });
        } catch (error) {
          results.push(uncertain(item, error));
        }
      } catch (error) {
        results.push(failed(item, error));
      } finally {
        lock?.release();
      }
    }
    return results;
  } finally {
    await client.logout().catch(() => client.close());
  }
}

export function reverseMovedItems(proposalItems: MoveItem[]): MoveRequestItem[] {
  const reversed: MoveRequestItem[] = [];
  for (const item of proposalItems) {
    if (item.result.status !== 'moved') continue;
    if (!item.result.destinationUid) {
      throw new Error(t.worker.move.restoreUnsafe(item.uid));
    }
    reversed.push({
      sourceMailbox: item.destinationMailbox,
      uid: item.result.destinationUid,
      destinationMailbox: item.sourceMailbox
    });
  }
  if (reversed.length === 0) {
    throw new Error(t.worker.move.nothingRestorable);
  }
  return reversed;
}
