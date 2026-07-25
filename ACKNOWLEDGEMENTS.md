**English** · [Italiano](ACKNOWLEDGEMENTS.it.md)

# Acknowledgements and prior art

Mail MCP Suite was designed after reviewing these public MCP projects:

- [nikolausm/imap-mcp-server](https://github.com/nikolausm/imap-mcp-server),
  an IMAP-oriented MCP server distributed under the MIT License;
- [samihalawa/mcp-server-smtp](https://github.com/samihalawa/mcp-server-smtp),
  an SMTP-oriented MCP server.

They are cited as conceptual references for the problem space. This repository
does not vendor their source code.

At the time this notice was written, `samihalawa/mcp-server-smtp` did not declare
a license in a root `LICENSE` file or its `package.json`. No code from that project
may be copied into this repository without a compatible license or the copyright
holder's permission.

Mail MCP Suite differs in its security model:

- separate Reader and Actions MCP endpoints;
- mail credentials withheld from the Actions MCP;
- a non-MCP worker for delivery and IMAP mutation;
- explicit human approval for every send, schedule, move, and restore;
- deterministic mail filters and read-only digests recommended over autonomous
  AI sorting.
