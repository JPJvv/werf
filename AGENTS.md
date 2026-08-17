# Werf - Codex support adapter

Claude Code is the primary implementation environment for this repository. `CLAUDE.md`, its
`.claude/rules/` files and the project documents are the canonical working guidance. This file
exists only to orient Codex; it does not define a competing development process.

Before acting, Codex must:

1. Read `STATUS.md` and ask the owner about any unresolved decision that blocks the requested work.
2. Read `CLAUDE.md` completely and follow the task-specific `.claude/rules/` it routes to.
3. Use `docs/INDEX.md` to resolve document authority and the appropriate concern-specific source.
4. Preserve offline-first, tenancy, money, soft-delete, UUIDv7, timestamp, schema and testing rules
   exactly as Claude-owned guidance defines them.

Codex's role is to inspect, diagnose, review and make scoped improvements requested by the owner.
It must not reinterpret or override Claude's project rules, hooks, agent policy, phase gates or
capabilities. `.codex/` compatibility files may point to Claude-owned equivalents, but they are not
an independent source of product or architecture decisions.

The repository's review agents are owner-triggered only. Do not invoke one unless the owner asks.
`pnpm verify` is the definition of done for changes, and `STATUS.md` is updated with the evidence.

If this adapter conflicts with `CLAUDE.md`, `CLAUDE.md` wins. If implementation guidance conflicts
with an accepted ADR, legal source or requirement, follow the precedence in `docs/INDEX.md` and
surface the conflict instead of guessing.
