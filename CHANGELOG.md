# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [3.1.1] - 2026-07-27

### Added

- Every release attaches `email-html-mjml-skill.zip`: the vendored MJML authoring
  skill, packaged in the layout claude.ai expects for a personal skill upload — the
  skill folder at the root of the archive. It is rebuilt from the vendored copy on
  each release, so it follows whatever a `git subtree pull` brings in.
- The `mjml` field description points at that asset, conditionally: an agent offers
  it only when no MJML authoring skill is loaded in the session, and says nothing
  when one already is. This is the only runtime change in this release.

### Changed

- Releases are cut from a single workflow run. Running **Release** by hand on `main`
  reads the version from `package.json`, refuses to continue if the changelog has no
  matching section or if the tag already exists, then creates the tag and carries on
  in the same run. It has to be one run: a tag pushed with `GITHUB_TOKEN` does not
  trigger workflows, so tagging from a separate workflow would have needed a personal
  access token. Pushing a `vx.y.z` tag by hand still works, and now additionally
  checks that the tag and `package.json` agree.
- Container image tags are derived from the resolved version rather than from the
  ref, so both entry points label the image identically.
- The workflow publishes a GitHub release with the changelog section as its notes.
  Until now `CHANGELOG.md` existed and nothing outside the repository ever showed it.

### Security

- No change to trust boundaries, credentials, the approval flow or the HTML preview.
  The only difference reaching a running container is one tool-schema description
  string.

## [3.1.0] - 2026-07-27

### Added

- `mail_send` and `mail_schedule` accept an optional `html` body, delivered with
  the text part as `multipart/alternative`. The Sent copy reuses the same MIME
  buffer that went to SMTP, so nothing is rebuilt.
- They also accept an `mjml` template, compiled to HTML by Actions. Compilation
  happens once, at proposal creation, and only the resulting HTML is stored: the
  bytes reviewed at approval time are the bytes handed to SMTP. `mj-include` is
  refused so a template cannot read files from the container. `html` and `mjml`
  are mutually exclusive, and `text` remains mandatory in both cases.
- `GET /approval/:id/preview` serves the HTML body as its own document for the
  sandboxed frame on the approval page.
