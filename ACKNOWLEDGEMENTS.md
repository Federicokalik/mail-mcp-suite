**English** · [Italiano](ACKNOWLEDGEMENTS.it.md)

# Acknowledgements and prior art

Mail MCP Suite was designed after reviewing these public MCP projects:

- [nikolausm/imap-mcp-server](https://github.com/nikolausm/imap-mcp-server),
  an IMAP-oriented MCP server distributed under the MIT License;
- [samihalawa/mcp-server-smtp](https://github.com/samihalawa/mcp-server-smtp),
  an SMTP-oriented MCP server.

They are cited as conceptual references for the problem space. No source code from
either project is vendored here.

At the time this notice was written, `samihalawa/mcp-server-smtp` did not declare
a license in a root `LICENSE` file or its `package.json`. No code from that project
may be copied into this repository without a compatible license or the copyright
holder's permission.

## Vendored material

One third-party work does ship inside this repository:

- [framix-team/skill-email-html-mjml](https://github.com/framix-team/skill-email-html-mjml)
  by [Framix](https://www.framix.net/), an MJML authoring skill for Claude Code,
  imported unmodified at `skills/framix-email-html-mjml` with `git subtree`.

Its README declares `MIT` under a `License` heading, but the repository carries no
`LICENSE` file, no copyright line and no year, and the GitHub API reports
`license: null`. That was the state on 2026-07-27. MIT asks that a copyright notice
be preserved in copies, and here there is none to preserve, so the grant is stated
but incomplete. The work is included on the strength of that stated grant, kept
unmodified, and recorded here rather than absorbed silently. A `LICENSE` file has
been requested upstream in
[framix-team/skill-email-html-mjml#2](https://github.com/framix-team/skill-email-html-mjml/issues/2).
Replace this paragraph with the real terms once it lands; remove the directory if
the terms turn out to be incompatible with `AGPL-3.0-only`.

See [skills/README.md](skills/README.md) for the import and update commands.

Mail MCP Suite differs in its security model:

- separate Reader and Actions MCP endpoints;
- mail credentials withheld from the Actions MCP;
- a non-MCP worker for delivery and IMAP mutation;
- explicit human approval for every send, schedule, move, and restore;
- deterministic mail filters and read-only digests recommended over autonomous
  AI sorting.
