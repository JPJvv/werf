# Start here

This is an active repository, not a specification bundle waiting to be initialised. **Never delete
or recreate `.git`.** The branch history contains the delivery record and is the recovery mechanism
for project documentation.

## Prerequisites

- Node.js 22.13 or newer
- pnpm at the version pinned in the root `package.json`
- Git
- Docker Desktop for the Postgres/Testcontainers integration tier
- Chromium installed through Playwright for `pnpm test:e2e`

```powershell
node --version
pnpm --version
git --version
docker version
```

## Open the project safely

```powershell
git status --short --branch
git log -5 --oneline
pnpm install --frozen-lockfile
```

Read these in order:

1. [`STATUS.md`](STATUS.md)—the current branch, verification evidence, owner decisions and next slice.
2. [`CLAUDE.md`](CLAUDE.md)—standing architecture and compliance rules.
3. [`docs/04-delivery/phase-checklists.md`](docs/04-delivery/phase-checklists.md)—the executable phase gate.
4. The domain document named by `CLAUDE.md` for the files you will touch.

If `STATUS.md` and the checked-out branch disagree, stop and reconcile them before planning. This
exact mismatch has previously opened the workspace on Phase 1 while the active Phase 2 branch was
more than one hundred commits ahead.

## Local environment

Copy `.env.example` to an ignored local environment file and fill it locally. Never commit `.env`,
keys, certificates, database dumps or real farm/worker data.

Start the database only when needed:

```powershell
pnpm db:up
pnpm verify
pnpm test:e2e
```

`pnpm verify` is the code gate. It includes `pnpm project:check`, which keeps the current handoff
short and prevents the roadmap and phase checklist from silently naming different work. Browser e2e
is separate because it needs Chromium; CI runs both lanes.

## Working discipline

- Create or use the phase branch named in `STATUS.md`; do not work on `main`.
- Preserve unrelated and untracked user files.
- Use client UUIDv7 IDs, soft deletes, farm scoping and integer cents.
- Every capture path must work without network.
- Read `docs/00-business/legal-compliance.md` before regulated work.
- Review agents are owner-triggered only. Regulated code is not merge-ready until the requested
  compliance pass is complete, even when `pnpm verify` is green.
- Update and commit `STATUS.md` with each completed slice.

## Current delivery sequence

```text
0 Scaffold → 1 Shell/auth → 2 Livestock → 3 Offline sync → 4 Crops
           → 5 Labour/wages → 6 Finance/compliance → 7 Hardening/pilot
```

The next phase is **offline sync**, not payroll: `@werf/sync` currently provides Phase 2 local
adapters, while the accepted architecture requires SQLite/OPFS + PowerSync replication before a
second large offline domain is added.
