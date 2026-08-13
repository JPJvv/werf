# STATUS — current project handoff

> Read this before planning. This file records current state, owner decisions, verification evidence,
> and the next executable slice. Historical session narratives belong in git history, not here.

**Last updated:** 2026-08-13 (3e's compliance-checker pass, requested by JP, found two findings
against the animals/moves/health hydration diff — both fixed. Finding 1 (mob_id current-vs-opening)
fixed; finding 2 (`mergeById`'s local-wins shadowing a self-captured move/dose's hydrated
enrichment) fixed with a new `mergeByIdPreferHydrated`. **A THIRD pass, requested by JP and scoped
strictly to the finding-2 fix diff (§6 clause 1), returned APPROVABLE** — every one of the 10 call
sites verified exhaustively (grep, not sampling), the tally/animal exclusion traced against source
rather than trusted, the `Outbox.tsx` send/guard boundary confirmed intact, no field-loss path
found. Two LOW docstring-precision notes (not defects) fixed same session. **The FR-131 compliance
gate on this diff is now closed, and JP chose to commit the checkpoint (`ba7f680`).** See §3.)

**Active branch:** `phase-3/powersync-foundation`, off `main` @ `13a0d46`, HEAD `ba7f680`. Not
pushed yet — local commits only, awaiting the owner's go-ahead to push/open a PR.

**Remote state:** Phase 2 merged to `main` via PR #3 (`13a0d46`); both CI lanes were green at merge

## 1. Delivery position

