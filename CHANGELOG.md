# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
