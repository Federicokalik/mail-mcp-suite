**English** · [Italiano](README.it.md)

# Vendored skills

This directory holds third-party material that ships with the repository but is
not part of the running services. Nothing here reaches the Docker image: the
`Dockerfile` copies named paths, and `skills` is not one of them.

## framix-email-html-mjml

An MJML authoring skill for Claude Code, used to compose the templates that
`mail_send` and `mail_schedule` accept in their `mjml` field. It is guidance for
whoever writes the template; the compilation itself happens server-side, in
Actions, and does not use this directory.

- Upstream: [framix-team/skill-email-html-mjml](https://github.com/framix-team/skill-email-html-mjml)
- Author: [Framix](https://www.framix.net/)
- Imported at: `skills/framix-email-html-mjml`, via `git subtree --squash` from
  `master`

### Licence status

The upstream README states `MIT` under a `License` heading, but the repository
contains no `LICENSE` file, no copyright line and no year, and the GitHub API
reports `license: null`. This was checked on 2026-07-27, against a tree last
pushed on 2026-02-28.

MIT asks that the copyright notice be preserved in copies. There is no notice to
preserve here, which is why this section exists: the grant is stated but
incomplete. The material is vendored unmodified, with its provenance recorded, on
the strength of that stated grant. If upstream publishes a `LICENSE` file, replace
this section with the real terms. If upstream declares terms incompatible with
`AGPL-3.0-only`, remove the directory.

### Updating

```sh
git subtree pull --prefix=skills/framix-email-html-mjml \
  https://github.com/framix-team/skill-email-html-mjml master --squash
```

Do not edit the vendored files. Local changes turn every future pull into a
conflict to resolve, and they make it impossible to tell at a glance what came
from upstream. Anything this project needs on top belongs outside this directory.

### Using it

Point your Claude Code skills directory at the skill folder, or copy it:

```sh
cp -r skills/framix-email-html-mjml/email-html-mjml ~/.claude/skills/
```

The skill's own README documents its workflow and its `npx mjml` requirement.
That requirement applies to composing templates locally; this project compiles
MJML itself and does not need the MJML CLI at runtime.
