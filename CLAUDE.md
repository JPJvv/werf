# Werf — project memory

> **▶ Read [`STATUS.md`](STATUS.md) first.** It is the live pointer between sessions: which phase
> is where, what is merged, and the open decisions that block the next slice. It carries questions
> addressed to the repo owner — **ask them, do not guess the answers.** Update it at the end of
> every session and commit it with the work.

Offline-first PWA for South African farm management. Monorepo, TypeScript everywhere.

## Commands

```bash
pnpm dev              # all apps, watch mode
pnpm build            # turbo build, all packages
pnpm test             # vitest unit + integration
pnpm test:e2e         # playwright
pnpm lint             # eslint + prettier check
pnpm typecheck        # tsc --noEmit across workspaces
pnpm db:migrate       # drizzle-kit migrate against local postgres
pnpm db:generate      # generate migration from schema diff
pnpm db:seed          # seed dev data (3 farms: livestock, crop, mixed)
pnpm verify           # THE GATE: lint + typecheck + test + build. Must exit 0.
```

`pnpm verify` is the definition of done for any change. Run it before saying a task is complete.

## Architecture in one paragraph

React PWA → local SQLite (via PowerSync web SDK, OPFS) → PowerSync service → Postgres (+PostGIS) in AWS af-south-1. Reads and writes hit local SQLite always; the sync engine moves deltas. A separate NestJS API owns everything the client must not compute: payroll, compliance report generation, integrations, PDF export. Full detail: `docs/03-architecture/architecture.md`.

## Non-negotiable rules

- **Offline is the default state, not the error state.** Every write path must work with the network off. If you catch yourself writing `if (!navigator.onLine) throw`, stop — that is the bug.
- **Never hardcode a regulated number.** Minimum wage, BCEA threshold, UIF ceiling, deduction caps, withdrawal periods — all live in `regulatory_rates` with `effective_from`/`effective_to` and are looked up by date. A magic number in code is a defect even if it is today's correct value. See `docs/00-business/legal-compliance.md`.
- **Money is `numeric(14,2)` in Postgres and integer cents in TypeScript.** Never a JS float. Use the `Money` type in `@werf/core`.
- **Every domain table carries `farm_id`.** RLS enforces tenancy on every table with no exceptions. A query without a farm scope is a security bug.
- **Soft-delete only.** `deleted_at timestamptz`. Sync and audit both depend on tombstones; a hard `DELETE` breaks replication and destroys audit trails that compliance requires.
- **IDs are client-generated UUIDv7.** The client is offline and cannot ask the server for an ID. Never use a database sequence for a domain entity.
- **Timestamps are `timestamptz`, stored UTC, displayed in `Africa/Johannesburg`.** Capture `occurred_at` (when it happened on the farm) separately from `created_at` (when the row was written). They differ by days when a farmer syncs after a week in a signal dead zone.

## Code style

- Named exports. No default exports except React route components.
- Zod schemas in `@werf/core/schemas` are the single source of truth for validation. Derive TS types with `z.infer`; never hand-write a type that duplicates a schema.
- Server: NestJS modules, constructor injection, no service locator.
- Client: TanStack Query for server state, PowerSync watched queries for local state, `useState`/`useReducer` for UI state. No global store.
- Tailwind core utilities only, tokens from `@werf/ui`. No arbitrary values (`w-[137px]`) — add a token instead.
- **No theme conditionals in components.** `theme === 'dark' ? a : b` means the token system failed — fix the token. Tokens are stable across themes (`--soil-900` is always "the ink"); only their values change under `[data-theme]`.
- Errors: throw typed errors from `@werf/core/errors`. Never `throw new Error("string")` in domain code.

## Testing

- Domain logic (payroll, compliance rules, sync conflict resolution): unit tests, no mocks of our own code, table-driven where the SARS/BCEA rules are table-driven.
- API: integration tests against a real Postgres in testcontainers. Never mock the database.
- Offline behaviour: every sync test must exercise the network-off path. `docs/04-delivery/testing-strategy.md` has the required matrix.
- Do not write a test that asserts the implementation. Assert the behaviour a farmer or an auditor would observe.

## Repository etiquette

- Branch: `phase-N/short-description`.
- Conventional commits. Reference the FR or story ID: `feat(livestock): add weaning event capture (FR-112)`.
- One phase per PR unless the phase checklist says otherwise.
- Never commit `.env`, `*.pem`, or anything under `infra/secrets/`.

## Product decisions that look like bugs

- **Default theme is light and does NOT follow `prefers-color-scheme`.** Deliberate. A farmer who set their phone dark at night would find a mirror in their hand at noon in a crush. "Match my phone" is opt-in.
- **The home grid's tile order is fixed, never personalised.** Muscle memory is the entire value.
- **SMS is never a second factor.** SIM swap is industrialised in SA, and SMS is the one factor that fails with no signal. TOTP + passkeys both work offline. `ADR-0007`.
- **No biometrics for workers.** POPIA s26; consent from an employer to a farm worker is of questionable voluntariness. Owners choosing their own phone's fingerprint for their own account is a different consent posture entirely.
- **`PayrollRules` has one implementation and that is not over-engineering.** `ADR-0006` explains why this is the narrow case where the seam is justified.

## Gotchas that have bitten us

- PowerSync sync rules are **not** Postgres RLS. Both must be written, and they must agree. A permissive sync rule leaks data across farms even when RLS is correct, because sync bypasses PostgREST. Change one, change both, and there is a test for it (`packages/sync/test/tenancy.spec.ts`).
- PostGIS geometry does not sync to SQLite. Store canonical boundaries as `geometry` in Postgres for spatial queries, and a denormalised GeoJSON `text` column for the client. Both, always.
- Supabase Cloud has no South African region. Do not reach for it. We self-host on af-south-1. See `docs/03-architecture/adr/ADR-0002-data-residency.md`.
- The `regulatory_rates` lookup must be by `occurred_at`, not `now()`. Recalculating an old payslip at today's wage is a legal problem, not a rounding problem.
- Jurisdiction comes from **the farm**, never the user, the browser locale, or a default. A Free State farm is governed by South African law regardless of where its owner is logged in from.
- Commits must be authored by the repo owner's GitHub email or the contribution graph stays empty. Check `git log --format='%an <%ae>'` after the first session. See `docs/04-delivery/github-strategy.md`.

## Where to look

- **Where are we? What is next? → `STATUS.md`** (read before planning; answer its open decisions with the owner)
- Working on a phase → `docs/04-delivery/phase-checklists.md`
- Naming, trademark, the codename → `docs/00-business/naming.md`
- Anything about the repo, licence, or commits → `docs/04-delivery/github-strategy.md`
- Need a requirement ID → `docs/01-requirements/functional-requirements.md`
- Touching the schema → `docs/03-architecture/database-schema.md`
- Touching payroll or compliance → `docs/00-business/legal-compliance.md` FIRST, then code
- Anything about sync → `docs/03-architecture/offline-sync.md`
