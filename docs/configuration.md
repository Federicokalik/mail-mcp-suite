**English** · [Italiano](configuration.it.md)

# Configuration reference

The whole stack reads one file: `.env` in the repository root, copied from
`config/mail-mcp.env.example`. Do not put real values in the tracked example,
and never put a password in `.env` — it is injected into all four containers.

## What is not in `.env`

Two categories are deliberately kept out of the operator's file.

**Credentials** live in `local-config/secrets/` and are mounted per service as
Docker secrets. That mount list, in `compose.yaml`, is what isolates the
services: the Reader has no `smtp_password` in its container at all, regardless
of what `.env` says.

**Service identity** — listen ports, bearer token paths, secret paths, the
internal Worker URL and the Actions Host allowlist — is pinned in each service's
`environment:` block, which takes precedence over `env_file`. Those values must
not drift between services, so they are not exposed for editing.

## Compose variables

| Variable | Default | Purpose |
|---|---|---|
| `MAIL_MCP_IMAGE` | `mail-mcp-suite:local` | Image Compose runs; a published `ghcr.io/...` tag, or the local name when building with `compose.build.yaml` |
| `MAIL_MCP_CONFIG_DIR` | `./local-config` | Directory containing `secrets/` |
| `MAIL_MCP_BIND_ADDRESS` | `127.0.0.1` | Host interface for ports 3333, 3334, and 7337 |

`.env` is ignored by Git.

## Language

| Variable | Default | Purpose |
|---|---|---|
| `MAIL_MCP_LOCALE` | `en` | Language of user-facing text: `en` or `it` |

One setting covers the whole stack. It selects the language of MCP tool titles
and descriptions, messages returned in tool results, the in-chat approval app and
the browser approval page, including date formatting. An unrecognized value falls
back to `en`.

Process logs and startup configuration errors are always in English, so that bug
reports stay searchable regardless of the deployment language.

Because the Worker stores outcome messages in the outbox at the time it writes
them, changing the locale does not rewrite messages already recorded.

## Secrets

Each secret is one file under `local-config/secrets/`, mounted only into the
services that need it.

| Secret file | Mounted into | Minimum |
|---|---|---|
| `reader_mcp_token` | Reader | 32 characters |
| `actions_mcp_token` | Actions and proxy | 32 characters |
| `queue_api_token` | Actions and Worker | 32 characters |
| `approval_secret` | Worker | 10 characters |
| `approval_csrf_secret` | Worker | 32 characters |
| `imap_password` | Reader and Worker | provider requirement |
| `smtp_password` | Worker | provider requirement |

The code also accepts a bare `NAME` instead of `NAME_FILE`, for development and
tests. Do not use that form here: `.env` reaches every container, so an inline
credential would be readable by services that never need it.

Moves and the optional Sent copy reuse the same `imap_password` secret. Add a
separate Compose secret if your mail system requires distinct credentials.

## Mail account

| Variable | Default | Notes |
|---|---|---|
| `IMAP_HOST` | required | IMAP hostname |
| `IMAP_PORT` | `993` | IMAP TLS port |
| `IMAP_SECURE` | `true` | Must remain true unless the explicit test override is enabled |
| `IMAP_USER` | required | IMAP login |
| `SMTP_HOST` | required | SMTP hostname |
| `SMTP_PORT` | `465` | SMTP TLS port |
| `SMTP_SECURE` | `true` | TLS from connection start |
| `SMTP_USER` | required | SMTP login |
| `FROM_NAME` | empty | Display name; CR/LF rejected |
| `FROM_ADDRESS` | required | Envelope and header sender |
| `ALLOW_INSECURE_MAIL_TRANSPORT` | `false` | Test networks only |
| `IMAP_CONNECTION_TIMEOUT_MS` | `15000` | Connection and greeting timeout |
| `IMAP_SOCKET_TIMEOUT_MS` | `60000` | Socket inactivity timeout |
| `SMTP_CONNECTION_TIMEOUT_MS` | `15000` | Connection and greeting timeout |
| `SMTP_SOCKET_TIMEOUT_MS` | `60000` | Socket inactivity timeout |

## Reader

| Variable | Default | Notes |
|---|---|---|
| `MAILBOX_ALLOWLIST` | example folder set | Exact, comma-separated IMAP paths |
| `MAX_SEARCH_RESULTS` | `100` | Allowed range 1–250 |
| `MAX_MESSAGE_BYTES` | `5000000` | Refuse larger messages before parsing |
| `READER_CHARACTER_LIMIT` | `30000` | Maximum MCP text response size |
| `READER_ALLOWED_HOSTS` | `localhost,127.0.0.1` | Exact HTTP Host allowlist, no wildcards |

