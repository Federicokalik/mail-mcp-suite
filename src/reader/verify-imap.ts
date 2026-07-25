#!/usr/bin/env node
import { listMailboxes } from './imap.js';

const mailboxes = await listMailboxes();
console.log(
  JSON.stringify(
    {
      status: 'ok',
      service: 'imap',
      authorizedMailboxes: mailboxes
    },
    null,
    2
  )
);
