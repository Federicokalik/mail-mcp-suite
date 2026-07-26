# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
