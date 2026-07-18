# Security Policy

Werf holds farm workers' identity numbers, banking details, wages, and injury
records — data belonging to people who did not choose this software — as well as
animal inventory with GPS, which is effectively a stock-theft map. We take
reports seriously.

## Reporting a vulnerability

Do **not** open a public issue for a security problem. Email the maintainer
directly and allow a reasonable window for a fix before any disclosure. Include
steps to reproduce, affected versions, and impact.

## Handling of secrets and personal data

- Secrets never enter the repository. `.env*`, `*.pem`, and `infra/secrets/**`
  are git-ignored and denied to tooling in `.claude/settings.json`.
- `gitleaks` runs in CI and as a pre-commit hook.
- Seed and test data are synthetic and obviously fake (deliberately invalid SA
  ID checksums). No real farm, worker, or pilot data is ever committed — that
  would be a POPIA breach in public.
- Authentication: passkeys (WebAuthn) preferred, TOTP fallback, recovery codes.
  SMS is never a second factor. See docs/03-architecture/adr/ADR-0007-authentication.md.

If a secret is ever pushed, treat it as compromised the moment it lands: rotate
it first, then clean history. Rewriting history alone is not sufficient.
