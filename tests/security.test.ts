import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bearerToken,
  escapeHtml,
  hostAllowed,
  secretMatches,
  signForm,
  verifyFormSignature
} from '../src/common/security.js';

test('secret comparison and Bearer parsing are strict', () => {
  const secret = 'a'.repeat(32);
  assert.equal(secretMatches(secret, secret), true);
  assert.equal(secretMatches(`${secret}x`, secret), false);
  assert.equal(secretMatches(undefined, secret), false);
  assert.equal(bearerToken(`Bearer ${secret}`), secret);
  assert.equal(bearerToken(`bearer ${secret}`), null);
  assert.equal(bearerToken('Bearer '), null);
});

test('CSRF signature is bound to proposal, date and action', () => {
  const secret = 'csrf-secret-'.repeat(4);
  const id = '2478a6a1-23ca-4f97-bfa7-74e9d50efca0';
  const createdAt = '2026-07-25T12:00:00.000Z';
  const signature = signForm(secret, id, createdAt, 'approve');

  assert.equal(
    verifyFormSignature(signature, secret, id, createdAt, 'approve'),
    true
  );
  assert.equal(
    verifyFormSignature(signature, secret, id, createdAt, 'cancel'),
    false
  );
});

test('HTML escaping protects the fields shown on the confirmation page', () => {
  assert.equal(
    escapeHtml(`<script>alert("x")</script>'&`),
    '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&#39;&amp;'
  );
});

test('Host allowlist ignores the port and rejects malformed hosts', () => {
  const allowed = ['localhost', '127.0.0.1', 'mail-reader.example.com'];
  assert.equal(hostAllowed('localhost:3333', allowed), true);
  assert.equal(hostAllowed('MAIL-READER.EXAMPLE.COM', allowed), true);
  assert.equal(hostAllowed('mail-reader.example.com.', allowed), true);
  assert.equal(hostAllowed('attacker.example', allowed), false);
  assert.equal(hostAllowed('mail-reader.example.com@attacker.example', allowed), false);
  assert.equal(hostAllowed(undefined, allowed), false);
});
