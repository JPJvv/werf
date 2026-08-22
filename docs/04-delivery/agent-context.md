# Agent context — orientation for review agents

> **Who this is for:** the `reviewer`, `sync-auditor` and `compliance-checker` agents, and any
> subagent asked to audit this repo. **Humans:** see [STATUS.md](../../STATUS.md) instead.
>
> **Why it exists.** The fourth review pass cost ~583,000 tokens across three agents (214k / 188k /
> 181k), and a large share went on three agents independently working out where things live and
> what the standing rules are. This file answers that once.
>
> **Boundary correction (ADR-0013):** references below to withdrawal/PHI “guards,” legal product
> authority or mandatory reporting describe superseded implementation history. Review the current
> code as a private farmer-controlled logbook with advisory interval calculations. Tenancy,
> authentication, data integrity and explicitly farmer-triggered exports remain security concerns.

---

## ⛔ What this file is NOT

**It does not narrow what you audit, and it does not tell you anything is already cleared.**

An earlier draft carried a "verified clean, do not re-audit" ledger. It was removed deliberately.
This repo has measured four times that a clean claim goes stale in one particular way — the premise
underneath it changes, in the same branch, often by the same author:

> `withdrawal.ts`'s own header said *"both entry points read BOTH routes a dose takes."* True when
> written. False three commits later. The guard built on it stayed narrow, and pass four found it.

A ledger of cleared files is that same claim, one level up, and it would suppress precisely the
finding that matters. **So: audit everything in your range. Read whatever you need. Nothing below
is permission to skip.** This file is a map, not a filter.

---

## 1. Repo map — so you do not have to search for these

| What | Where |
|---|---|
| **Private withdrawal-reminder calculation (server)** — FR-131 | `apps/api/src/livestock/livestock.service.ts` — `latestMeatClearForAnimal`, `latestMeatClearForMob`, `mobMembership`, `mobMembersOn` |
| **Private withdrawal-reminder calculation (client)** | `apps/web/src/livestock/withdrawal.ts` |
| **The outbox flush** — ordering, 4xx/5xx, idempotency | `apps/web/src/sync/Outbox.tsx` |
| **Shared write discipline** — every capture goes through here | `apps/api/src/common/event-capture.ts` (`insertEvent`, `assertCanCapture`, `assertOwnedReferences`, `assertHerdScoped`) |
| **Tenancy classification** (sync rules ≠ RLS — both required, and they must agree) | `packages/sync/src/index.ts` + `packages/sync/test/tenancy.spec.ts` |
| **Zod schemas — the single source of truth** | `packages/core/src/schemas/` (`events.ts`, `livestock.ts`) |
| **Farm-zone date handling** | `apps/web/src/farmTime.ts`, `apps/api/src/common/farm-time.ts` |
| **Evidence pack (FR-603)** | `apps/api/src/livestock/evidence-pack.pdf.ts`, `packages/domain/src/livestock/evidence.ts` |
| **Migrations** | `packages/db/migrations/` |
| **Test DB harness** | `packages/db/src/testing.ts` |

**Legal source of truth:** `docs/00-business/legal-compliance.md` — read it before writing or
reviewing regulated code, and treat it as decaying: re-verify figures against the current Government
Gazette rather than trusting the table.

**Current state and open findings:** `STATUS.md` — §1 for position, §2f for the findings open right
now. It is the authority; anything in this file that disagrees with it is stale.

---

## 2. Standing rules — already paid for

Promoted from `CLAUDE.md` and STATUS.md, so you can check code against them rather than rediscover
them. **Finding a violation of one of these is a finding, not a duplicate.**

1. **Offline is the default state.** `if (!navigator.onLine) throw` in a write path is the bug.
2. **A guard that only the server can run arrives after the truck has left.** If a rule decides
   whether something may happen, the device must check it at capture — *and* the server must still
   enforce it. Both, always.
3. **A guard's INPUTS must arrive before the thing it guards.** FK ordering answers "will this row
   insert", not "will the check have its evidence".
4. **Order any projection by the TOTAL order `(occurredAt, id)`, never `occurredAt` alone.**
   Day-grained captures all stamp `T12:00:00.000Z`, so ties are ordinary *by construction*.
5. **Compare two clocks at the COARSER precision**, in farm-local days, inclusive at both ends.
6. **A food-safety boundary must fail toward BLOCKING.**
7. **Deltas compose; an edited field does not.** Re-derive aggregates from the whole log over an
   immutable baseline, running the identical projection on both sides.
8. **Any capture that changes the state its own validation reads must check idempotency BEFORE
   validating**, or a re-flush validates against what the first flush wrote and jams the queue.
9. **4xx = set the item ASIDE (kept, never dropped) and continue the round. 5xx or unrecognised =
   abort the round.** A `return` on refusal strands every capture behind it, permanently.
10. **Never hardcode a regulated number.** `regulatory_rates`, looked up by `occurred_at`, never `now()`.
11. **Jurisdiction comes from the FARM**, never the user, the browser locale, or a default.
12. **Money is integer cents.** Soft-delete only. `farm_id` on every domain table. Client-generated UUIDv7.
13. **An assertion that cannot fail is not a test.** Ask of every test: what edit would this catch?
14. **A test on each side of a seam is not a test of the seam.** Could both be green while the thing
    they describe is broken end to end?
15. **Never derive an identity from `useMemo`.** It is a performance hint, not a cache guarantee.

## 3. Defect classes that have RECURRED — cheap to grep, high yield

| Pattern | Times found | Note |
|---|---|---|
| `toISOString().slice(0, 10)` | **4** | Wrong for two hours a day in South Africa. Production code ×2, test assertions ×1, e2e seed ×1. Use `farmLocalDay`/`farmDay`. ⚠️ A `Date.UTC(...)`-anchored civil-date helper is **fine** — check before flagging |
| A comment or module header whose premise changed | **3** | Especially `withdrawal.ts` and migration comments |
| A checklist line made stale by its own diff | **3** | `phase-checklists.md` — check ticks against code that exists |
| `??` where `undefined` and `null` mean opposite things | 1 | Nullish silently picks the dangerous reading |
| A field on the wire and in the schema that no screen sets | 1 | Null in every row the product ever produced |
| Read path fixed, matching write path left alone | 2 | Two findings, not one |

---

## 4. Operational notes

- **Do not run `pnpm verify`, `pnpm test` or `pnpm test:e2e`.** The orchestrator owns the gate, and
  the integration tier spins up testcontainers — two concurrent runs flake it. `pnpm typecheck` is
  fine. Ask for a gate result rather than producing one.
- **Report:** severity, `file:line`, the concrete failure a farmer or an auditor would observe, and
  the fix. Concrete beats comprehensive.
- **Say what you checked and found sound**, in a sentence each — it tells the next reader what your
  pass actually covered, without becoming a claim that it never needs checking again.
- **`compliance-checker` runs only when the repo owner asks for it.** See the compliance gate in
  `CLAUDE.md`.

> **This makes a pass cheaper to run. It does not make one unnecessary.** Four passes have now each
> found real defects in the previous pass's fixes.
