**English** · [Italiano](CONTRIBUTING.it.md)

# Contributing

Contributions are welcome. Security boundaries are part of the public API, so
changes that weaken them require exceptional justification.

## Development

```sh
npm ci --ignore-scripts
npm run check
npm run smoke
```

Do not use a real mailbox in automated tests. Tests must use loopback services,
fake credentials, and reserved example domains.

## Pull requests

A pull request should:

- explain the user-visible behavior and threat-model impact;
- include tests for authorization and failure states;
- preserve the Reader's strict read-only behavior;
- avoid automatic retries after ambiguous SMTP or IMAP outcomes;
- avoid adding delete, Trash, or autonomous mutation behavior by default;
- update documentation and configuration examples;
- contain no credentials, real email addresses, private domains, LAN addresses,
  approval URLs, message contents, or outbox data.

Run a secret scanner before pushing. At minimum, inspect:

```sh
git diff --check
rg -n --hidden \
  '(password|secret|token|authorization|@[A-Za-z0-9.-]+\.[A-Za-z]{2,})' \
  --glob '!.git/**' \
  --glob '!package-lock.json'
```

The command intentionally produces false positives in documentation and schemas.
Review every match rather than blindly deleting it.

## Licensing

By contributing, you agree that your contribution is licensed under
`AGPL-3.0-only`. Do not submit code copied from a source without a compatible
license and preserved notices.

`skills/` is the one place holding third-party material, imported with
`git subtree` and left unmodified. Do not edit those files: send the change
upstream and pull it back. Every entry there is recorded in
[ACKNOWLEDGEMENTS.md](ACKNOWLEDGEMENTS.md) with its licence status.
