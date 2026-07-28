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

### Promoted from STATUS.md §2b — these survived two sessions unchanged, so stop re-deriving them

- **Deltas compose; an edited field does not.** Two people each record three deaths on their own phone in a dead zone. Deltas land on 294, which is the truth; an edited head count is last-write-wins, lands on 297, and silently keeps three dead sheep in the count. **Ask this of any number the product lets a farmer change** — two offline devices is the normal case here, not the edge case.
- **A recount is absolute, and it RESETS rather than adds.** "I walked the camp and counted 297" is a stronger fact than arithmetic on a number just shown to be wrong. It cannot be modelled as a delta: that would need the device to know the true previous count, which is exactly what the farmer just discovered it did not.
- **Arrival order is not `occurred_at` order.** A server that steps a stored value by each incoming delta will be wrong. Re-derive a denormalised aggregate from the whole log over an immutable baseline, so the server and the offline client run the identical projection and cannot drift. This is the general shape for every aggregate this product adds.
- **Order a projection by a TOTAL order, never by `occurred_at` alone.** Day-grained captures stamp every event on a day with the same instant, so ties are ordinary. Sort by `(occurred_at, id)` on both sides — the id is a client UUIDv7, identical on both sides and time-ordered. `occurred_at` alone leaves the result to the query plan on one side and the capture-store append order on the other.
- **A field that exists everywhere except on a screen is null in every record you have.** Schema, wire contract and server write path all carrying a field proves nothing. Four fields were null in every row the product had ever produced because nothing ever asked for them.
- **A hand-written duplicate of a schema drifts silently, and in one direction.** Derive from the Zod schema with `z.infer`. A client type offering a value the server refuses queues a capture that can never be sent, and it reads as a sync bug rather than as the typo it is.
- **Any capture that CHANGES THE STATE ITS OWN VALIDATION READS must check idempotency BEFORE validating.** Otherwise a re-flush validates against the state the first flush already wrote, refuses itself, and jams the queue.
- **A 4xx and a 5xx are different animals in a flush.** A 4xx is the server refusing this record on its merits — it will refuse it again tomorrow, so set the item ASIDE (kept, never dropped) and continue the round. A 5xx or an unrecognised error is transient and aborts the round. A `return` on refusal strands every capture behind it, permanently.
- **`toISOString().slice(0,10)` is wrong for two hours a day in South Africa.** Use the farm's zone via `farmLocalDay`. This one keeps coming back — it has now been found in production code twice and in test assertions once.
- **A guard that only the server can run arrives after the truck has left.** Offline is the default state: if a rule decides whether something may happen, the device must be able to check it at capture. A server-only rule surfaces as a refusal days later, when the sale has already happened. Server-side enforcement is still required — it is the boundary — but it is not sufficient.
- **Refusing to half-build is a decision, not a delay.** A complete server capability with no client route reads to a farmer as missing functionality, and worse, a half-built path can make the product claim something it cannot show.

## Compliance gate on regulated code

**Any commit touching `jurisdictions/` or payroll domain code MUST run the `compliance-checker` agent before the commit. No exceptions.**

> **Point every review agent at [`docs/04-delivery/agent-context.md`](docs/04-delivery/agent-context.md) first.**
> It carries the repo map, the standing rules, the recurring defect classes and a **SHA-scoped clean
> ledger**, so a pass spends its budget on the diff instead of re-deriving orientation — the fourth
> pass cost ~583k tokens across three agents, much of it three agents learning the same things.
> ⛔ Every clean claim in it expires the moment its file changes; the staleness check is one `git diff`
> and it is not optional. **Update its ledger after every pass** — an untracked ledger is a liability.

- **Phase 3: per slice, never batched.** One rule, one diff, one review. Read the agent's output yourself — do not accept a summary of it, and do not let the green gate stand in for it. `pnpm verify` cannot tell you that overtime was classified against the wrong day's rate.
- **Elsewhere: batched is acceptable** — once over the branch before the PR, not once per commit.
- Also read `docs/00-business/legal-compliance.md` BEFORE writing the code, not after. It is a decaying document: re-verify every figure against the current Government Gazette rather than trusting the table.

## Where to look

- **Where are we? What is next? → `STATUS.md`** (read before planning; answer its open decisions with the owner)
- Working on a phase → `docs/04-delivery/phase-checklists.md`
- Naming, trademark, the codename → `docs/00-business/naming.md`
- Anything about the repo, licence, or commits → `docs/04-delivery/github-strategy.md`
- Need a requirement ID → `docs/01-requirements/functional-requirements.md`
- Touching the schema → `docs/03-architecture/database-schema.md`
- Touching payroll or compliance → `docs/00-business/legal-compliance.md` FIRST, then code
- Anything about sync → `docs/03-architecture/offline-sync.md`
