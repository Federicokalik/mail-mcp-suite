import assert from 'node:assert/strict';
import { test } from 'node:test';

// The worker config is validated at import time and reads its secrets from the environment,
// so it has to be populated before src/worker/smtp.ts is pulled in.
process.env.SMTP_HOST = 'smtp.example.com';
process.env.SMTP_USER = 'sender@example.com';
process.env.FROM_ADDRESS = 'sender@example.com';
process.env.FROM_NAME = 'Test Sender';
process.env.SMTP_PASSWORD = 'smtp-password';
process.env.MOVE_IMAP_PASSWORD = 'imap-password';
process.env.QUEUE_API_TOKEN = 'q'.repeat(32);
process.env.APPROVAL_SECRET = 'a'.repeat(16);
process.env.APPROVAL_CSRF_SECRET = 'c'.repeat(32);

const { buildRaw } = await import('../src/worker/smtp.js');

const base = {
  to: ['recipient@example.com'],
  subject: 'Subject',
  text: 'Plain text fallback'
};

test('a text-only message stays a single part', async () => {
  const raw = (await buildRaw(base)).toString('utf8');
  assert.equal(raw.includes('multipart/alternative'), false);
  assert.match(raw, /Content-Type: text\/plain/i);
  assert.equal(/Content-Type: text\/html/i.test(raw), false);
});

test('an html message is delivered as multipart/alternative with both parts', async () => {
  const raw = (
    await buildRaw({ ...base, html: '<p>Rendered body</p>' })
  ).toString('utf8');
  assert.match(raw, /Content-Type: multipart\/alternative/i);
  assert.match(raw, /Content-Type: text\/plain/i);
  assert.match(raw, /Content-Type: text\/html/i);
});

test('the raw buffer is built once and carries the envelope headers', async () => {
  const raw = (
    await buildRaw({ ...base, html: '<p>Rendered body</p>' })
  ).toString('utf8');
  // The Sent copy reuses this exact buffer, so what is archived is what was delivered.
  assert.match(raw, /^To: recipient@example\.com$/m);
  assert.match(raw, /^Subject: Subject$/m);
  assert.match(raw, /^Message-ID: <.+@example\.com>$/m);
});
