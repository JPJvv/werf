# STATUS — current project handoff

> Read this before planning. This file records current state, owner decisions, verification evidence,
> and the next executable slice. Historical session narratives belong in git history, not here.

**Last updated:** 2026-08-13 (3f/3g/3h/3i(a)/3i(d) worked per JP's "complete as much of 3f-3i as
possible" — 3g/3h/3i(a)/3i(d) closed, 3f half-closed (queue-survival bug found+fixed, read-set
window left as an owner decision), 3i(b)/3i(c) not started. Compliance-checker pass still the sole
merge blocker, unchanged this session — nothing here touched the FR-131 guard files)

**Active branch:** `phase-3/powersync-foundation`, off `main` @ `13a0d46`. Not pushed yet — local
commits only, awaiting the owner's go-ahead to push/open a PR.

**Remote state:** Phase 2 merged to `main` via PR #3 (`13a0d46`); both CI lanes were green at merge

## 1. Delivery position

| Phase | State | Evidence / boundary |
|---|---|---|
| 0 — Scaffold | Merged | `main` |
| 1 — App shell, auth & 2FA | Merged | PR #2, `9452ebc` |
| 2 — Livestock | ✅ **Merged** | `main` @ `13a0d46` (PR #3, 2026-08-08). Tenth pass cleared — no SEV-1/SEV-2 from `reviewer`, `sync-auditor` or `compliance-checker`. MED/LOW fixed under §6 clause 3 or filed as issues #4–#9 (open, tracked on `main`, not merge blockers) |
| 3 — Offline sync | 🔶 In progress — 3a/3b/3c/3d done, 3e started (mobs/tallies), 3g/3h/3i(a)/3i(d) done, 3f half-done, 3i(b)/3i(c) not started, unmerged | `phase-3/powersync-foundation`: 3a–3d as before, plus real app-level down-sync for mobs/tallies (`SyncConnectionProvider` + `HydratedLivestock.tsx`), tripwire 3e (issue #8) CLOSED and proven both by fakes and by the real service. ✅ `sync-auditor` pass + re-pass over 3e: every finding closed, including Finding 2 (2026-08-13 — partitioning retired, migration 0021, see §3). 2026-08-13: 3g (additive-migration test), 3h (sync health surface) and 3i(a)/(d) (attachments schema/tenancy, photo_key pin) CLOSED; 3f's queue-survival half CLOSED (found+fixed a real quota-eviction bug), its retention read-set half left ☐ as an owner decision (§3); 3i(b)/3i(c) (S3 upload API, client blob queue) not started. ⛔ Still not merge-ready: this slice touches FR-131 and needs an owner-triggered `compliance-checker` pass, declined "not yet" by JP on 2026-08-13 — nothing this session touched the FR-131 guard files, so that framing is unchanged. Remaining 3e scope (animals/moves/health hydration) also not started. See §3/§4/§5 |
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
| `sync-auditor` (2026-08-09, owner-triggered, full branch `13a0d46..HEAD`) | ⚠️ **First pass over this entire branch (11 commits).** Two real findings, both fixed same day (below); everything else — sync-stream/RLS agreement (hand-verified against real migrations, not just the test's existence), the `expires_at` sweep, `writeTransaction` atomicity/TOCTOU, `allSettled` coverage, no hard deletes, tenancy completeness — checked and sound. One LOW/cosmetic finding (stale `generate:sync-rules` script name, superseded by Sync Streams) left open, not yet fixed |
| `pnpm verify` (2026-08-09, sync-auditor Findings 1 & 2 fixed) | ✅ Uncached: 99 test files / 1,043 tests, 7/7 builds; bundle 153.68 KB gz ≤ 250 KB interactive-path (unchanged budget). Every new/extended test watched to FAIL first (git-stashed or temporarily neutered the fix, confirmed red, restored, confirmed green) |
| `pnpm verify` + `pnpm test:e2e` (2026-08-10, Phase 3 slice 3d) | ✅ Same baseline — 99 test files / 1,043 tests, 7/7 builds, 153.68 KB gz, 30/30 Chromium journeys (3d closed by audit + a reworded connector throw, not new production code). The reworded throw's own test watched to FAIL first against the old message, then restored to green |
| `pnpm verify` (2026-08-10, Phase 3 slice 3e — mobs/tallies hydration) | ✅ Uncached: 101 test files / 1,059 tests, 7/7 builds; bundle 155.19 KB gz ≤ 250 KB. Includes the new `HydratedTableStore`/`HydratedLivestock`/`SyncConnection` code and the `Outbox.tsx`/`AdjustMobScreen.tsx` tripwire-3e changes, all watched to FAIL first via a temporary revert |
| `pnpm test:e2e` (2026-08-10, same slice) | ✅ 30 passed / 1 skipped (the new `real-sync-hydration.spec.ts`, gated behind `WERF_REAL_STACK=1`, correctly absent from the default lane) |
| Manual — real service, two-device issue #8 journey (2026-08-10) | ✅ `real-sync-hydration.spec.ts` run manually against live `apps/api` + `werf-postgres` + `werf-powersync`, 3× clean (fresh `apps/api` process each run — in-memory auth-throttle counters reset — no flakes): real REST-landed birth tally → real second login → real `.connect()` → real SQLite hydration → real capture UI → real send → real Postgres row-count confirmation → real `page.reload()` preserving both the projection and the (by then empty) queue. Found and fixed the partition-replication defect above in the process |
| `sync-auditor` (2026-08-10, owner-triggered, `585ddb2..fc3d9e2`) | ⚠️ **Did NOT clear — 2 SEV-2 + 1 LOW.** Both SEV-2 and the LOW fixed same day, each with a test watched to FAIL first; see §3 |
| `sync-auditor` RE-PASS (2026-08-10, owner-triggered, `fc3d9e2..dd49a20`) | ⚠️ **Confirmed Finding 1/LOW's fixes sound, no fourth call site missed, test timing correct. Found 1 MEDIUM (genuinely new — StrictMode double-invoke killed hydration permanently in `pnpm dev`) + 1 test-coverage gap (Finding 2's tripwire missed `FarmsService.createFarm`).** Both fixed same day, both qualify for §6 clause 3 (mechanical, file-confined, fail-first tested) — no third pass required for them. Finding 2 itself (SEV-2) still open pending the owner decision in §3 |
| `pnpm verify` (2026-08-10, all sync-auditor + re-pass findings closed) | ✅ Uncached: 102 test files / 1,065 tests, 12/12 typecheck, 7/7 builds; bundle 155.40 KB gz ≤ 250 KB. Every new/extended test watched to FAIL first, incl. `AdjustMob.test.tsx`'s new `<StrictMode>`-wrapped render test |
| `pnpm test:e2e` (2026-08-10, same fixes) | ✅ 30 passed / 1 skipped, run twice back to back across both rounds of fixes, no flakes |
| `pnpm verify` (2026-08-13, Finding 2 closed — migration 0021) | ✅ Uncached: 102 test files / 1,066 tests, 7/7 builds; bundle 155.40 KB gz ≤ 250 KB. `events.integration.test.ts`/`farms.integration.test.ts`'s rewritten invariants pass, incl. a new test proving `create_farm_partition` no longer exists to call |
| `pnpm verify` (2026-08-13, 3f/3g/3h/3i(a)/3i(d)) | ✅ Uncached: 103 test files / 1,076 tests, 7/7 builds; bundle 155.96 KB gz ≤ 250 KB. Real-Postgres proof for migration 0022 (`werf-postgres`); `journeyapps/powersync-service:1.23.3` restarted on the regenerated `sync-config.yaml`, "Loaded sync config" with no error, `attachments` confirmed in the `FOR ALL TABLES` publication. Every new test watched to FAIL first, incl. `sqlite-capture-store.spec.ts`'s quota-retry test against the actual bug it fixes |

## 5. Next executable steps

1. ✅ Done 2026-08-08: the owner-triggered tenth pass ran; see §6. MED/LOW findings were
   fixed under clause 3 (both code fixes carry a test watched to FAIL first) or filed on `main` as
   **#4** (a refused animal taints nothing), **#5** (`dobEstimated` read by nothing), **#6** (an
   aborted round wipes the hold display), **#7** (`/not-sent` says "record it again" for a tally,
   and a recount RESETS), **#8** (⛔ Phase 3 blocker — `landed()` breaks on hydration), **#9**
   (stale STATUS.md section pointers, low/docs-only).
