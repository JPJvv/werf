# Codex compatibility surface

Claude Code is the primary implementation environment for Werf. Canonical instructions live in
`../CLAUDE.md`, `../.claude/rules/` and `../docs/INDEX.md`.

`hooks.json` deliberately invokes the Claude-owned hooks. Files under `agents/` translate the
owner-triggered specialist roles for Codex; they may narrow a run but may not override the
Claude-owned role definitions or repository policy. The scripts under `hooks/` are legacy
compatibility copies and are not referenced by `hooks.json`; change the `.claude/hooks/` source,
not these copies.

Do not add project decisions here. If a Codex-specific workaround is unavoidable, document only
the tool interoperability issue and link to the canonical rule it implements.
