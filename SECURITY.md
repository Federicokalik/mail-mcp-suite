**English** · [Italiano](SECURITY.it.md)

# Security policy

Mail access and outbound communication are high-impact capabilities. This project
uses separation of privileges and human approval, but operators remain responsible
for securing the host, mail account, and remote access layer.

## Reporting a vulnerability

Do not open a public issue containing credentials, private email, approval URLs, or
exploit details. Use GitHub private vulnerability reporting when it is enabled for
the repository. If it is unavailable, open a minimal issue asking the maintainers
for a private contact channel without disclosing the vulnerability.

Include:

- affected version or commit;
- deployment mode;
- reproduction steps using synthetic data;
- expected and observed impact;
- suggested remediation, if known.

## Trust boundaries

- `reader` holds IMAP credentials and opens only exact allowlisted mailboxes in
  read-only mode.
- `actions` can create proposals but has no SMTP, IMAP, or approval secret.
- `actions-proxy` is the exposed Actions endpoint and optionally validates
  Cloudflare Access assertions.
- `worker` is the only process able to send or move mail. It is not an MCP server.
- `control` is an internal Docker network between Actions and Worker.

See [docs/architecture.md](docs/architecture.md) for the full data flow.

## Prompt injection

Sender names, addresses, recipients, subjects, bodies, attachment names, and links
are untrusted external data. Instructions inside a message are never user consent.

An agent must not, solely because an email says so:

- call another tool;
- send, reply, forward, or schedule;
- move, restore, flag, or delete;
- open a link or attachment;
- disclose secrets or other messages;
- change a filter or Access policy.

Keep scheduled digests read-only and connect only the Reader MCP. Prefer Sieve or
provider filters for deterministic sorting.

## Mandatory production controls

1. Use application-specific mail passwords where available.
2. Use encrypted IMAP and SMTP transports. Keep
   `ALLOW_INSECURE_MAIL_TRANSPORT=false`.
3. Generate the four machine secrets independently with a cryptographic RNG.
4. Use a separate human approval secret; do not reuse a mail or MCP password.
5. Keep `local-config/`, backups, and outbox data out of Git.
6. Bind published ports to `127.0.0.1` unless a specific trusted interface is
   required.
7. Do not port-forward the services from a router.
8. For Internet access, use HTTPS, Cloudflare Tunnel, and default-deny Access
   policies.
9. Enable Managed OAuth only for MCP endpoints, not as a replacement for the
   approval secret.
10. Restrict Docker daemon and backup access.
11. Review client tool permissions; write-capable tools should always ask.
12. Rotate affected secrets after any suspected leak.

## Authentication

Reader and Actions use distinct static bearer tokens. The queue API token is for
the internal Actions-to-Worker channel and must never be configured in an MCP
client.

With Cloudflare Access enabled, the Reader and Actions proxy validate:

- the JWT signature using the team's remote JWK set;
- issuer;
- application audience;
- the authenticated email allowlist.

Cloudflare remains the edge enforcement layer. Origin validation is defense in
depth. The origin should stay on loopback because a correct static bearer token
can authenticate directly if an attacker can reach the local service.

All exposed HTTP services also validate the `Host` header against an exact
allowlist. Add public or LAN hostnames deliberately; wildcards are not supported.
For a single trusted reverse proxy set `TRUST_PROXY_HOPS=1`. Keep it at `0` for
direct access so rate limiting does not trust spoofed forwarding headers.

The approval page is separately protected by:

- the Access browser policy in the recommended remote setup;
- an HMAC-signed CSRF field bound to proposal, creation time, and action;
- a human approval secret;
- rate limiting;
- no-store and restrictive browser security headers.

An approval URL is sensitive even though it is insufficient by itself.

## Persistent data

`outbox.json` contains message bodies, recipients, proposal notes, and move
metadata in clear text. The Worker writes it atomically with file mode `0600`, but
the Docker volume and its backups are not application-encrypted.

Protect:

- Docker daemon access;
- host root access;
- backup destinations;
- support bundles and logs;
- filesystem snapshots.

Actions status responses omit send bodies and Bcc recipients. The browser approval
page intentionally displays the full proposal for human review.

## Ambiguous outcomes

Before an operation, the Worker persists state as `sending`. A crash or ambiguous
remote response can mean the operation succeeded even when the local process did
not receive confirmation.

Such proposals become `uncertain` and are not retried automatically. Check the
Sent folder, recipient, source mailbox, and destination mailbox before creating a
replacement proposal.

## IMAP move protections

- source and destination mailbox allowlists;
- maximum batch size;
- stable idempotency keys for proposal creation;
- pre-approval message metadata snapshot;
- message identity revalidation before MOVE;
- per-message outcome recording;
- no delete or Trash tool;
- restoration only through a new approved proposal.

If the IMAP server does not return a destination UID, automatic restoration is not
considered safe.

## SMTP protections

- maximum recipient count;
- optional recipient-domain allowlist and denylist;
- CR/LF rejection in headers;
- explicit schedule lead time and horizon;
- no automatic retry after an ambiguous delivery;
- optional exact MIME copy to the Sent mailbox.

SMTP acceptance does not guarantee delivery to the recipient. Saving a Sent copy
is a separate IMAP action and can fail after successful delivery.

## Dependency and release hygiene

Before a release:

```sh
npm ci --ignore-scripts
npm run check
npm audit --omit=dev
docker compose config
```

Review advisories in context, but do not apply breaking or forced dependency
changes without tests. Pin container base images and update them intentionally.
Run a secret scanner against the complete Git history, not only the current tree.

At version 2.0.0, `npm audit` reports
[`GHSA-frvp-7c67-39w9`](https://github.com/advisories/GHSA-frvp-7c67-39w9)
through the production MCP SDK dependency. The advisory concerns the Hono Node
adapter's static-file middleware on Windows. This project runs in a Linux
container and does not import or invoke that middleware, so the vulnerable path is
not reachable in the documented deployment. The current v1 MCP SDK still pins the
affected dependency line; do not force a breaking SDK downgrade. Reassess and
update when upstream publishes a compatible fix.

## Incident response

If exposure is suspected:

1. remove public Tunnel routes before changing Access;
2. stop the affected containers;
3. rotate the tunnel token if relevant;
4. rotate Reader, Actions, queue, CSRF, and approval secrets as appropriate;
5. revoke and replace mail application passwords;
6. inspect Access authentication logs and host logs;
7. inspect pending, scheduled, `sending`, and `uncertain` proposals;
8. verify mailbox folders and recent SMTP activity;
9. rebuild from a reviewed source revision.

Never remove Access protection while leaving a public Tunnel route active.
