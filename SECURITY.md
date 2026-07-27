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
5. Do not let the browser's password manager store the approval secret, and
   decline the offer to save it. The approval step is the one control an agent
   driving the browser cannot satisfy, because the secret is the only thing in
   the flow that is not present in the environment. A stored secret is autofilled
   into the form, and an autofilled form can be submitted by anything that can
   click. Both approval forms request `autocomplete="new-password"` to keep
   managers from matching, but that is a hint to the browser, not a guarantee.
6. Keep `local-config/`, backups, and outbox data out of Git.
7. Bind published ports to `127.0.0.1` unless a specific trusted interface is
   required.
8. Do not port-forward the services from a router.
9. For Internet access, use HTTPS, Cloudflare Tunnel, and default-deny Access
   policies.
10. Enable Managed OAuth only for MCP endpoints, not as a replacement for the
    approval secret.
11. Restrict Docker daemon and backup access.
12. Review client tool permissions; write-capable tools should always ask.
13. Rotate affected secrets after any suspected leak.

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

## In-chat approval

The same proposal can also be reviewed in an MCP App: an HTML view Actions
serves as a `ui://` resource, which the host renders inside a sandboxed iframe
in the conversation. Both properties the browser page provides are preserved.

The model cannot approve. No MCP tool approves a proposal; Actions still has no
`APPROVAL_SECRET`. The app talks to the Worker directly, over the same routes
the browser form uses.

What is approved is what was proposed. The view is built from the stored
proposal by the Worker, not summarized by the model, and it renders the full
body so the reviewer sees the real message.

The app is handed a per-proposal capability token in the tool result `_meta`,
which hosts are expected to route to the app rather than into the model's
context. Do not rely on that alone: the design assumes the token may leak. It is
an HMAC over proposal id, creation time, and a distinct action label, so it is
neither a CSRF token nor valid for another proposal. On its own it permits
reading one proposal; approving additionally requires the CSRF signature and the
human approval secret, and the rate limiter is shared with the browser form.

The message body and the approval secret never traverse the MCP host. Actions
returns the same redacted summary as before, and the secret is typed into the
iframe and posted straight to the Worker. Neither can end up in a conversation
transcript or in a host's logs.

The three app routes (`/approval/:id/app`, `app-approve`, `app-cancel`) answer
CORS requests from a null origin and do not use cookies, which is what lets a
sandboxed iframe reach them. In the tunneled deployment they need an Access
exception; see [docs/cloudflare.md](docs/cloudflare.md) for the scoped policy
and what it trades away. Without that exception the feature degrades to the
elicitation prompt or the plain URL, both of which keep the Access-protected
page in a browser.

Terminal clients instead receive a URL-mode elicitation pointing at the browser
page. Only the URL travels through the client. `APPROVAL_WAIT_MS` bounds how
long the tool call waits before returning; the proposal stays valid until it
expires either way.

Actions runs the MCP transport in stateful mode so that elicitation, a
server-initiated request, can be delivered. Sessions are capped and evicted
when idle. The Reader remains stateless.

## HTML message bodies

A send may carry an `html` part next to the mandatory `text` part, or an `mjml`
template that Actions compiles into one. Three properties keep this from widening
the trust boundary.

**Compilation happens once, in the process without credentials.** MJML is
compiled when the proposal is created, inside Actions, and only the resulting
HTML is stored. The Worker holds SMTP and IMAP credentials, the approval secret
and the CSRF key; Actions holds none of them, so the parser that chews on
semi-trusted markup runs where a bug buys the least. Compiling once also means
the HTML shown at approval time and the HTML handed to SMTP are the same bytes,
with no second render in between. `mj-include` is rejected outright, so a
template cannot read files from the container.

**The preview cannot execute or phone home.** `/approval/:id/preview` serves the
body as its own document under `default-src 'none'; style-src 'unsafe-inline';
img-src data:; ... sandbox`, framed with `sandbox=""`. No script runs, no remote
image, font or stylesheet loads, and no form can be submitted. A tracking pixel
therefore cannot report that a message was reviewed, and a beacon cannot leak the
approval URL. The frame is labelled as a preview with remote resources blocked so
that missing images are not mistaken for the recipient's view.

**The in-chat app does not render HTML at all.** Inside the host's iframe the
frame policy belongs to the host, and a message rendered without its stylesheet
still looks enough like a message to be approved on sight. The app shows the text
part, states that the HTML was not rendered, and links to the approval page.

The text part stays mandatory for the same reason: it is a representation of the
message that cannot hide anything behind markup.

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

At version 3.1.0, `mjml` is a production dependency and it is a large one: it
brings roughly 200 transitive packages into an image that previously had few.
`npm audit --omit=dev` reports
[`GHSA-mh99-v99m-4gvg`](https://github.com/advisories/GHSA-mh99-v99m-4gvg)
(`brace-expansion`, denial of service through unbounded expansion) many times
over. The repetition is one advisory counted once per `mjml-*` sub-package: the
single path is `brace-expansion` → `minimatch` → `editorconfig` → `js-beautify`
→ `mjml-core`. `js-beautify` is only reached when MJML is asked to pretty-print
its output, and `src/actions/mjml.ts` compiles with `beautify: false` and
`minify: false`, so that path is not invoked. Nothing from a message body
reaches `brace-expansion`, which consumes glob patterns rather than markup. The
remedy npm proposes is a downgrade to `mjml@5.1.0`; do not take it blindly.
Reassess when upstream unpins `js-beautify`. If this trade stops being
acceptable, the feature degrades cleanly: dropping `mjml` leaves `html` working
and only removes server-side template compilation.

Also at version 3.1.0, `npm audit` reports
[`GHSA-frvp-7c67-39w9`](https://github.com/advisories/GHSA-frvp-7c67-39w9)
through the production MCP SDK dependency, now reached both directly and through
`@modelcontextprotocol/ext-apps`. The advisory concerns the Hono Node
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
