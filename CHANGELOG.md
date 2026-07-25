# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
