# STATUS — current project handoff

> Read this before planning. This file records current state, owner decisions, verification evidence,
> and the next executable slice. Historical session narratives belong in git history, not here.

**Last updated:** 2026-08-13 (owner-triggered `sync-auditor` + `compliance-checker` + `reviewer` pass,
run together at JP's request — "run all relevant agents ... report back what blocks progress." ✅
**Compliance-checker cleared FR-131 with zero findings — the sole recorded merge blocker is closed.**
`sync-auditor` found 2 MEDIUM + 1 LOW in the new attachments module (not FR-131), all fixed same
session under §6 clause 3. `reviewer` independently reproduced every load-bearing STATUS.md claim
and found no contradictions. See §3/§4 for full detail. Prior entry, still true: 3f–3i worked per
JP's "complete as much of 3f-3i as possible" — 3g/3h/3i(a)/3i(b)/3i(d) closed, 3f half-closed
(queue-survival bug found+fixed, read-set window left as an owner decision), 3i(c) deliberately not
started — see §5)

**Active branch:** `phase-3/powersync-foundation`, off `main` @ `13a0d46`. Not pushed yet — local
commits only, awaiting the owner's go-ahead to push/open a PR.

**Remote state:** Phase 2 merged to `main` via PR #3 (`13a0d46`); both CI lanes were green at merge

## 1. Delivery position