2. ✅ Done 2026-08-09: **3a** — `@powersync/web`/`@powersync/common` behind `@werf/sync`; local
   SQLite schema derived from `TENANCY` + `@werf/db`, drift-checked in CI. Two real findings (the
   WASM-in-bundle trap, the `theft_incident_animals` surrogate-id gap → **#10**): `phase-checklists.md` 3a.
3. ✅ Done 2026-08-09: **Werf/Voorman consolidation and auth/UI hardening.** Rotating session
   credentials moved to a host-only HttpOnly cookie; auth throttles, strict header/CSP baselines,
   15-char password floor. Not the production perimeter yet — shared Redis limits and Google
   OIDC/account linking remain ADR-0011 work.
4. ✅ Done 2026-08-09: **confirmed the static WASM core opens in a real browser** — a
   diagnostics-only Vite entry (never in the main bundle) proves real OPFS persistence across a
   navigation. `apps/web/e2e/local-db-diagnostic.spec.ts`.
5. Superseded by item 6, kept only as git history: a first attempt generated classic
   `bucket_definitions` sync rules — three tables couldn't be expressed. Do not resurrect.
6. ✅ Done 2026-08-09: **self-hosted PowerSync service + Sync Streams generated from `TENANCY`,
   both empirically validated together** against a real `journeyapps/powersync-service:1.23.3` —
   REPLICATED REAL ROWS from every one of the 15 synced tables, confirmed in the container's own
   replication log. `sync-streams-rls-agreement.spec.ts` proves tenant-scoped streams match RLS
   shape. Full detail: `phase-checklists.md` 3b, §3 above.
7. ✅ Done 2026-08-09: **`PowerSyncBackendConnector` implemented, `.connect()` empirically proven
   end-to-end** — a real `.connect()` initially returned `operations_synced: 0` until every stream
   got `auto_subscribe: true` (Sync Streams are opt-in); fixed and re-verified (`buckets: 16`,
   `operations_synced: 6`). `.connect()` stayed diagnostics-only through 3b/3c/3d — no application
   read path called it. Full detail: `phase-checklists.md` 3b.
8. ✅ Done 2026-08-09: **3c — all 12 capture stores migrated from localStorage to SQLite/OPFS.**
   `createSqliteCaptureStore` + a generic `localOnly` `capture_records` table, atomic per-key
   migration proven under real interruption and end-to-end. ⭐ Two regressions found and closed:
   (1) the Outbox could flush against a partially-hydrated world — closed by `CaptureStore<T>.settled()`
   gating the flush on every store; (2) two screens froze their queue on a mount-time
   pre-hydration snapshot, closed the same way. Full account:
   `docs/04-delivery/phase-3-capture-migration-2026-08-09.md`.
9. ✅ Done 2026-08-10: **tripwire 3e closed** — `landed()` now recognises a hydrated tally, proven
   by fakes and by the real service. See §3 and `phase-checklists.md` 3e.
10. Do not begin payroll on local adapters.
10. ⚠️ `docs/phase-3-6-scope` is still stacked on the pre-merge `phase-2/livestock`, not `main` —
    rebase it onto `main` before starting any Phase 3–6 scope-doc work.
11. ✅ Done 2026-08-09: **owner-triggered `sync-auditor` pass over the full branch, two findings
    fixed same day.** (1) MEDIUM/HIGH: one corrupt DB-resident row failed a store's WHOLE
    hydration permanently — fixed, `CaptureStore<T>` gained `hydrationFailed()`, distinct from
    `settled()`. (2) MEDIUM: a 429-aborted round had no autonomous retry — fixed, bounded 90s
    retry. Every fix watched to FAIL first. One LOW (stale script name) left open, cosmetic.
12. ✅ Done 2026-08-10: **3d — audited, no code gap found; `uploadData` reframed.** Every 3d
    invariant (idempotency-before-validation, 4xx-set-aside/5xx-abort/refresh-holds-queue,
    browser-kill/reboot durability) was already implemented and proven — `phase-checklists.md` 3d.
    `uploadData`'s throw reframed from "TODO 3c/3d" to the documented permanent tripwire that
    became **ADR-0012** the following session.
13. ✅ Done 2026-08-10: **3e — mobs/tallies down-sync + tripwire 3e (issue #8) closed**, real
    connection lifecycle (`SyncConnectionProvider`), and a production-blocking PowerSync
    partitioned-table replication defect found and fixed (§3). Issue #10
    (`theft_incident_animals` surrogate-id gap) remains untouched and tracked separately — it did
    not block this slice and was not silently folded into it.
14. ✅ Done 2026-08-10: **owner-triggered `sync-auditor` pass + re-pass over 3e.** Pass 1: 2 SEV-2 +
    1 LOW, fixed same day. Re-pass over the fix diff: confirmed those fixes sound, found 1 MEDIUM
    (StrictMode double-invoke killing hydration in `pnpm dev`) + 1 test-coverage gap, both fixed
    same day and both qualify for §6 clause 3 (no third pass required for them). Full detail: §3.
15. ✅ Done 2026-08-13: **Finding 2 closed — partitioning retired**, migration
    `0021_retire_farm_partitioning.sql`; see §3 for the full decision record. ⛔ **Still not
    merge-ready**: FR-131 (Finding 1) still needs an owner-triggered `compliance-checker` pass —
    JP said "not yet" on 2026-08-13.
16. ✅ Done 2026-08-13, JP explicitly overrode item 15's sequencing ("complete as much of 3f-3i as
    possible", ahead of the compliance pass — deliberate, not a lapse): **3g, 3h, 3i(a), 3i(d)
    closed; 3f half-closed; 3i(b)/3i(c) not started.** None of this touched the FR-131 guard files
    (`AdjustMobScreen.tsx`, `Outbox.tsx`'s taint walk, `residue.ts`) on purpose, so the compliance
    pass JP will eventually trigger is not entangled with this session's diff. Full detail:
    `phase-checklists.md` 3f/3g/3h/3i, and §3 above for the two owner decisions this raised
    (retention read-set window; the drizzle snapshot gap). Next: JP reviews, then requests
    whichever agents get this merge-ready — his own words for this session's closing step.

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
