**English** · [Italiano](configuration.it.md)

# Configuration reference

The repository contains neutral examples in `config/`. Copy them into
`local-config/` and edit the copies. Do not put real values in the tracked
examples.

## Compose variables

These variables belong in the repository-root `.env`, copied from
`config/compose.env.example`:

| Variable | Default | Purpose |
|---|---|---|
| `MAIL_MCP_IMAGE` | `mail-mcp-suite:local` | Image Compose runs; a published `ghcr.io/...` tag, or the local name when building with `compose.build.yaml` |
| `MAIL_MCP_CONFIG_DIR` | `./local-config` | Directory containing service env files and `secrets/` |
| `MAIL_MCP_BIND_ADDRESS` | `127.0.0.1` | Host interface for ports 3333, 3334, and 7337 |

Compose `.env` is ignored by Git. These three are read by Compose itself and are
never injected into a container; per-service settings live in the files below,
each mounted into one service only.

## Language

| Variable | Default | Purpose |
|---|---|---|
| `MAIL_MCP_LOCALE` | `en` | Language of user-facing text: `en` or `it` |

Set it per service in `reader.env`, `actions.env`, and `worker.env`. It selects the
language of MCP tool titles and descriptions, messages returned in tool results,
and the browser approval page, including its date formatting. An unrecognized
value falls back to `en`.

Process logs and startup configuration errors are always in English, so that bug
reports stay searchable regardless of the deployment language.

Because the Worker stores outcome messages in the outbox at the time it writes
them, changing the locale does not rewrite messages already recorded.

## Secret loading

Every secret can be provided as `NAME` or `NAME_FILE`; never both. Docker Compose
uses files under `/run/secrets/`. Direct environment values exist for development
and tests but are easier to leak through process inspection and diagnostics.

| Secret file | Consumer | Minimum |
|---|---|---|
| `reader_mcp_token` | Reader | 32 characters |
| `actions_mcp_token` | Actions and proxy | 32 characters |
| `queue_api_token` | Actions and Worker | 32 characters |
| `approval_secret` | Worker approval form | 10 characters |
| `approval_csrf_secret` | Worker | 32 characters |
| `imap_password` | Reader and move Worker | provider requirement |
| `smtp_password` | Worker | provider requirement |

`SENT_IMAP_PASSWORD_FILE` points to the same IMAP Docker secret in the example.
Use separate provider credentials by adding a separate Compose secret if your
mail system requires it.

## Reader

File: `local-config/reader.env`.

| Variable | Default | Notes |
|---|---|---|
| `IMAP_HOST` | required | IMAP hostname |
| `IMAP_PORT` | `993` | IMAP TLS port |
| `IMAP_SECURE` | `true` | Must remain true unless the explicit test override is enabled |
| `IMAP_USER` | required | IMAP login |
| `IMAP_PASSWORD_FILE` | Compose secret path | Recommended credential source |
| `ALLOW_INSECURE_MAIL_TRANSPORT` | `false` | Test networks only |
| `MAILBOX_ALLOWLIST` | `INBOX` | Exact, comma-separated IMAP paths |
| `MAX_SEARCH_RESULTS` | `100` | Allowed range 1–250 |
| `MAX_MESSAGE_BYTES` | `5000000` | Refuse larger messages before parsing |
| `CHARACTER_LIMIT` | `30000` | Maximum MCP text response size |
| `IMAP_CONNECTION_TIMEOUT_MS` | `15000` | Connection and greeting timeout |
| `IMAP_SOCKET_TIMEOUT_MS` | `60000` | Socket inactivity timeout |
| `MCP_HOST` | `0.0.0.0` | Container listen address |
| `MCP_PORT` | `3333` | Container port |
| `MCP_ALLOWED_HOSTS` | `localhost,127.0.0.1` | Exact HTTP Host allowlist, no wildcards |
| `MCP_TOKEN_FILE` | Compose secret path | Reader bearer token |

Optional Cloudflare variables must be configured together:

| Variable | Purpose |
|---|---|
| `CLOUDFLARE_ACCESS_TEAM_DOMAIN` | HTTPS origin such as `https://team.cloudflareaccess.com` |
| `CLOUDFLARE_ACCESS_AUD` | Reader Access application audience |
| `CLOUDFLARE_ACCESS_EMAILS` | Exact authenticated email allowlist |

## Actions

File: `local-config/actions.env`.

| Variable | Default | Notes |
|---|---|---|
| `WORKER_INTERNAL_URL` | `http://mail-worker:7337` in code; Compose uses `http://worker:7337` | Internal queue API |
| `WORKER_REQUEST_TIMEOUT_MS` | `15000` | Worker API timeout |
| `APPROVAL_BASE_URL` | `http://127.0.0.1:7337` | URL shown to the user, and the only origin the in-chat approval app may reach; use public HTTPS behind Tunnel |
| `APPROVAL_WAIT_MS` | `120000` | How long a call waits on a URL-mode elicitation for clients that cannot render the app; `0` disables the wait |
| `MCP_HOST` | `0.0.0.0` | Container listen address |
| `MCP_PORT` | `3334` | Internal Actions port |
| `MCP_ALLOWED_HOSTS` | `localhost,127.0.0.1,actions` | Includes the Docker service name used by the proxy |
| `MCP_TOKEN_FILE` | Compose secret path | Actions bearer token |
| `QUEUE_API_TOKEN_FILE` | Compose secret path | Internal Worker API token |
| `CHARACTER_LIMIT` | `20000` | Maximum MCP text response size |