- `skills/framix-email-html-mjml`, an MJML authoring skill vendored from
  [framix-team/skill-email-html-mjml](https://github.com/framix-team/skill-email-html-mjml)
  via `git subtree`. See [skills/README.md](skills/README.md) and
  [ACKNOWLEDGEMENTS.md](ACKNOWLEDGEMENTS.md) for attribution and licence status.

### Changed

- The browser approval page asks for the approval secret once, in a single
  labelled field, instead of twice in two separate forms. Approve and cancel are
  submit buttons carrying their own CSRF token, so the page still needs no
  JavaScript.
- Both approval surfaces were restyled around one set of semantic colour tokens
  with a designed dark mode, visible field labels, `role="alert"` errors and
  focus rings that are never removed. Recipients wrap instead of truncating, and
  the Bcc row is always shown — an absent row and an empty one used to look the
  same.
- Scheduled proposals now state on the approval surface that approving grants the
  send at its scheduled time, with no second check.
- The JSON body limit on the Actions and Worker HTTP entry points rises from 1 MB
  to 2 MB, since a proposal may now carry a text part, an HTML part and a
  template.

### Security

- Both approval forms request `autocomplete="new-password"` instead of
  `current-password`. A stored, autofilled approval secret is a secret the
  environment holds, and anything able to drive the browser could submit the form
  without knowing it — which would reduce the one control an agent cannot satisfy
  to a button. `SECURITY.md` adds a matching production control.
- MJML is compiled in Actions, never in the Worker. The Worker holds the SMTP and
  IMAP credentials, the approval secret and the CSRF key; Actions holds none of
  them, so the parser fed semi-trusted markup runs where a bug buys the least.
- The HTML preview runs under `default-src 'none'; style-src 'unsafe-inline';
  img-src data:; ... sandbox` in a frame with `sandbox=""`. No script executes and
  no remote resource loads, so a tracking pixel cannot report that a message was
  reviewed.
- The in-chat app deliberately does not render HTML. Inside the host's iframe the
  frame policy is the host's, and a message rendered without its styles is still
  convincing enough to approve. The app says so and links to the approval page.
- `mjml` adds roughly 200 transitive packages and a `brace-expansion` advisory
  reached through `js-beautify`, which is only used for pretty-printing and is
  disabled here. `SECURITY.md` records the assessment and the exit path.

### Migration from 3.0.x

1. `docker compose pull && docker compose up -d`
2. No configuration changes are required.
3. Rolling back to 3.0.x after sending HTML: the older schema silently drops the
   `html` field when it reloads `outbox.json`, so a pending HTML proposal would
   lose its HTML part rather than fail. Approve or cancel pending HTML proposals
   before downgrading.

## [3.0.0] - 2026-07-26

### Changed

- **Breaking.** The five configuration files collapse into one: `.env` in the
  repository root, copied from `config/mail-mcp.env.example`. The per-service
  `config/*.env.example` files are gone.
- Settings that identify a service — listen ports, bearer token paths, secret
  paths, the internal Worker URL and the Actions Host allowlist — moved into the
  `environment:` blocks of `compose.yaml`, which take precedence over
  `env_file`. They can no longer drift or be edited by accident.
- Variables that previously collided between services are now named apart:
  `MCP_ALLOWED_HOSTS` becomes `READER_ALLOWED_HOSTS`, `CHARACTER_LIMIT` becomes
  `READER_CHARACTER_LIMIT` and `ACTIONS_CHARACTER_LIMIT`, and
  `CLOUDFLARE_ACCESS_AUD` becomes `READER_ACCESS_AUD` and `ACTIONS_ACCESS_AUD`.
- Optional settings now treat a blank value as unset, so a line can be emptied
  instead of deleted.

### Security

- No change to service isolation. Credentials were never in the env files: they
  are Docker secrets, and the per-service `secrets:` list in `compose.yaml` is
  what keeps the SMTP password out of the Reader. Verified by inspection of a
  running stack.
- No secret path appears in `.env` any more, so there is no line an operator can
  turn into an inline credential by mistake.
- What the shared file does expose to every container is non-secret
  configuration: hostnames, usernames, allowlists and policies.

### Migration from 2.x

1. `cp config/mail-mcp.env.example .env`
2. Copy your values across from `local-config/*.env`, renaming the four
   variables listed above.
3. Delete `local-config/*.env`. Keep `local-config/secrets/` untouched.
4. `docker compose up -d`

## [2.1.0] - 2026-07-26

### Added

- in-chat approval through MCP Apps: the approval page is also served as a
  `ui://` resource that hosts render inline in the conversation;
- JSON approval endpoints on the Worker (`/approval/:id/app`,
  `app-approve`, `app-cancel`) with scoped CORS and a per-proposal capability
  token;
- URL-mode elicitation for clients that cannot render the app, with
  `APPROVAL_WAIT_MS` bounding how long a tool call waits for the outcome;
- opt-in stateful MCP transport, enabled for Actions only;
- multi-architecture container image published to GHCR on version tags, with
  SBOM, provenance and build attestation;
- `compose.build.yaml` override for building the image from source.

### Changed

- the Actions proxy no longer applies its idle timeout once the upstream has
  started responding, so a long-lived approval stream is not cut short.

### Security

- the message body and the approval secret never travel through the MCP host:
  the app fetches the proposal from the Worker and posts the secret back to it
  directly;
- no MCP tool can approve a proposal; the capability token alone does not
  authorize one either, since CSRF and the human secret are still required.

## [2.0.0] - 2026-07-25

### Added

- strict read-only IMAP Reader MCP;
- separate approval-gated Actions MCP;
- persistent Worker for immediate and scheduled SMTP delivery;
- approval-gated IMAP moves and restoration proposals;
- Cloudflare Access JWT validation and Actions proxy;
- exact Host header allowlists;
- recipient and mailbox policies;
- ambiguous-outcome states with no automatic retry;
- Docker Compose hardening and loopback binding by default;
- scheduled read-only digest prompt;
- Cloudflare Tunnel, Access, Claude, filter, and security guides.

### Security

- removed all deployment-specific personal data and credentials from the public
  distribution;
- made proxy trust depth explicit and disabled by default;
- separated MCP, queue, approval, IMAP, and SMTP credentials;
- added prompt-injection warnings to Reader outputs and action tools.
