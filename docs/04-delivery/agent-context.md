# Agent context — read this FIRST, before STATUS.md

> **Who this is for:** the `reviewer`, `sync-auditor` and `compliance-checker` agents, and any
> subagent asked to audit this repo. **Humans:** see [STATUS.md](../../STATUS.md) instead.
>
> **Why it exists.** The fourth review pass cost ~583,000 tokens across three agents (214k / 188k /
> 181k), and a large share of that was three agents independently re-deriving the same things: where
> the guard lives, what the standing rules are, which files were already cleared. This file is the
> shared answer, so each pass spends its budget on the diff rather than on orientation.

---

## 1. ⛔ The one rule that makes this file safe

**Every "verified clean" claim below is scoped to a COMMIT SHA, and it expires the moment that file
changes.** This repo has measured four times that a clean claim goes stale in exactly one way — the
premise it rested on changes underneath it, in the same branch, often by the same author:

> `withdrawal.ts`'s own header said *"both entry points read BOTH routes a dose takes."* True when
> written. False three commits later. The guard built on it stayed narrow, and pass four found it.

So **never trust a row in §5 without running its staleness check.** It is one command:

```bash
git diff --stat <CLAIM_SHA>..HEAD -- <path>     # empty output = the claim still holds
```

Empty diff → trust it, skip it, spend the tokens elsewhere. Non-empty → **the claim is void, audit
the file from scratch.** A ledger that is trusted blindly is worse than no ledger, because it
suppresses exactly the finding that matters.

---

## 2. Repo map — so you do not have to search for these

| What | Where |
|---|---|
| **The withdrawal guard (server)** — the SEV-1 area, FR-131 | `apps/api/src/livestock/livestock.service.ts` — `latestMeatClearForAnimal`, `latestMeatClearForMob`, `mobMembership`, `mobMembersOn` |
| **The withdrawal guard (client/at-capture)** | `apps/web/src/livestock/withdrawal.ts` |
| **The outbox flush** — ordering, 4xx/5xx, idempotency | `apps/web/src/sync/Outbox.tsx` |
| **Shared write discipline** — every capture goes through here | `apps/api/src/common/event-capture.ts` (`insertEvent`, `assertCanCapture`, `assertOwnedReferences`, `assertHerdScoped`) |
| **Tenancy classification** (sync rules ≠ RLS, both required) | `packages/sync/src/index.ts` + `packages/sync/test/tenancy.spec.ts` |
| **Zod schemas — the single source of truth** | `packages/core/src/schemas/` (`events.ts`, `livestock.ts`) |
| **Farm-zone date handling** | `apps/web/src/farmTime.ts`, `apps/api/src/common/farm-time.ts` |
| **Evidence pack (FR-603)** | `apps/api/src/livestock/evidence-pack.pdf.ts`, `packages/domain/src/livestock/evidence.ts` |
| **Migrations** | `packages/db/migrations/` (0019 is the newest) |
| **Test DB harness** | `packages/db/src/testing.ts` |

**Legal source of truth:** `docs/00-business/legal-compliance.md` — read before writing regulated
code, and treat it as decaying: re-verify figures against the Gazette rather than trusting the table.

---

## 3. Standing rules — already paid for, do not re-derive

These are promoted from `CLAUDE.md` and STATUS.md. **Check code against them; do not spend tokens
rediscovering them.**

1. **Offline is the default state.** `if (!navigator.onLine) throw` in a write path is the bug.
2. **A guard that only the server can run arrives after the truck has left.** If a rule decides
   whether something may happen, the device must check it at capture — *and* the server must still
   enforce it. Both, always.
3. **A guard's INPUTS must arrive before the thing it guards.** FK ordering answers "will this row
   insert", not "will the check have its evidence."
4. **Order any projection by the TOTAL order `(occurredAt, id)`, never `occurredAt` alone.**
   Day-grained captures all stamp `T12:00:00.000Z`, so ties are ordinary *by construction*.
5. **Compare two clocks at the COARSER precision**, in farm-local days, inclusive at both ends.
6. **A food-safety boundary must fail toward BLOCKING.**
7. **Deltas compose; an edited field does not.** Re-derive aggregates from the log over an immutable
   baseline, with the identical projection on both sides.
8. **Any capture that changes the state its own validation reads must check idempotency BEFORE
   validating**, or a re-flush jams the queue.
9. **4xx = set the item ASIDE and continue the round. 5xx/unknown = abort the round.** A `return` on
   refusal strands every capture behind it permanently.
10. **Never hardcode a regulated number.** `regulatory_rates`, looked up by `occurred_at`, never `now()`.
11. **Jurisdiction comes from the FARM**, never the user, browser locale, or a default.
12. **Money is integer cents.** Soft-delete only. `farm_id` on every domain table. Client UUIDv7.
13. **An assertion that cannot fail is not a test.** Ask of every test: what edit would this catch?
14. **A test on each side of a seam is not a test of the seam.** Could both be green while the thing
    they describe is broken end to end?