## Actions proxy

File: `local-config/actions-proxy.env`.

Compose supplies the internal target and token path. The user-facing variables are:

| Variable | Default | Notes |
|---|---|---|
| `PROXY_ALLOWED_HOSTS` | `localhost,127.0.0.1` | Add LAN and public Actions hostnames explicitly |
| `CLOUDFLARE_ACCESS_TEAM_DOMAIN` | unset | Optional; configure all Cloudflare fields together |
| `CLOUDFLARE_ACCESS_AUD` | unset | Actions Access application audience |
| `CLOUDFLARE_ACCESS_EMAILS` | unset | Exact authenticated email allowlist |

Internal advanced variables are `PROXY_HOST`, `PROXY_PORT`, `PROXY_TARGET`,
`PROXY_TIMEOUT_MS`, and `MCP_TOKEN_FILE`. The proxy accepts the static bearer
token when Cloudflare settings are omitted.

## Worker: SMTP and sender

File: `local-config/worker.env`.

| Variable | Default | Notes |
|---|---|---|
| `SMTP_HOST` | required | SMTP hostname |
| `SMTP_PORT` | `465` | SMTP TLS port |
| `SMTP_SECURE` | `true` | TLS from connection start |
| `SMTP_USER` | required | SMTP login |
| `SMTP_PASSWORD_FILE` | Compose secret path | SMTP credential |
| `FROM_NAME` | empty | Display name; CR/LF rejected |
| `FROM_ADDRESS` | required | Envelope/header sender |
| `SMTP_CONNECTION_TIMEOUT_MS` | `15000` | Connection and greeting timeout |
| `SMTP_SOCKET_TIMEOUT_MS` | `60000` | Socket inactivity timeout |
| `MAX_RECIPIENTS` | `10` | Counts To, Cc, and Bcc |
| `RECIPIENT_DOMAIN_ALLOWLIST` | empty | When non-empty, every recipient domain must match exactly |
| `RECIPIENT_DOMAIN_DENYLIST` | empty | Exact domain blocks, checked before allowlist |

An empty recipient allowlist permits any domain not denied. Subdomains do not
implicitly match their parent.

## Worker: moves

| Variable | Default | Notes |
|---|---|---|
| `MOVE_IMAP_HOST` | `SMTP_HOST` | IMAP host used only after approval |
| `MOVE_IMAP_PORT` | `993` | IMAP port |
| `MOVE_IMAP_SECURE` | `true` | Encrypted transport |
| `MOVE_IMAP_USER` | `SMTP_USER` | IMAP login |
| `MOVE_IMAP_PASSWORD_FILE` | Compose IMAP secret | Credential |
| `MOVE_SOURCE_ALLOWLIST` | example folder set | Exact source paths |
| `MOVE_DESTINATION_ALLOWLIST` | example folder set | Exact destination paths |
| `MOVE_MAX_BATCH` | `25` | Allowed range 1–25 |

Remove move destinations you do not want an agent to propose. Do not add Spam or
Trash merely because the provider exposes them.

## Worker: scheduling and approval

| Variable | Default | Notes |
|---|---|---|
| `OUTBOX_PATH` | `/data/outbox.json` | Persistent proposal store |
| `APPROVAL_TTL_MINUTES` | `1440` | Allowed range 1–10080 |
| `APPROVAL_TIMEZONE` | `UTC` | IANA timezone used by the UI |
| `APPROVAL_SECRET_FILE` | Compose secret path | Human approval passphrase |
| `APPROVAL_CSRF_SECRET_FILE` | Compose secret path | HMAC key |
| `QUEUE_API_TOKEN_FILE` | Compose secret path | Internal API token |
| `MAX_SCHEDULE_DAYS` | `365` | Maximum future horizon |
| `MIN_SCHEDULE_LEAD_SECONDS` | `60` | Minimum future offset |
| `SCHEDULER_INTERVAL_MS` | `2000` | Worker polling interval |

## Worker: Sent copy

| Variable | Default | Notes |
|---|---|---|
| `SAVE_SENT_COPY` | `false` | Append the exact delivered MIME to IMAP |
| `SENT_IMAP_HOST` | unset | Required when enabled |
| `SENT_IMAP_PORT` | `993` | IMAP port |
| `SENT_IMAP_SECURE` | `true` | Encrypted transport |
| `SENT_IMAP_USER` | unset | Required when enabled |
| `SENT_IMAP_PASSWORD_FILE` | Compose IMAP secret | Credential |
| `SENT_MAILBOX` | `Sent` | Exact provider folder path |

SMTP delivery can succeed while the Sent append fails. In that case the proposal
is `sent` with a warning; it is not delivered twice.

## Worker: HTTP

| Variable | Default | Notes |
|---|---|---|
| `WORKER_HOST` | `0.0.0.0` | Container listen address |
| `WORKER_PORT` | `7337` | Queue API and approval UI |
| `WORKER_ALLOWED_HOSTS` | `localhost,127.0.0.1,worker` | Exact Host allowlist |
| `TRUST_PROXY_HOPS` | `0` | Set to `1` only behind one trusted proxy |

Do not raise `TRUST_PROXY_HOPS` speculatively. It controls which forwarding
headers Express and the approval rate limiter trust.