| Phase | State | Evidence / boundary |
|---|---|---|
| 0 — Scaffold | Merged | `main` |
| 1 — App shell, auth & 2FA | Merged | PR #2, `9452ebc` |
| 2 — Livestock | ✅ **Merged** | `main` @ `13a0d46` (PR #3, 2026-08-08). Tenth pass cleared — no SEV-1/SEV-2 from `reviewer`, `sync-auditor` or `compliance-checker`. MED/LOW fixed under §6 clause 3 or filed as issues #4–#9 (open, tracked on `main`, not merge blockers) |
| 3 — Offline sync | 🔶 In progress — 3a/3b/3c/3d/3f/3g/3h done, 3e CLOSED for mobs/tallies AND animals/moves/health/identifiers/theft/weights/breeding (land still open), 3i(a)/3i(b)/3i(d) done, 3i(c) not started, unmerged, uncommitted, awaiting a fresh compliance pass | `phase-3/powersync-foundation`: 3a–3d as before, plus real app-level down-sync for mobs/tallies (`SyncConnectionProvider` + `HydratedLivestock.tsx`), tripwire 3e (issue #8) CLOSED and proven both by fakes and by the real service. ✅ `sync-auditor` pass + re-pass over 3e: every finding closed, including Finding 2 (2026-08-13 — partitioning retired, migration 0021, see §3). 2026-08-13: 3f CLOSED: quota-failed writes survive store disposal through one application-scoped retry coordinator, and the authoritative 24-month events read set is implemented as equality-bucket month subscriptions with per-farm configuration. 3g (additive-migration test), 3h (sync health surface), 3i(a)/(d) (attachments schema/tenancy, photo_key pin), and 3i(b) (API upload module) are CLOSED. The migration snapshot gap is reconciled by no-op baseline 0023, with 0024 proving clean subsequent generation. ✅ The owner-triggered `compliance-checker` pass ran and CLEARED — APPROVABLE, zero findings — over the branch AS IT STOOD THEN. ⛔ **2026-08-13, later the same day: 3e extended to animals/moves/health/identifiers/theft/weights/breeding hydration, touching FR-131 guard files the clearance above did not cover — waiting on a fresh owner-triggered compliance pass, not yet requested.** `sync-auditor` findings in the attachments module were fixed under §6 clause 3. Remaining, separately: 3e land hydration not started, and 3i(c) deliberately deferred. See §3/§4/§5 |
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

✅ **CLOSED, 2026-08-13 — 3e extended to animals/moves/health/identifiers/theft/weights/breeding
hydration, touching FR-131 files. JP requested `compliance-checker`; it ran THREE times: two real
findings, both fixed, then a re-pass scoped to just the finding-2 fix diff (§6 clause 1) returned
APPROVABLE.** Mirrors the mobs/tallies pattern (`HydratedLivestock.tsx` +8 hydrated stores). **A
genuine wire-shape trap found and closed:** a hydrated treatment/vaccination/dip carries no
`productId` — only `product` (a name) and the server-resolved `meatWithholdUntil` — so
`withdrawal.ts` was widened to a `WithholdDose` union that prefers the hydrated date. Also closed:
the duplicate-tag guard, theft-incident read/sent gap, move-destination picker, three informational
prefill/dedup gaps, and the shared test fake's `events` watcher (was hard-coded to `type ===
'tally'`) — full file list in `phase-checklists.md` 3e.

**Finding 1 (compliance-checker pass 1, FIXED):** a hydrated animal's `mob_id` is the server's
denormalised CURRENT position (overwritten by every move that lands as latest), not the opening one
`mobMembership()` assumed. Fixed by threading `fromMobId`/`fromLandUnitId` off the wire (the server
resolves these unconditionally at write time — `movement.ts`'s `recordMove`) onto `StoredMove`, and
seeding `mobMembership`'s `openMob` from the earliest move's `fromMobId` when present.

**Finding 2 (compliance-checker re-pass, FIXED):** the finding-1 fix left the same false-CLEAR
failure mode open through a MORE common trigger. `mergeById`'s local-wins, combined with local
capture rows never being evicted, meant a move/dose THIS DEVICE captured (structurally missing
`fromMobId`/`meatWithholdUntil`, since a local capture never carries them) permanently shadowed its
own hydrated echo the moment that echo landed with the same id — the ordinary two-device (or even
one-device, next-sync) workflow. Fixed with `mergeByIdPreferHydrated` (`HydratedLivestock.tsx`):
hydrated wins on a shared id, applied at the 6 `foldMoves` + 4 `foldHealth` sites
(`AdjustMobScreen.tsx`, `RecordLossScreen.tsx`, `herd.ts` ×2, `residue.ts`, `Outbox.tsx`). Scoped
deliberately: `mergeById`'s local-wins is UNCHANGED and still correct for tallies (hydrated
projection drops `count` — a reduction, not enrichment) and animals (single-creation row, no mixed-
provenance case) — the helper's own docstring states the strict-superset criterion so a future call
site is not swapped wrongly. `herd.ts`'s position fold (`useEffectiveAnimals`) was swapped too, on
top of the guard sites: `mapHydratedMove`'s existing header already established the wire's `toMobId`
comes back ALWAYS resolved (never `undefined`-means-unchanged the way local is), so preferring
hydrated makes the client's position projection read the identical inputs the server's own
projection folds from — strictly safer, not just guard-scoped. `mergeById`'s and `Outbox.tsx`'s
docstrings, which claimed "the content is the same either way once both exist", were corrected —
that claim is false for moves/health and was the premise the second finding falsified.

Every fix (both findings) has a fail-first test (`git stash`/temporary-revert per file, confirmed
fail, restored) — finding 2's e2e reproduction (`RecordLoss.test.tsx`) seeds BOTH the local move
log and the hydrated `events` table with the SAME move id, the exact shadow-copy trace.

**Finding-2 re-pass (compliance-checker, third pass, scoped to the fix diff only): APPROVABLE.**
Verified exhaustively (grep, not sampling) all 10 call sites switched; traced (not trusted) that
the tally/animal exclusion is correct against source — animals ARE mutated server-side (the
docstring's original "single-creation row" claim was wrong), but no fold trusts position/status
directly off the row either way, so `mergeById` is still correct there for a narrower reason than
first stated; confirmed the `Outbox.tsx` send-queue/guard-fold boundary intact and no field-loss
path for `WithholdDose`. Two LOW docstring-precision notes fixed same session (the stated criteria
overclaimed; the real argument is "what does each fold consumer actually read" — this repo's own
top recurring-defect class is a comment whose premise outlived the code). **The FR-131 gate on this
diff is now closed.** Full `pnpm verify`: 106 files / 1,127 tests, 7/7 builds, 158.99 KB gz;
`pnpm test:e2e`: 30/1 skip. **Committed as `ba7f680`** (JP's explicit go-ahead). Not pushed —
pushing/opening a PR is still a separate, unrequested go-ahead.

⛔ **Open owner decision — a narrower residual finding 2's re-pass flagged but did NOT call a
defect: a BACK-DATED local move.** If a farmer captures a move today for a walk that happened days
ago, and this device has never received that animal's earlier hydrated moves, the device genuinely
has no way to know the TRUE opening mob at that past instant — there is no correct client-side
answer, only a preview that may be wrong until the next hydration. Two ways to close this:
**(a) fail-closed** — a back-dated move with no hydrated context blocks the FR-131 preview outright
rather than guessing, or **(b) accept as a documented preview limitation** — the guard already
recomputes authoritatively at capture time in the common (non-back-dated) case, and the SERVER'S own
guard (not this preview) is still the actual enforcement boundary.
→ _Answer:_

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

✅ **Closed 2026-08-13 — 3f uses equality-bucket month subscriptions for its event retention
read set, with 24 months as the authoritative default.** The pinned service rejects timestamp
range parameters but accepts equality parameters. The client now subscribes to one stream per
`farm_id` + `YYYY-MM` bucket, adding the new month before removing an expired one; zero-TTL
subscription expiry removes rows that leave the read set. `farms.event_retention_months` is a
positive, per-farm setting (default 24), carried through the session contract. Membership remains
an independent predicate in the stream query, so client-controlled farm/month parameters cannot
grant access. This avoids the sweep design's cron, mass-row updates and replication-lag window.
`roadmap.md`'s stale 12-month wording is corrected to match `offline-sync.md`.

✅ **Closed 2026-08-13 — the `drizzle-kit` snapshot gap is reconciled without rewriting applied
migrations.** Migration 0023 is an intentional SQL no-op whose generated snapshot captures the
schema after hand-authored migrations 0016–0022. This restores a truthful current diff baseline;
it does not pretend historical snapshots can be reconstructed safely. Migration 0024 was then
generated normally and contains only the new retention setting, proving the next diff is clean.
`migration-history.test.ts` now requires every journal entry to have SQL and the latest entry to
have a snapshot, preventing the same silent drift from recurring.

✅ **Closed 2026-08-13 — capture stores now expose and use `close()`, without sacrificing a
quota-failed write during a farm switch.** All twelve local capture providers close discarded
store listeners. Retry ownership moved from each store instance to one application-scoped
durability coordinator that holds only database command parameters, uses at most one interval,
and survives provider disposal until the write persists. Tests cover listener teardown, shared
timer bounds, farm-switch survival, and retry completion.

✅ **Closed 2026-08-13 — Finding 2: per-farm events partitioning is retired, not wired up.** JP's
first answer (wire `create_farm_partition` into `FarmsService.createFarm` + read `pg_inherits`
dynamically) turned out to only help at config-GENERATION time, not for a farm signing up after
the last deploy — under that plan every such farm would silently down-sync nothing, forever,
which is worse than the status quo. Taken back to JP with that fact; **JP chose to retire
partitioning outright.** Migration `0021_retire_farm_partitioning.sql`: `create_farm_partition`
dropped, `events_default` is now the permanent only partition. Full record: `phase-checklists.md` 3e.

**2026-08-09/10, condensed — full detail in git history and `phase-checklists.md` 3b/3e (also
summarised in §5's items 1–14):** `sync-auditor` pass+re-pass over 3e closed 2 SEV-2+1 LOW then a
StrictMode double-invoke + a tripwire gap; a partitioned `events` table was found to silently
replicate ZERO rows through PowerSync (`PSYNC_S1143`), fixed at the config generator; REST-up/
PowerSync-down was set as the PERMANENT upload topology (**[ADR-0012](docs/03-architecture/adr/ADR-0012-upload-topology.md)**);
Sync Streams (not classic Sync Rules) with `MembershipExpiryService` closing the `EXISTS`/`now()`
gap; Werf absorbs Voorman's planning discipline (Google OIDC primary, passkeys step-up, never SMS);
object storage set as a Phase 3 shared foundation (OPFS+SQLite, MinIO dev/test, S3 prod); the
PowerSync WASM engine (~2.7MB gz) precached and excluded from NFR-009's budget.

## 4. Verification

| Check | Latest result |
|---|---|
| `pnpm project:check` | Green. ⚠️ Unanswered owner decisions are now a WARNING, not a failure — the old exit-1 made "ask, do not guess" break the definition of done. `--strict` restores the hard failure and **nothing invokes it yet**; that is a deliberate, informed weakening, not an oversight |
| Review agents | ✅ **Tenth pass run 2026-08-08 at owner request over `17891f0..HEAD`.** `sync-auditor`: APPROVABLE. `compliance-checker`: APPROVABLE — **withdraws its standing NOT APPROVABLE**. `reviewer`: NOT APPROVABLE, carried solely by the exit-gate line "owner-triggered passes still open", which this pass closed. **No SEV-1 and no SEV-2 from any agent** |
| 2026-08-09/08-10 baseline (condensed — full detail in git history and `phase-checklists.md` 3b/3c/3d/3e) | ✅ Membership expiry bridge, real per-user delivery proven against the live service, capture-store SQLite migration (3c), first full-branch `sync-auditor` pass (2 findings, fixed), 3d audited clean, 3e mobs/tallies hydration + partition-replication defect found+fixed, a `sync-auditor` pass+re-pass over 3e (2 SEV-2+1 LOW, then 1 MEDIUM+1 coverage gap, all fixed). Ending state: `pnpm verify` 102/1,065 green, e2e 30/1 skip, twice back to back, no flakes |
| 2026-08-13 morning, condensed (Finding 2/migration 0021, 3f/3g/3h/3i(a)/(b)/(d), full detail in git history) | ✅ Partitioning retired (migration 0021); real-Postgres proof for migration 0022, PowerSync reloaded clean; attachments module against real Postgres+MinIO, 9/9, incl. a genuine presigned-URL PUT round-trip (this run is what caught the wire-contract bug in §3). One infra note: an early run's 9 unrelated failures traced to Docker contention from a stale concurrent `pnpm verify`, not a code defect. Ending state: 104 files/1,089 tests, 7/7 builds, 155.98 KB gz, e2e 30/1 skip |
| Review agents (2026-08-13, owner-triggered, "run all relevant agents") | ✅ **`compliance-checker` over `13a0d46..HEAD`: APPROVABLE, zero findings.** ⚠️ `sync-auditor` over `dd49a20..HEAD`: 2 MEDIUM + 1 LOW, no tenancy leak, all fixed under §6 clause 3. ✅ `reviewer`: independently reproduced every load-bearing claim, no contradictions. Full detail: §3 |
| `pnpm verify` (2026-08-13, sync-auditor findings 1–3 fixed, then 3f follow-ons closed) | ✅ Uncached, run directly (not trusted from a cached-mixed turbo tail): 104 files/1,092 tests → **106 files/1,100 tests**, incl. real-Postgres forward migration through no-op baseline 0023 + generated 0024, 12/12 real Postgres/MinIO attachment tests, a pre-existing mixed-clock defect in attachment finalization found+closed. 7/7 builds; 156.78 KB gz; e2e 30/1 skip |
| `pnpm verify` (2026-08-13, 3e extended to animals/moves/health/identifiers/theft/weights/breeding) | ✅ Fully uncached: **106 test files / 1,119 tests** (19 new, incl. shared test-fake + `withdrawal.ts`/`WithholdDose` widening, each verified in isolation); 7/7 builds; **158.94 KB gz**. Every new test confirmed to FAIL against pre-fix code via `git stash` before being confirmed green. `pnpm test:e2e`: 30/1 skip, no regression |
| `pnpm verify` (2026-08-13, compliance-checker findings 1+2 fixed) | ✅ Fully uncached: **106 test files / 1,127 tests** (8 new since the 1,119 baseline — finding 1: 3 `withdrawal.test.ts` + 1 `RecordLoss.test.tsx`; finding 2: 3 `HydratedLivestock.test.ts` `mergeByIdPreferHydrated` tests + 1 `RecordLoss.test.tsx` shadow-copy e2e reproduction); 7/7 builds; **158.99 KB gz**. Both fixes' tests independently confirmed to FAIL pre-fix, then pass with the fix. `pnpm test:e2e`: 30/1 skip, real 1.1m run, no regression |

## 5. Next executable steps

**Items 1–14, all ✅ done 2026-08-08 through 2026-08-10 — condensed, full detail in git history and
`phase-checklists.md`:** the tenth pass and its filed issues #4–#10 (incl. #8, the Phase 3
`landed()`-on-hydration blocker, and #10, the `theft_incident_animals` surrogate-id gap, still
untouched and tracked separately); 3a (SDK isolation behind `@werf/sync`); Werf/Voorman
consolidation; the real-browser OPFS proof; 3b (self-hosted PowerSync + Sync Streams); 3c (all 12
capture stores migrated to SQLite/OPFS); tripwire 3e closed; 3d audited clean, `uploadData`
reframed into ADR-0012; 3e mobs/tallies down-sync + the partitioned-table replication defect
found+fixed; a `sync-auditor` pass+re-pass over 3e. Do not begin payroll on local adapters.
`docs/phase-3-6-scope` still needs rebasing onto `main` before any Phase 3–6 scope-doc work.

15. ✅ Done 2026-08-13: **Finding 2 closed — partitioning retired**, migration
    `0021_retire_farm_partitioning.sql`; see §3 for the full decision record.
16. ✅ Done 2026-08-13, JP explicitly overrode item 15's sequencing ("complete as much of 3f-3i as
    possible", ahead of the compliance pass — deliberate, not a lapse): **3g, 3h, 3i(a), 3i(b),
    3i(d) closed; 3f initially half-closed; 3i(c) deliberately deferred (design notes in
    `phase-checklists.md` 3i(c)).** 3i(b): presigned-upload + checksum-verified finalize API against
    a real S3-compatible adapter. A wire-contract bug was found and closed the same session —
    `attachmentUploadUrlSchema` promised fields the service did not correctly return; service-level
    tests never caught it because they never round-tripped the response through the schema a real
    client parses. Fixed, pinned by two tests that parse a JSON round-trip. Full detail:
    `phase-checklists.md` 3f/3g/3h/3i, §3 above.
17. ✅ Done 2026-08-13, this session, item 16's "Next" step: **JP requested all relevant agents
    ("run all relevant agents, to improve, fix and report back what blocks progress"), treated as
    the owner trigger for `compliance-checker` (item 15's "not yet" was for earlier the same day,
    not this message).** `compliance-checker` over the full branch **CLEARED — APPROVABLE, zero
    findings.** The sole recorded merge blocker is closed. `sync-auditor` over `dd49a20..HEAD`
    found 2 MEDIUM + 1 LOW in the attachments module, all fixed under §6 clause 3. `reviewer`
    reproduced every load-bearing claim in this file independently, no contradictions. Full detail:
    §3/§4. **Not done this session, deliberately: did not push or open a PR** — this file's own
    standing note says that's JP's explicit go-ahead, which this session's instruction did not
    grant. What's left blocking a PR is no longer an audit/compliance or 3f decision gate — it is
    JP's own call on whether to push this checkpoint now or keep building 3e/3i(c) first.
18. ✅ Done 2026-08-13: **3f follow-ons closed.** Equality-bucket subscriptions implement the
    per-farm 24-month event window; migration 0023 restores the Drizzle current-state snapshot
    baseline and generated 0024 proves it; capture-store disposal is wired through all twelve
    providers while application-scoped retry ownership preserves quota-failed writes. See §3.
19. ✅ Done 2026-08-13, JP's explicit choice of this session's next step ("3e: animals/moves/health
    hydration"): **3e extended past mobs/tallies to cover animals/moves/health/identifiers/theft/
    weights/breeding.** Full detail: §3, `phase-checklists.md` 3e.
20. ✅ Done 2026-08-13, JP's explicit choice three times this session ("Request compliance-checker
    now", "Request compliance-checker re-pass now" after the clause-4 stakes were named out loud,
    then "Commit this checkpoint"): **`compliance-checker` ran three times over the item-19 diff —
    finding 1, fixed; finding 2 (a re-pass), fixed; a THIRD pass scoped to just the finding-2 fix
    diff → APPROVABLE — then committed as `ba7f680`.** The FR-131 gate on this diff is closed. Full
    record: §3. §3 also carries one open owner decision (back-dated local moves), not a defect,
    unrelated to the now-closed gate. Not pushed — pushing/opening a PR remains a separate
    go-ahead.

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
