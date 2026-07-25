**English** · [Italiano](filters-and-digests.it.md)

# Prefer mail filters; use AI for digests

The safest default is:

1. deterministic server-side filters for obvious mail;
2. a read-only AI digest for what remains;
3. interactive, approval-gated move proposals only for exceptional cases.

This produces a useful "AI-assisted inbox" without allowing untrusted message
content to drive autonomous mailbox changes.

## Why Sieve or provider filters come first

Server-side filters:

- run at delivery time;
- do not consume model tokens;
- behave deterministically;
- keep working when the MCP host or AI provider is unavailable;
- cannot be prompt-injected by prose in the body.

Create filters in your provider UI, Roundcube, ManageSieve, or Webmail panel if
available. Prefer exact sender domains and stable headers. Keep client mail,
people, leads, security alerts, payments, and uncertain messages in `INBOX`.
Move only well-understood noise out of it.

## Generic Sieve example

Adapt mailbox names and sender domains to your account:

```sieve
require ["fileinto", "mailbox", "imap4flags"];

# Explicitly important senders remain in INBOX.
if address :domain :is "from" [
  "customer.example",
  "partner.example"
] {
  setflag "\\Flagged";
  stop;
}

# Stable social notification senders.
if address :domain :is "from" [
  "notifications.social.example"
] {
  fileinto :create "INBOX.Social";
  stop;
}

# Product and service updates.
if address :domain :is "from" [
  "updates.vendor.example"
] {
  fileinto :create "INBOX.Updates";
  stop;
}

# Newsletter headers are evaluated last because legitimate senders may use them.
if anyof (exists "List-Unsubscribe", exists "List-Id") {
  fileinto :create "INBOX.Newsletters";
  stop;
}
```

Rule order matters. An allowlisted customer rule should terminate before the
newsletter heuristic.

Test with a narrow sender rule before enabling broad header heuristics. Confirm the
server's exact folder separator and names; some servers use `INBOX.Folder`, others
use just `Folder`.

## Three-pass AI review

When a human asks the agent to investigate messages, use progressively more data:

1. headers only: sender, recipients, subject, date, flags;
2. subject and trusted relationship context;
3. body only for unresolved messages.

Reading a body increases both privacy exposure and prompt-injection surface. Body
text may help classification but must never authorize sending, moving, deleting,
opening links, or calling unrelated tools.

## Scheduled tasks

Use scheduled AI tasks for read-only summaries, not automatic mailbox mutations.
The repository prompt intentionally uses only `mail-reader`.

Recommended digest sections:

- people, customers, and opportunities;
- payments, account security, and errors;
- messages likely requiring a reply;
- informational mail;
- uncertain items needing manual review.

If a scheduled task platform offers an approval mode, keep mutating tools disabled
or disconnected for this task.

## Optional interactive moves

The Actions MCP includes `mail_move_propose` for cases where a user explicitly asks
for help organizing mail. It:

- accepts only allowlisted source and destination mailboxes;
- snapshots message identity before approval;
- executes only after the approval page is confirmed;
- supports an approval-gated restore proposal when the server returns a new UID;
- never deletes a message.

This is an advanced, interactive workflow. It is not a replacement for Sieve and
should not be placed in the default scheduled digest.