## Actions

| Variable | Default | Notes |
|---|---|---|
| `WORKER_REQUEST_TIMEOUT_MS` | `15000` | Worker API timeout |
| `ACTIONS_CHARACTER_LIMIT` | `20000` | Maximum MCP text response size |
| `APPROVAL_BASE_URL` | `http://127.0.0.1:7337` | URL shown to the user, and the only origin the in-chat approval app may reach; use public HTTPS behind Tunnel |
| `APPROVAL_WAIT_MS` | `120000` | How long a call waits on a URL-mode elicitation for clients that cannot render the app; `0` disables the wait |
| `PROXY_ALLOWED_HOSTS` | `localhost,127.0.0.1` | Exact Host allowlist of the proxy in front of Actions; add LAN and public hostnames explicitly |

## Cloudflare Access

Optional. Reader and Actions are separate Access applications, so each has its
own audience. Configure all four together or leave them all unset.

| Variable | Purpose |
|---|---|
| `CLOUDFLARE_ACCESS_TEAM_DOMAIN` | HTTPS origin such as `https://team.cloudflareaccess.com` |
| `CLOUDFLARE_ACCESS_EMAILS` | Exact authenticated email allowlist |
| `READER_ACCESS_AUD` | Reader Access application audience |
| `ACTIONS_ACCESS_AUD` | Actions Access application audience |

Compose routes each audience to the right service. A blank value counts as
unset, so a setting can be disabled by emptying it rather than deleting the line.

## Worker: sending policy

| Variable | Default | Notes |
|---|---|---|
| `MAX_RECIPIENTS` | `10` | Counts To, Cc, and Bcc |
| `RECIPIENT_DOMAIN_ALLOWLIST` | empty | When non-empty, every recipient domain must match exactly |
| `RECIPIENT_DOMAIN_DENYLIST` | empty | Exact domain blocks, checked before allowlist |
| `MAX_SCHEDULE_DAYS` | `365` | Maximum future horizon |
| `MIN_SCHEDULE_LEAD_SECONDS` | `60` | Minimum future offset |
| `SCHEDULER_INTERVAL_MS` | `2000` | Worker polling interval |

An empty recipient allowlist permits any domain not denied. Subdomains do not
implicitly match their parent.

## Worker: moves

| Variable | Default | Notes |
|---|---|---|
| `MOVE_IMAP_HOST` | `SMTP_HOST` | IMAP host used only after approval |
| `MOVE_IMAP_PORT` | `993` | IMAP port |
| `MOVE_IMAP_SECURE` | `true` | Encrypted transport |
| `MOVE_IMAP_USER` | `SMTP_USER` | IMAP login |
| `MOVE_SOURCE_ALLOWLIST` | example folder set | Exact source paths |
| `MOVE_DESTINATION_ALLOWLIST` | example folder set | Exact destination paths |
| `MOVE_MAX_BATCH` | `25` | Allowed range 1–25 |

Remove move destinations you do not want an agent to propose. Do not add Spam or
Trash merely because the provider exposes them.

## Worker: approval and storage

| Variable | Default | Notes |
|---|---|---|
| `OUTBOX_PATH` | `/data/outbox.json` | Persistent proposal store |
| `APPROVAL_TTL_MINUTES` | `1440` | Allowed range 1–10080 |
| `APPROVAL_TIMEZONE` | `UTC` | IANA timezone used by both approval surfaces |
| `WORKER_ALLOWED_HOSTS` | `localhost,127.0.0.1,worker` | Exact Host allowlist; add the public approval hostname |
| `TRUST_PROXY_HOPS` | `0` | Set to `1` only behind one trusted proxy |

Do not raise `TRUST_PROXY_HOPS` speculatively. It controls which forwarding
headers Express and the approval rate limiter trust.

## Worker: Sent copy

| Variable | Default | Notes |
|---|---|---|
| `SAVE_SENT_COPY` | `false` | Append the exact delivered MIME to IMAP |
| `SENT_IMAP_HOST` | unset | Required when enabled |
| `SENT_IMAP_PORT` | `993` | IMAP port |
| `SENT_IMAP_SECURE` | `true` | Encrypted transport |
| `SENT_IMAP_USER` | unset | Required when enabled |
| `SENT_MAILBOX` | `Sent` | Exact provider folder path |

SMTP delivery can succeed while the Sent append fails. In that case the proposal
is `sent` with a warning; it is not delivered twice.
