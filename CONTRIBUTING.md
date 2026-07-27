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

## Releasing

Releases are cut from `main` and are always a deliberate act: nothing publishes on a
merge, because an image someone has already pulled cannot be recalled.

1. Bump `version` in `package.json`, add the matching `## [x.y.z]` section to
   `CHANGELOG.md`, and update the image tag quoted in `README.md`, `README.it.md`
   and `docs/installation*.md`.
2. Merge that to `main`.
3. Run the **Release** workflow from the Actions tab, or
   `gh workflow run release.yml --ref main`.

The workflow reads the version from `package.json`, refuses to continue if the
changelog has no section for it or if the tag already exists, then creates and
pushes `vx.y.z`, publishes the multi-architecture image to GHCR with provenance
and an SBOM, and opens the GitHub release with the changelog section as its notes.

Pushing a `vx.y.z` tag by hand does the same thing, minus the tag creation. In that
path the workflow additionally checks that the tag and `package.json` agree, so a
mistyped tag fails before anything is published.

## Licensing

By contributing, you agree that your contribution is licensed under
`AGPL-3.0-only`. Do not submit code copied from a source without a compatible
license and preserved notices.

`skills/` is the one place holding third-party material, imported with
`git subtree` and left unmodified. Do not edit those files: send the change
upstream and pull it back. Every entry there is recorded in
[ACKNOWLEDGEMENTS.md](ACKNOWLEDGEMENTS.md) with its licence status.