| Phase | State | Evidence / boundary |
|---|---|---|
| 0 — Scaffold | Merged | `main` |
| 1 — App shell, auth & 2FA | Merged | PR #2, `9452ebc` |
| 2 — Livestock | ✅ **Merged** | `main` @ `13a0d46` (PR #3, 2026-08-08). Tenth pass cleared — no SEV-1/SEV-2 from `reviewer`, `sync-auditor` or `compliance-checker`. MED/LOW fixed under §6 clause 3 or filed as issues #4–#9 (open, tracked on `main`, not merge blockers) |
| 3 — Offline sync | 🔶 In progress — 3a/3b/3c/3d done, 3e started (mobs/tallies), 3g/3h/3i(a)/3i(b)/3i(d) done, 3f half-done, 3i(c) not started, unmerged | `phase-3/powersync-foundation`: 3a–3d as before, plus real app-level down-sync for mobs/tallies (`SyncConnectionProvider` + `HydratedLivestock.tsx`), tripwire 3e (issue #8) CLOSED and proven both by fakes and by the real service. ✅ `sync-auditor` pass + re-pass over 3e: every finding closed, including Finding 2 (2026-08-13 — partitioning retired, migration 0021, see §3). 2026-08-13: 3g (additive-migration test), 3h (sync health surface) and 3i(a)/(d) (attachments schema/tenancy, photo_key pin) CLOSED; 3f's queue-survival half CLOSED (found+fixed a real quota-eviction bug), its retention read-set half left ☐ as an owner decision (§3); 3i(b) (API upload module — presigned PUT with server-side checksum enforcement, checksum-verified finalize, MinIO/S3 adapter) CLOSED, 9/9 tests green against real Postgres + real MinIO; 3i(c) (client blob queue) deliberately NOT started — see §5. ✅ **2026-08-13 (later same day): the owner-triggered `compliance-checker` pass ran and CLEARED — APPROVABLE, zero findings.** The sole recorded merge blocker is closed. Same session, `sync-auditor` re-pass over `dd49a20..HEAD` found 2 MEDIUM + 1 LOW in the new attachments module (id-conflict checksum bypass, cross-farm id collision crash, missing `updated_at` bump on finalize) — all three fixed under §6 clause 3, each with a test watched to FAIL first. `reviewer` independently reproduced every load-bearing STATUS.md claim (test counts, bundle size, migration 0021, real-Postgres/real-MinIO attachments tests) with no contradictions. Remaining, separately — none of these are audit/compliance blockers: 3e scope (animals/moves/health hydration) not started, 3f's retention-window is an open owner decision, 3i(c) deliberately deferred. See §3/§4/§5 |
| 4 — Crops & fields | Not started | Blocks, plantings, sprays, PHI and harvest move here; they were incorrectly still promised by the old Phase 2 roadmap |
| 5 — Labour & wages | Not started | Build may use placeholder rate rows; deployment requires verified Gazette sources and external labour-law review |
| 6 — Finance & compliance packs | Not started | Includes evidence packs, obligations, fuel/refund and reporting |
| 7 — Hardening & pilot | Not started | Performance, security review, deployment, pilot and launch readiness |

## 2. Audit findings closed (Phase 0–2, historical)

Full detail lives in git history and the merged PR #3, not here (this file's own rule: session
narrative belongs in git history). Summary: wrong-branch-on-start, an oversized handoff doc, two
incompatible phase maps, the sync-architecture-ahead-of-implementation gap, a noisy accessibility
fixture, human-gated regulated verification, a false uncached-gate timeout, and missing FR-101
capture controls — all closed before the Phase 2 merge (`13a0d46`).

## 3. Owner decisions

✅ **Closed 2026-08-13 — owner-triggered `compliance-checker` pass over the full branch
(`13a0d46..HEAD`) ran at JP's request ("run all relevant agents ... report back what blocks
progress") and CLEARED: APPROVABLE, zero findings.** This is the pass §1/this file's own
"declined not yet" entry from earlier the same day was waiting on — JP's later message this
session is treated as the owner trigger it was waiting for, made explicit here so the
authorization is on the record. Checked and sound: the FR-131 `mergeById` fix (all three call
sites, traced end-to-end including the `events_default` partition-alias supply line it depends
on), no hardcoded regulated numbers, POPIA (no worker-biometric path, `attachments` table
structurally cannot name a human subject, RLS/sync-tenancy agreement), money handling (untouched
by this diff), commit authorship. Payroll/`regulatory_rates` rules were out of scope — this branch
touches no payroll code — and are explicitly NOT claimed clean; they need their own pass when the
labour phase starts. Full agent output not reproduced here per this file's own "session narrative
belongs in git history" rule — this session's commit carries it.

✅ **Closed 2026-08-13 — owner-triggered `sync-auditor` pass over `dd49a20..HEAD` (the attachments
module, migrations 0021/0022, the quota-retry write path, the sync health surface): 2 MEDIUM + 1
LOW, no tenancy leak, all fixed same session under §6 clause 3 (mechanical, file-confined, each
covered by a test watched to FAIL against the pre-fix code first).** (1) `createAttachment`'s
id-conflict branch never compared the incoming checksum/size/mimeType/subjectId against the
existing row — a client bug reusing an id for different content would silently get back the FIRST
capture's presigned URL, and the new bytes could never PUT successfully; fixed by refusing with
`ConflictError` on any mismatch. (2) The same branch force-cast an `undefined` row when the id
collision was cross-farm (global PK, farm-scoped select finds nothing) — an unhandled 500 that the
outbox's own retry rule (a 5xx aborts and retries the whole round) would have retried forever for
an id that can never succeed; fixed by refusing explicitly instead of crashing. (3)
`finalizeAttachment` never bumped `updated_at` on the `pending`→`finalised` transition — an
existing gap `livestock.service.ts`'s `mobs` update already had, extended rather than introduced
here; fixed. All three: `apps/api/src/attachments/attachments.service.ts` +
`attachments.integration.test.ts` (3 new tests, 12/12 passing). `reviewer`, run the same session,
independently reproduced every load-bearing claim in this file (uncached `pnpm verify`: 104 files/
1089 tests then, `pnpm test:e2e`: 30/1 skip, migration 0021's `DROP FUNCTION`, real-Postgres/
real-MinIO attachments tests) and found no contradictions. Two LOW/non-blocking observations, not
acted on: `SyncConnection.tsx`'s `.connect()` retries `@powersync/web`'s default reconnect cadence
(~0.5–1s) with no backoff configured when the API is unreachable — not confirmed a defect (offline-
first arguably wants persistent retry), but worth JP's attention if battery/network chatter on a
long-offline device matters; and commit `1bc5f36` carries no FR/slice tag, cosmetic.

⛔ **OPEN, raised 2026-08-13 — 3f's retention read-set window has no cheap fix; JP's call is which
heavier design, or whether to descope it for now.** Empirically probed against the real
`journeyapps/powersync-service:1.23.3` (full account: `sync-streams.ts`'s header, second addendum):
a client-supplied stream parameter genuinely exists (`subscription.parameter()`), but the service
refuses to load ANY stream whose WHERE mixes row data with a subscription/connection parameter
except via `=` — *"This expression already references row data, so it can't also reference
connection parameters unless the two are compared with an equals operator."* So
`occurred_at > subscription.parameter('cutoff')` cannot express a rolling window; only equality
can. Two ways forward, both heavier than this slice's budget: (a) equality-bucket time into
discrete parameters (e.g. a `sync_month` column + client subscribes to the N months it wants) —
correctness is straightforward, cost is a derived column plus the client managing a moving
subscription set; (b) a server-side sweep in the `membership-expiry.service.ts` shape, converting
"outside the window" into something equality can test (e.g. a boolean/tombstone-like column) —
same shape as the `expires_at` fix, same cost of a new background job and a replication-lag window.
Neither was built without JP's steer. The queue-survival half of 3f (never losing a write under
quota pressure) is unaffected and is CLOSED — see phase-checklists.md 3f and the entry below.
⚠️ Also worth a look when this is decided: `roadmap.md`'s 3f/3g row says "12-month client-window
test" where `offline-sync.md` § 3 says "default 24 months of events" — the two documents disagree
on the actual window size, independent of the mechanism question above.
→ _Answer:_

📌 **Noted 2026-08-13 — the `drizzle-kit` snapshot history has a gap from migration 0016 onward,
discovered while adding 0022.** `packages/db/migrations/meta/` has snapshots through `0015`, then
none until `0022` (this session's own, since deleted — see below): migrations 0016–0021 were all
hand-authored directly into the migrations folder with a hand-appended `_journal.json` entry, never
run through `drizzle-kit generate`. Harmless for `migrate()` (it tracks applied migrations in the
target Postgres itself, not from `meta/`), but the FIRST `generate` run this session, diffing
against the stale 0015 snapshot, tried to redo all six migrations' worth of already-applied schema
changes (re-`CREATE TYPE`, re-`ALTER TYPE ADD VALUE`, re-add `initial_head_count`, etc.) into a
new file — caught before it was ever applied, deleted, and 0022 was hand-written instead, matching
the pattern 0016–0021 already established. Not a blocker — hand-writing migrations already IS this
repo's practice for anything RLS/trigger-shaped, which `generate` cannot produce anyway — but
`generate` cannot safely be trusted for a plain additive column any more either until someone
either backfills the missing snapshots or accepts hand-writing as the permanent norm and says so.
JP's call, not urgent.

📌 **Noted 2026-08-13 — `sqlite-capture-store.ts`'s new quota-retry timer has no `close()`.** Fixing
3f's queue-survival bug (below) added a `setInterval`-based retry loop with no teardown hook; a
farm switch that discards a store instance while a retry is in flight leaks that interval (self-
clears on first success, so this is bounded, not indefinite — full account in the code comment
above `scheduleRetry`). Same SHAPE of resource leak `hydrated-table-store.ts`'s `db.watch()` had
before its `close()` fix (sync-auditor, 2026-08-10), narrower in effect. Wiring a matching
`close()` through all twelve `Local*.tsx` providers is follow-on work, not done this session —
flagged rather than silently left, per CLAUDE.md's "no silent caps."

✅ **Closed 2026-08-13 — Finding 2: per-farm events partitioning is retired, not wired up.** JP's
first answer (wire `create_farm_partition` into `FarmsService.createFarm` + read `pg_inherits`
dynamically) turned out to only help at config-GENERATION time, not for a farm signing up after
the last deploy — under that plan every such farm would silently down-sync nothing, forever,
which is worse than the status quo. Taken back to JP with that fact; **JP chose to retire
partitioning outright.** Migration `0021_retire_farm_partitioning.sql`: `create_farm_partition`
dropped, `events_default` is now the permanent only partition. Full record: `phase-checklists.md` 3e.

⭐ **Closed 2026-08-10 — `sync-auditor` pass + re-pass over 3e, 2 SEV-2 + 1 LOW → all fixed, 2
follow-on findings on the fixes → also fixed.** Finding 1 (SEV-2, FR-131): the withholding guard
read raw local `tallies` at three call sites, blind to a withholding known only via down-sync —
fixed by reading the `mergeById` local+hydrated fold everywhere (`AdjustMobScreen.tsx`,
`Outbox.tsx`, `residue.ts`); **this is why the slice needs a compliance-checker pass before
merge.** Finding 2: see above. LOW: `hydrated-table-store.ts`'s `db.watch()` leaked across farm
switches, fixed with `close()`. Re-pass found a StrictMode double-invoke that permanently killed
hydration in `pnpm dev` (fixed by constructing the store inside the effect) and a tripwire gap
(`FarmsService.createFarm` uncovered, strengthened). Full detail: `phase-checklists.md` 3e.

⭐ **Found+fixed 2026-08-10 — PowerSync replicates ZERO rows for a partitioned source table
(`events`), silently.** `publish_via_partition_root` is explicitly rejected (`PSYNC_S1143`); a
config against the partitioned parent validates and "replicates" while delivering nothing to any
client, ever. Fixed at the generator (`PARTITIONED_SOURCE_TABLE`/`sourceTable` → `FROM
events_default AS events`), not hand-patched. Production-relevant for the af-south-1 publication.
Full account: `phase-checklists.md` 3e.

✅ **Closed 2026-08-10 — REST-up/PowerSync-down is the PERMANENT upload topology.** `Outbox.tsx` is
the durable upload queue; PowerSync is down-sync only; `PowerSyncBackendConnector.uploadData` is a
fail-loud tripwire, not a stand-in. Reasoning: **[ADR-0012](docs/03-architecture/adr/ADR-0012-upload-topology.md)**.

**Resolved 2026-08-09, four items, each with full evidence in `phase-checklists.md` 3b unless
linked:** (1) Sync Streams, not classic Sync Rules (JOIN/subquery ban blocked three tables);
`IN (SELECT...)` validates, `EXISTS`/`now()` do not — `farm_users.expires_at` closed by
`MembershipExpiryService`'s minute sweep instead
(`docs/04-delivery/phase-3-sync-expiry-enforcement-gap-2026-08-09.md`). (2) Werf absorbs Voorman's
planning discipline, archived not merged; Google OIDC primary via ADR-0011, passkeys step-up, never
SMS (`docs/04-delivery/werf-voorman-consolidation-audit-2026-08-09.md`). (3) Object storage is a
Phase 3 shared foundation (OPFS + SQLite metadata, MinIO dev/test, S3 prod) — Phase 2 stored no
photo. (4) The PowerSync WASM engine (~2.7MB gz) is precached, not counted against NFR-009's 250KB
budget (`docs/04-delivery/phase-3-capture-migration-2026-08-09.md`).

## 4. Verification

| Check | Latest result |
|---|---|
| `pnpm project:check` | Green. ⚠️ Unanswered owner decisions are now a WARNING, not a failure — the old exit-1 made "ask, do not guess" break the definition of done. `--strict` restores the hard failure and **nothing invokes it yet**; that is a deliberate, informed weakening, not an oversight |
| Review agents | ✅ **Tenth pass run 2026-08-08 at owner request over `17891f0..HEAD`.** `sync-auditor`: APPROVABLE. `compliance-checker`: APPROVABLE — **withdraws its standing NOT APPROVABLE**. `reviewer`: NOT APPROVABLE, carried solely by the exit-gate line "owner-triggered passes still open", which this pass closed. **No SEV-1 and no SEV-2 from any agent** |
| `pnpm verify` (2026-08-09, membership expiry bridge) | ✅ Uncached: 97 test files / 1,020 tests; 7/7 builds; bundle 151.67 KB gz ≤ 250 KB. Real-Postgres proof: elapsed accepted + pending grants tombstoned, future/permanent untouched, existing tombstone preserved, second sweep changed 0 rows |
| Manual — real service, real per-user delivery (2026-08-09) | ✅ A freshly registered test farm's row reached the client through a real `.connect()` against the self-hosted service: `buckets: 16`, `operations_synced: 6`, client read back exactly its own farm — the rung config-validation/replication-log evidence alone could not prove; see phase-checklists.md 3b |
| `pnpm verify` (2026-08-09, capture-store SQLite migration, 3c + deterministic gate test) | ✅ Uncached: 99 test files / 1,038 tests, 12/12 typecheck, 7/7 builds; bundle 153.34 KB gz ≤ 250 KB interactive-path budget (195.86 KB gz precached engine, reported separately, not gated) |
| `pnpm test:e2e` (2026-08-09, capture-store SQLite migration, 3c) | ✅ 30/30 Chromium journeys passed (incl. 2 new `capture-migration.spec.ts` cases: clean migration + order preserved + localStorage untouched, and a second cold start as a no-op), re-run 3× on the sync-critical specs with no flakes |
| 2026-08-09/08-10 baseline (condensed — full detail in git history and `phase-checklists.md` 3b/3c/3d/3e) | ✅ First full-branch `sync-auditor` pass (2 findings, fixed) → `pnpm verify` 99/1,043 green. 3d audited clean. 3e mobs/tallies hydration shipped, real two-device issue #8 journey proven manually against the live stack, partition-replication defect found+fixed → `pnpm verify` 101/1,059 green, e2e 30/1 skip. `sync-auditor` pass over 3e (2 SEV-2+1 LOW) then re-pass (1 MEDIUM+1 coverage gap), all fixed → `pnpm verify` 102/1,065 green, e2e 30/1 skip, twice back to back, no flakes |
| `pnpm verify` (2026-08-13, Finding 2 closed — migration 0021) | ✅ Uncached: 102 test files / 1,066 tests, 7/7 builds; bundle 155.40 KB gz ≤ 250 KB. `events.integration.test.ts`/`farms.integration.test.ts`'s rewritten invariants pass, incl. a new test proving `create_farm_partition` no longer exists to call |
| `pnpm verify` (2026-08-13, 3f/3g/3h/3i(a)/3i(d)) | ✅ Uncached: 103 test files / 1,076 tests, 7/7 builds; bundle 155.96 KB gz ≤ 250 KB. Real-Postgres proof for migration 0022 (`werf-postgres`); `journeyapps/powersync-service:1.23.3` restarted on the regenerated `sync-config.yaml`, "Loaded sync config" with no error, `attachments` confirmed in the `FOR ALL TABLES` publication. Every new test watched to FAIL first, incl. `sqlite-capture-store.spec.ts`'s quota-retry test against the actual bug it fixes |
| `pnpm test:e2e` (2026-08-13, same slice) | ✅ 30 passed / 1 skipped (the real-stack tripwire, correctly absent from the default lane), no regression from the 3f/3g/3h/3i(a)/(d) diff |
| `pnpm verify` (2026-08-13, 3i(b) — API attachments module) | ✅ Uncached: 104 test files / 1,089 tests, 7/7 builds; bundle 155.98 KB gz ≤ 250 KB. `attachments.integration.test.ts`: 9/9 against a REAL Postgres AND a real `minio/minio:latest` (testcontainers), never mocked — including a genuine PUT round-trip through a presigned URL and two tests that parse the response through `attachmentUploadUrlSchema` after a JSON round-trip (this is what caught the wire-contract bug logged in §3). ⚠️ An earlier attempt at this same run failed 9 unrelated integration-test files with `Port 5432/tcp not bound` / `Health check not healthy` — traced to Docker resource contention from an EARLIER background `pnpm verify` invocation of mine still running concurrently (18+ orphaned testcontainers Postgres containers found via `docker ps`); stopped the stale background task, removed the orphans, re-ran once cleanly. Not a code defect — flagged so a future session recognises the same symptom instead of chasing a phantom regression |
| Review agents (2026-08-13, owner-triggered, this session, "run all relevant agents") | ✅ **`compliance-checker` over `13a0d46..HEAD`: APPROVABLE, zero findings — the sole recorded merge blocker is closed.** ⚠️ **`sync-auditor` over `dd49a20..HEAD`: 2 MEDIUM + 1 LOW, no tenancy leak, all fixed same session under §6 clause 3 (fail-first tested).** ✅ `reviewer`: independently reproduced every load-bearing STATUS.md claim (gate results, migration 0021, real-Postgres/real-MinIO attachments tests, commit authorship) with **no contradictions**; correctly declined to call Phase 3 exit-gate complete (3e/3f/3i(c) already-recorded gaps, not new). Full detail: §3 |
| `pnpm verify` (2026-08-13, sync-auditor findings 1–3 fixed) | ✅ Uncached, run directly (not trusted from the `pnpm verify` turbo tail alone — that log only showed the cached-mixed `build` step's summary, so `pnpm test` was re-run standalone to confirm a genuine execution): 104 test files / **1,092 tests** (1,089 + 3 new fail-first tests), real 187s wall duration, 1332.99s cumulative test time. `attachments.integration.test.ts`: 12/12, including the 3 new tests, each independently confirmed to FAIL against the pre-fix code (via `git stash` on just `attachments.service.ts`) before being confirmed green with the fix restored. Build: 155.98 KB gz ≤ 250 KB, unchanged (no bundle-affecting code) |
| `pnpm test:e2e` (2026-08-13, same fixes) | ✅ 30 passed / 1 skipped, real 1.1m run, no regression |

## 5. Next executable steps

**Items 1–14, all ✅ done 2026-08-08 through 2026-08-10 — condensed, full detail in git history and
`phase-checklists.md`:** the tenth pass and its filed issues #4–#10 (incl. #8, the Phase 3
`landed()`-on-hydration blocker, and #10, the `theft_incident_animals` surrogate-id gap, still
untouched and tracked separately); 3a (SDK isolation behind `@werf/sync`, drift-checked local
schema); Werf/Voorman consolidation (HttpOnly session cookie, auth throttles, CSP baselines); the
real-browser OPFS proof; 3b (self-hosted PowerSync + Sync Streams replicating real rows from all 15
tables, `PowerSyncBackendConnector` + the `auto_subscribe` fix); 3c (all 12 capture stores migrated
to SQLite/OPFS, two hydration-gating regressions found+closed); tripwire 3e closed; a full-branch
`sync-auditor` pass (hydration-failure isolation + 429 retry, both fixed); 3d audited clean,
`uploadData` reframed into ADR-0012; 3e mobs/tallies down-sync + the partitioned-table replication
defect found+fixed; a `sync-auditor` pass+re-pass over 3e (2 SEV-2+1 LOW, then 1 MEDIUM+1 coverage
gap, all fixed). Do not begin payroll on local adapters. `docs/phase-3-6-scope` still needs
rebasing onto `main` before any Phase 3–6 scope-doc work.

15. ✅ Done 2026-08-13: **Finding 2 closed — partitioning retired**, migration
    `0021_retire_farm_partitioning.sql`; see §3 for the full decision record.
16. ✅ Done 2026-08-13, JP explicitly overrode item 15's sequencing ("complete as much of 3f-3i as
    possible", ahead of the compliance pass — deliberate, not a lapse): **3g, 3h, 3i(a), 3i(b),
    3i(d) closed; 3f half-closed; 3i(c) deliberately deferred, not a lapse (design notes in
    `phase-checklists.md` 3i(c) so the next session starts warm).** 3i(b): presigned-upload +
    checksum-verified finalize API against a real S3-compatible adapter, empirically confirmed
    MinIO enforces the declared checksum at PUT time (`object-storage.ts` header). A wire-contract
    bug was found and closed in the same session — `attachmentUploadUrlSchema` promised `expiresAt`
    on every response and non-null `uploadUrl`/`checksumHeaderValue`, the service returned neither
    correctly; service-level tests never caught it because they never round-tripped the response
    through the schema a real client parses. Fixed, and the fix is now pinned by two tests that
    parse a JSON round-trip through the schema, not just assert fields. None of this touched the
    FR-131 guard files (`AdjustMobScreen.tsx`, `Outbox.tsx`'s taint walk, `residue.ts`) on purpose,
    so the compliance pass JP will eventually trigger is not entangled with this session's diff.
    Full detail: `phase-checklists.md` 3f/3g/3h/3i, and §3 above for the owner decisions this
    raised (retention read-set window; the drizzle snapshot gap; the quota-retry timer's missing
    `close()`). Next: JP reviews, then requests whichever agents get this merge-ready — his own
    words for this session's closing step.
17. ✅ Done 2026-08-13, this session, item 16's "Next" step: **JP requested all relevant agents
    ("run all relevant agents, to improve, fix and report back what blocks progress"), treated as
    the owner trigger for `compliance-checker` (item 15's "not yet" was for earlier the same day,
    not this message).** `compliance-checker` over the full branch **CLEARED — APPROVABLE, zero
    findings.** The sole recorded merge blocker is closed. `sync-auditor` over `dd49a20..HEAD`
    found 2 MEDIUM + 1 LOW in the attachments module, all fixed under §6 clause 3. `reviewer`
    reproduced every load-bearing claim in this file independently, no contradictions. Full detail:
    §3/§4. **Not done this session, deliberately: did not push or open a PR** — this file's own
    standing note says that's JP's explicit go-ahead, which this session's instruction did not
    grant. What's left blocking a PR is no longer an audit/compliance gate — it's JP's own call on
    (a) whether to push this as a checkpoint now or keep building 3e/3f/3i(c) first, and (b) the
    open 3f retention-window design decision above.

## 6. The review-pass stopping rule (set 2026-08-05 by JP) — ⚠️ SATISFIED, keep it anyway

Restored here after the tenth pass found it had been deleted wholesale by this branch's own
STATUS compaction while `roadmap.md` still pointed at it. It is decision state, not session
narrative. **Do not delete it again; a rule nobody can find is not a rule.**

| # | Clause |
|---|---|
| 1 | **Scope narrows every pass.** A pass reviews only the previous pass's fix diff plus anything committed since — never the accumulated range |
| 2 | **A severity floor clears the gate.** A pass CLEARS on no SEV-1 and no SEV-2 in its range. MED/LOW are fixed or filed as tracked issues on `main`; they are not merge blockers |
| 3 ⭐ | **The terminal condition.** If a pass returns only MED/LOW, those fixes merge WITHOUT another pass, provided each is (i) mechanical, (ii) confined to the files the finding names, and (iii) covered by a test **watched to FAIL against the old code first**. A SEV-1/SEV-2 fix never qualifies |
| 4 | **Hard ceiling: two passes.** Three consecutive passes finding severe defects in a shrinking diff is a DESIGN problem — escalate as a scope decision, not more review |
| 5 ⭐ | **An accepted redesign resets the ceiling ONCE**, scoped to the replacement diff alone. ⛔ If that pass returns a SEV-2 in the replaced mechanism, the answer is **descope, not a third design** |

It does not lower the bar on regulated code: a SEV-1/SEV-2 in FR-131 / animal ID / stock theft /
POPIA blocks the merge absolutely. It changes *when reviewing stops*, never *what a defect is*.
Amendments are JP's and must be asked for out loud, never quietly re-interpreted.

**Outcome, 2026-08-08 — the recursion terminated.** Passes one to nine were all NOT APPROVABLE,
each finding a real defect inside the previous one's fixes. Clause 4 fired at the ninth; JP chose
redesign over descope; the tenth pass ran under clause 5 over the replacement and **cleared under
clause 2 — no SEV-1, no SEV-2, from any of the three agents.** The clause-5 "once" is now spent.

Two things worth keeping from it:

- **`sync-auditor` finding #3 was REFUTED with evidence, and the refutation matters as much as the
  confirmations.** It claimed `/not-sent` never says "Record it again" and that the `Outbox.tsx`
  comment saying so was a stale premise. It is not: a head shortage throws `ValidationError`
  (`mob-tally.ts:146`) → `werf-error.filter.ts:85` maps it to code `VALIDATION` → `reasonKey`
  renders `notSent.why.validation` = *"Record it again, checking the numbers and dates."* Checking
  `notSent.intro` alone is not checking that screen's copy. **The "fix" would have been the defect.**
- **Both `reviewer` and `sync-auditor` independently found the same Phase-3 landmine**, which is
  worth more than either alone: `landed()` is this device's sent-log. Exact until hydration ships,
  silently wrong after. Written into the Phase 3 checklist as tripwire 3e, not left in a comment.

## 7. Standing decisions

- Offline writes complete locally; network reconciliation is background work.
- Review agents are owner-triggered only.
- A 4xx capture is retained and set aside; a 5xx/transient error aborts the round.
- Aggregates are projections of append-only logs ordered by `(occurred_at, id)`; recounts reset.
- Regulated values are effective-dated data resolved by farm jurisdiction and `occurred_at`.
- Labour-law review and verified Gazette figures gate deployment, not writing placeholder-driven
  domain mechanics.
- Phone-only invitations are handed over in person; SMS is not a second factor or credential path.
- SAFEX/red-meat licence conversations begin in the later integration/compliance work, not now.
- Attachment storage is a Phase 3 shared foundation: OPFS + SQLite locally, MinIO in dev/test, S3 in
  `af-south-1` in production; uploads are deferred and never block capture.