15. **Never derive an identity from `useMemo`.** It is a performance hint, not a cache guarantee.

## 4. Defect classes that have RECURRED — grep for these first, they are cheap

| Pattern | Times found | Note |
|---|---|---|
| `toISOString().slice(0, 10)` | **4** | Wrong for two hours a day in SA. Prod code ×2, test assertions ×1, e2e seed ×1. Use `farmLocalDay`/`farmDay`. A `Date.UTC(...)`-anchored civil-date helper is *fine* — check before flagging |
| A comment/header whose premise changed | **3** | Especially in `withdrawal.ts` and migration comments |
| A checklist line made stale by its own diff | **3** | `phase-checklists.md` — check ticks against code |
| `??` where `undefined` and `null` mean opposite things | 1 | Nullish silently picks the dangerous reading |
| A field on the wire and in the schema that no screen sets | 1 | Null in every row ever produced |
| Read path fixed, matching write path not | 2 | Two findings, not one |

---

## 5. The clean ledger — SHA-scoped, expires on change

**Claim SHA `7917645`** (pass four, 2026-07-28). Run the §1 staleness check before trusting any row.

| Area | Verified clean at `7917645` |
|---|---|
| **Tenancy, all three layers** | Migrations 0008–0019 all carry `farm_id` under `FORCE ROW LEVEL SECURITY`; no `DELETE` granted; all PKs client UUIDv7. `species_gestation` is correctly farm-less `reference-global` (RLS `FOR SELECT USING (true)`, `GRANT SELECT` only; the seeding INSERT is safe because the migration role is `BYPASSRLS`) |
| **`tenancy.spec.ts`** | Genuinely derives its table list from the drizzle schema via `getTableName`/`is(PgTable)`, compares in BOTH directions, and fails the build on an unclassified table. Not weakened |
| **Outbox ordering + its tests** | land → mobs → animals → identifiers → **moves → health** → tallies → weights → breeding → lifecycle → theft → rainfall. `Outbox.test.tsx` asserts real relative indices |
| **4xx/5xx discipline** | `isRefusal` excludes 401/408/429; refusal → `continue`; 5xx → abort; queue never cleared on auth failure |
| **Offline write paths** | No `navigator.onLine` outside `useSyncStatus` (a display read). No `await` on network in a capture path |
| **Regulated numbers** | None hardcoded anywhere on the branch. Vet-product lookup resolves by treatment day + FARM jurisdiction, clear date frozen onto the event |
| **Money** | Integer cents throughout; no float crosses the wire or reaches the DB |
| **POPIA** | No biometrics, no worker tracking, no personal data in logs, no farmer-facing copy in audit fields, no `suspect` field in the theft chain |
| **Server withdrawal chain** | Day-grained both sides at the coarser precision, farm-local, inclusive both ends, fails toward blocking, membership from the append-only move log and never `animals.mob_id` |
| **Commit hygiene** | All commits authored by the repo owner's email; conventional; no secrets, `.env`, or build output tracked |

⛔ **NOT clean, and open as at `7917645`** — do not re-report these as new, but DO check any fix:
`AdjustMobScreen.tsx:128` (SEV-1, memoised capture id) · `RecordPregnancyScreen.tsx:116,140` (SEV-2,
unsendable diagnosis) · `withdrawal.ts:146-153` (SEV-2, blind to carried-in mob doses) ·
`Outbox.tsx:494-507` (SEV-2, refused evidence does not hold back its disposal) ·
`RecordLossScreen.tsx:163` (SEV-3, death cannot be back-dated) · `withinWithdrawal` unread/untested ·
`withdrawal.ts:60-62` (MED, missing `id` tiebreaker). Full detail: STATUS.md §2f.

---

## 6. How to run a pass cheaply

**Give each agent this file plus the diff range.** They should:

1. Read this file. **Do not read all 720 lines of STATUS.md** — read §2f (the open findings) and the
   one prior section naming the area under review.
2. Run the §1 staleness check for the rows relevant to the diff. Skip what is still clean.
3. Spend the budget on `git diff <range>` and the files it touches.
4. **Do not run `pnpm verify`, `pnpm test`, or `pnpm test:e2e`** — the orchestrator owns the gate and
   the integration tier spins up testcontainers. `pnpm typecheck` is fine.
5. Report: severity, `file:line`, the concrete failure a farmer or auditor would observe, the fix.
   State briefly what was verified clean **and at which SHA**, so §5 can be updated.

**After every pass, update §5's claim SHA and rows, and §4's counts.** That is the "update each time
it runs" step — this file is only worth its keep if the ledger tracks HEAD.

> **What this does NOT do.** It does not make a pass optional. Four passes have each found real
> defects in the previous pass's fixes. This file makes a pass *cheaper*, not unnecessary.
