**English** · [Italiano](installation.it.md)

# Installation

This guide deploys the suite on a Linux host with Docker Compose. Keep the default
loopback binding unless you explicitly need LAN access.

## Prerequisites

- Docker Engine with Compose v2;
- a mail account with IMAP over TLS;
- SMTP over TLS and, preferably, an application-specific password;
- Node.js 20.11 or newer only when running checks outside Docker;
- three free local TCP ports: `3333`, `3334`, and `7337`.

## 1. Prepare configuration

The whole stack reads one file, `.env` in the repository root. Passwords are not
in it: they live in `local-config/secrets/` and are mounted per service as
Docker secrets, which is what actually keeps SMTP credentials out of the Reader.
Ports and bearer token paths are pinned in `compose.yaml` so they cannot drift.

Both paths below are ignored by Git.

```sh
cp config/mail-mcp.env.example .env
mkdir -p local-config/secrets
chmod 600 .env
chmod 700 local-config local-config/secrets
```

Edit `.env`:

- set the IMAP and SMTP hostname, port, user, and sender;
- set the exact mailbox names used by your server;
- set `APPROVAL_TIMEZONE` to an IANA name such as `Europe/Rome`;
- leave the Cloudflare variables commented out for a local-only deployment;
- keep `ALLOW_INSECURE_MAIL_TRANSPORT=false` in production.

Never put a password in `.env`. It is injected into all four containers, so an
inline credential would be readable by services that have no business with it.

Mailbox names are provider-specific. Use `INBOX`, `INBOX.Social`, and similar
values only if those exact names exist on your server.

## 2. Create secrets

Create one line in each file, without surrounding quotes:

```text
local-config/secrets/
├── actions_mcp_token
├── approval_csrf_secret
├── approval_secret
├── imap_password
├── queue_api_token
├── reader_mcp_token
└── smtp_password
```

Generate machine tokens independently:

```sh
openssl rand -hex 32
```

Use that command separately for `reader_mcp_token`, `actions_mcp_token`,
`queue_api_token`, and `approval_csrf_secret`. Use a distinct, human-typeable
passphrase of at least 10 characters for `approval_secret`. Do not reuse the mail
password.

```sh
chmod 600 local-config/secrets/*
```

If the container user cannot read a secret on your platform, adjust group
ownership narrowly. Do not make the files world-readable.

## 3. Validate and start

Tagged releases publish a multi-architecture image to GHCR. To use it, point
`MAIL_MCP_IMAGE` at the tag you want in the root `.env` and skip the build:

```dotenv
# .env
MAIL_MCP_IMAGE=ghcr.io/federicokalik/mail-mcp-suite:3.0.0
```

```sh
docker compose config
docker compose pull
docker compose up -d
docker compose ps
```

To build from source instead, add the build override:

```sh
npm ci --ignore-scripts
npm run check
docker compose config
docker compose -f compose.yaml -f compose.build.yaml build
docker compose up -d
docker compose ps
```

Check each local endpoint:

```sh
curl --fail http://127.0.0.1:3333/healthz
curl --fail http://127.0.0.1:3334/healthz
curl --fail http://127.0.0.1:7337/healthz
```

Verify mail credentials without sending:

```sh
docker compose run --rm reader node dist/reader/verify-imap.js
docker compose run --rm worker node dist/worker/verify-smtp.js
```

The SMTP verifier only checks the authenticated transport. It does not send a
message.

## 4. Bind to a LAN address

The default binds all published ports to `127.0.0.1`. To expose them on one
specific LAN interface, edit the root `.env` created in step 1:

```dotenv
# .env
MAIL_MCP_BIND_ADDRESS=192.0.2.10
```

Replace `192.0.2.10` with an address actually assigned to the host. Do not use
`0.0.0.0` unless the host firewall and network are intentionally configured for
that exposure. Also add that exact address to:

- `READER_ALLOWED_HOSTS`;
- `PROXY_ALLOWED_HOSTS`;
- `WORKER_ALLOWED_HOSTS`.

Keep `TRUST_PROXY_HOPS=0` for direct LAN access. Do not port-forward these
services from a router.

For Cloudflare Tunnel running on the same host, the default loopback binding is
preferred; see [cloudflare.md](cloudflare.md).

## 5. Test the MCP endpoints

Any Streamable HTTP MCP client that supports custom headers can use:

```json
{
  "mcpServers": {
    "mail-reader": {
      "url": "http://127.0.0.1:3333/mcp",
      "headers": {
        "Authorization": "Bearer READER_TOKEN"
      }
    },
    "mail-actions": {
      "url": "http://127.0.0.1:3334/mcp",
      "headers": {
        "Authorization": "Bearer ACTIONS_TOKEN"
      }
    }
  }
}
```

Client configuration formats vary. Never substitute the queue token or approval
secret for an MCP token.

## Updates and backup

The outbox may contain approved scheduled messages. Back it up before an update:

```sh
docker compose stop
docker run --rm \
  -v mail-mcp_outbox:/data \
  -v "$PWD":/backup \
  busybox cp /data/outbox.json /backup/outbox.backup.json
```

Protect the backup as sensitive mail data. Run `npm run check` before rebuilding.
Do not remove the volume while scheduled proposals still matter.

## Uninstall

Stop the services without deleting the outbox:

```sh
docker compose down
```

`docker compose down -v` permanently removes the outbox volume. Use it only after
reviewing or backing up pending and scheduled proposals.
