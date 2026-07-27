**English** · [Italiano](README.it.md)

# Mail MCP Suite

A self-hosted, security-focused mail bridge for MCP clients. It combines a strict
read-only IMAP server with approval-gated sending, scheduling, and IMAP moves.

The suite is Docker-first and exposes two independent Streamable HTTP MCP
endpoints:

- **Mail Reader** — search and read allowlisted mailboxes without changing flags;
- **Mail Actions** — create proposals for sends, schedules, moves, restores, and
  cancellations;
- **Mail Worker** — a non-MCP service that persists proposals and executes them
  only after a human confirms them.

Confirmation happens in the chat itself on hosts that support MCP Apps — Claude
web and Desktop, ChatGPT, Cursor, VS Code Copilot — and on the browser approval
page everywhere else. Both read the proposal from the Worker and require the
same human approval secret. See [docs/clients.md](docs/clients.md).

## Choose the smallest tool that fits

This suite is useful when you specifically need both reading and actions, remote
MCP access, persistent scheduling, and a hard approval boundary.

For simpler use cases, prefer a smaller existing project:

- [nikolausm/imap-mcp-server](https://github.com/nikolausm/imap-mcp-server) for
  a broad single-server IMAP workflow;
- [samihalawa/mcp-server-smtp](https://github.com/samihalawa/mcp-server-smtp)
  as an SMTP-oriented conceptual reference. Its repository did not declare a
  license when this documentation was written, so review its terms before reuse.

For inbox organization, prefer deterministic Sieve, ManageSieve, provider, or
Roundcube filters. Use a scheduled LLM task for a read-only digest. AI-driven
moves are available only as an advanced, interactive, approval-gated workflow.

See [Acknowledgements and prior art](ACKNOWLEDGEMENTS.md).

## Security properties

- The Reader opens mailboxes read-only and exposes no write tool.
- Mailbox access is restricted by an exact allowlist.
- The Actions MCP has no IMAP or SMTP credentials.
- The Worker is not an MCP server.
- Every send, schedule, move, and restore starts in `pending_approval`.
- Approval requires a human review of the stored proposal, an independent human
  secret, and a signed CSRF field.
- No MCP tool can approve a proposal, in chat or otherwise; the message body and
  the approval secret never pass through the LLM host.
- The Worker does not retry ambiguous SMTP deliveries or IMAP moves.
- There is no delete or Trash tool.
- Compose binds to `127.0.0.1` by default.
- Reader and Actions use separate bearer tokens and can use separate Cloudflare
  Access applications.
- Email fields are explicitly marked as untrusted content for the agent.

These controls reduce risk; they do not make an LLM a trusted mail operator. Read
[SECURITY.md](SECURITY.md) before connecting a real mailbox.

## Components and ports

| Component | Default endpoint | Credentials held |
|---|---|---|
| Reader | `http://127.0.0.1:3333/mcp` | IMAP, Reader MCP token |
| Actions proxy | `http://127.0.0.1:3334/mcp` | Actions MCP token |
| Actions core | internal Docker network | queue API token, Actions MCP token |
| Worker and approval UI | `http://127.0.0.1:7337` | SMTP, move IMAP, queue, approval secrets |

The architecture is documented in [docs/architecture.md](docs/architecture.md).
Every environment variable is documented in
[docs/configuration.md](docs/configuration.md).

## Quick start

Requirements: Docker Compose v2 and a mail account offering IMAP and SMTP over
TLS. Node.js is needed only to build from source or run the checks locally.

The whole stack is configured by one file. Passwords are not in it: they are
Docker secrets, mounted only into the services that need them.

**1. Configuration.** Copy the example and edit it — mail hostnames, user,
sender, mailbox names, and `APPROVAL_TIMEZONE`:

```sh
cp config/mail-mcp.env.example .env
mkdir -p local-config/secrets
chmod 600 .env
chmod 700 local-config local-config/secrets
```

**2. Secrets.** Create the seven files listed in
[secrets/README.md](secrets/README.md), one value per file. Generate each machine
token independently, and use a separate human passphrase for `approval_secret`:

```sh
openssl rand -hex 32
```

**3. Start.** Point `MAIL_MCP_IMAGE` in `.env` at a published image:

```dotenv
MAIL_MCP_IMAGE=ghcr.io/federicokalik/mail-mcp-suite:3.1.0
```

```sh
docker compose config
docker compose pull
docker compose up -d
```

To build from source instead, add the build override:

```sh
npm ci --ignore-scripts && npm run check
docker compose -f compose.yaml -f compose.build.yaml build
docker compose up -d
```

**4. Check.**

```sh
curl --fail http://127.0.0.1:3333/healthz
curl --fail http://127.0.0.1:3334/healthz
curl --fail http://127.0.0.1:7337/healthz
```

Follow [docs/installation.md](docs/installation.md) for permissions, credential
verification, LAN binding, backups, and uninstall.

## MCP tools

### Reader

| Tool | Effect |
|---|---|
| `mail_list_mailboxes` | List only configured mailboxes |
| `mail_search` | Search and return headers |
| `mail_get_message` | Read one body without marking it seen |

### Actions

| Tool | Effect |
|---|---|
| `mail_send` | Create an immediate send proposal |
| `mail_schedule` | Create a scheduled send proposal |
| `mail_delivery_list` / `mail_delivery_get` | Inspect send metadata and status |
| `mail_delivery_cancel` | Cancel a proposal that has not been claimed |
| `mail_move_propose` | Create an approval-gated IMAP move proposal |
| `mail_move_list` / `mail_move_get` | Inspect move metadata and status |
| `mail_move_cancel` | Cancel a move proposal that has not been claimed |
| `mail_move_restore` | Propose an approval-gated reversal |

Actions returns an approval URL. The operation does not become active until the
user reviews the page and enters the approval secret.

## HTML messages

`mail_send` and `mail_schedule` accept an optional body beyond `text`:

| Field | Effect |
|---|---|
| `html` | HTML body, sent with `text` as `multipart/alternative` |
| `mjml` | MJML template, compiled to HTML by Actions; mutually exclusive with `html` |

`text` stays mandatory. It is the part a person can read without a renderer, it
is what the approval page shows first, and it keeps the delivered message a
proper `multipart/alternative`.

MJML is compiled once, when the proposal is created, and only the resulting HTML
is stored. The message reviewed at approval time and the message handed to SMTP
are therefore the same bytes. Compilation runs inside Actions, which holds no
SMTP, IMAP or approval credentials — the Worker never parses a template.
`mj-include` is refused, so a template cannot pull files off the server.

The approval page renders the HTML inside a frame that carries `sandbox=""` and
a policy allowing inline styles and `data:` images only. No script runs and no
remote resource loads, so a tracking pixel cannot report that a message was
reviewed. Layout gaps where remote images would be are expected, and the frame
says so.

[`skills/framix-email-html-mjml`](skills/README.md) ships an MJML authoring
skill for composing these templates.

## Remote access and Claude

Do not expose the HTTP ports directly to the Internet. The recommended setup uses
three Cloudflare Tunnel hostnames, three default-deny Access applications, and
Managed OAuth for the two MCP endpoints:

- [Cloudflare Tunnel and Access guide](docs/cloudflare.md)
- [Claude and other MCP clients](docs/clients.md)

Cloudflare's official API MCP server can inspect and configure Cloudflare resources
through OAuth. The guide includes a least-privilege prompt and a validation plan.

## Filters and scheduled digests

[docs/filters-and-digests.md](docs/filters-and-digests.md) explains the recommended
order:

1. deterministic server-side filters;
2. a read-only scheduled digest;
3. optional interactive move proposals.

Digest-only Claude Cowork prompts are provided in
[English](config/claude-daily-digest-prompt.en.md) and
[Italian](config/claude-daily-digest-prompt.it.md). They connect only to
`mail-reader` and perform no mailbox mutations.

## Development

```sh
npm ci --ignore-scripts
npm run check
npm run smoke
```

`npm run smoke` starts temporary loopback processes and never connects to a real
mail server or sends mail.

See [CONTRIBUTING.md](CONTRIBUTING.md) before submitting changes.

## Limitations

- One mail identity per deployment.
- Message bodies and recipients are stored unencrypted in the outbox volume.
- No attachment download tool.
- An HTML body is never rendered in the in-chat approval app; reviewing it
  faithfully means opening the approval page in a browser.
- No automatic retry after ambiguous delivery or move outcomes.
- No deletion, Trash, spam classification, or autonomous sorting.
- Sent-folder copies are optional because SMTP acceptance and IMAP append are
  separate operations.

## License

Copyright holders license this project under the
[GNU Affero General Public License v3.0 only](LICENSE), SPDX identifier
`AGPL-3.0-only`.

If you modify the software and offer it over a network, provide users the
Corresponding Source required by section 13 of the AGPL.
