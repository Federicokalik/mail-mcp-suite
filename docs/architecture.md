**English** · [Italiano](architecture.it.md)

# Architecture and trust boundaries

Mail MCP Suite separates reading, proposing actions, and executing actions into
different processes. The separation is intentional: an LLM that can read hostile
email content should not automatically inherit SMTP or IMAP write credentials.

## Components

```text
MCP client
   |
   +-- mail-reader /mcp ----------------------> IMAP (read-only)
   |
   +-- mail-actions /mcp
            |
            +-- actions-proxy (edge auth)
                    |
                    +-- actions (no mail credentials)
                            |
                            +-- internal queue API
                                    |
                                    +-- worker
                                         +-- approval UI
                                         +-- persistent outbox
                                         +-- SMTP delivery
                                         +-- approved IMAP MOVE
```

### Reader

The Reader exposes three tools:

- `mail_list_mailboxes`
- `mail_search`
- `mail_get_message`

It opens selected mailboxes in read-only mode, does not mark messages as read,
returns attachment metadata but not attachment contents, and refuses access to
mailboxes outside `MAILBOX_ALLOWLIST`.

The Reader owns only:

- an IMAP credential;
- its MCP bearer token;
- optional Cloudflare Access validation settings.

### Actions and actions proxy

The Actions MCP exposes proposal and status tools for sending, scheduling, moving,
restoring, and cancelling. It cannot connect to IMAP or SMTP. It submits proposals
to the Worker through an internal Docker network and a separate queue API token.

The proxy is the only Actions component exposed on port `3334`. It accepts either:

- the static Actions bearer token; or
- a valid Cloudflare Access assertion, when Access validation is configured.

After validating a Cloudflare assertion, the proxy replaces it with the internal
Actions bearer token. The Actions container remains on the internal `control`
network and has no direct external network.

### Worker

The Worker is not an MCP server. It owns the credentials required to execute
approved operations:

- SMTP credentials;
- IMAP credentials used for moves and optional Sent copies;
- the queue API token;
- the human approval secret;
- the CSRF signing secret.

It stores proposals in `/data/outbox.json`, backed by a Docker volume. The file is
written atomically and uses mode `0600`. Message bodies and recipients are stored
in clear text inside that volume, so Docker daemon access and backups are part of
the security boundary.

## Send state machine

```text
pending_approval
      |
      +-- reject/expire --> cancelled | expired
      |
      +-- approve now --> approved --> sending --> sent | failed | uncertain
      |
      +-- approve later -> scheduled -> sending --> sent | failed | uncertain
```

Before SMTP delivery, the Worker persists `sending`. If the process stops during
delivery, the proposal becomes `uncertain` after restart. It is not retried
automatically because the remote SMTP server might already have accepted it.

## Move state machine

A move proposal contains immutable snapshots of the source mailbox, UID,
Message-ID or fallback headers, destination, and original flags. At execution time
the Worker fetches the message again and verifies its identity before issuing
`IMAP MOVE`.

Destinations and sources are both allowlisted. There is no delete or Trash tool.
Automatic restoration is offered only when the IMAP server returns a destination
UID. Restoration creates another approval-gated proposal.

## Authentication layers

Local and intranet clients can use random bearer tokens. For Internet access, the
recommended path adds Cloudflare Tunnel and three separate Access applications:

- Reader MCP;
- Actions MCP;
- browser approval page.

The Reader and Actions proxy validate the Access JWT signature, issuer, audience,
and allowed email address at the origin. Cloudflare Access remains the first
authorization layer. The approval page additionally requires the human approval
secret and an action-bound, proposal-bound CSRF signature.

## Threat model

The design assumes:

- every sender, subject, body, attachment name, and link may be malicious;
- an LLM may misclassify content or follow prompt injection;
- a network client may try malformed MCP and HTTP requests;
- SMTP responses may be ambiguous;
- an IMAP UID may refer to a different message after mailbox changes;
- a bearer token or approval URL may leak.

The design does not protect against:

- compromise of the Docker host or daemon;
- compromise of the mail provider account;
- an operator approving a malicious proposal without reviewing it;
- an attacker who has both the approval URL and approval secret;
- plaintext exposure from unencrypted host backups.

See [SECURITY.md](../SECURITY.md) for operational requirements.
