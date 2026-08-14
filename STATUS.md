# STATUS — current project handoff

> Read this before planning. This file records current state, owner decisions, verification evidence,
> and the next executable slice. Historical session narratives belong in git history, not here.

**Last updated:** 2026-08-14. Session goal: complete Phase 3 as close to approvable as possible.
Closed this session: the back-dated-local-move owner decision (fail-closed), 3e's land hydration
(the last open case in the two-device conflict matrix), and **3i(c)** — the attachment capture/
upload deferred queue, previously deliberately deferred. See §3 for each.

**Active branch:** `phase-3/powersync-foundation`, off `main` @ `13a0d46`, HEAD `8dcdaf5` (land
hydration) + this session's uncommitted 3i(c) work. Not pushed — local commits only, awaiting the
owner's go-ahead to push/open a PR.

**Remote state:** Phase 2 merged to `main` via PR #3 (`13a0d46`); both CI lanes were green at merge.

## 1. Delivery position

| Phase | State | Evidence / boundary |
|---|---|---|
| 0 — Scaffold | Merged | `main` |
| 1 — App shell, auth & 2FA | Merged | PR #2, `9452ebc` |
| 2 — Livestock | ✅ **Merged** | `main` @ `13a0d46` (PR #3, 2026-08-08). Tenth pass cleared — no SEV-1/SEV-2. MED/LOW fixed or filed as issues #4–#9 (not merge blockers) |
| 3 — Offline sync | 🔶 In progress, close to exit-gate | 3a–3h done. 3e CLOSED in full (mobs/tallies, animals/moves/health/identifiers/theft/weights/breeding, AND land — see §3). 3i(a)/(b)/(d) done. **3i(c) now CLOSED this session** (§3) — the attachment queue box that was the last ◐ in the checklist. Two boxes still open: the real-Postgres offline-matrix e2e sweep, and 3i(b)'s quota/retry/orphan-cleanup residuals. See §5 |
| 4 — Crops & fields | Not started | Blocks, plantings, sprays, PHI and harvest move here |
| 5 — Labour & wages | Not started | Placeholder rate rows only; deployment needs verified Gazette sources + labour-law review |
| 6 — Finance & compliance packs | Not started | Evidence packs, obligations, fuel/refund, reporting |
| 7 — Hardening & pilot | Not started | Performance, security review, deployment, pilot |

## 2. Audit findings closed (Phase 0–2, historical)

Full detail lives in git history and merged PR #3. Summary: wrong-branch-on-start, an oversized
handoff doc, two incompatible phase maps, the sync-architecture-ahead-of-implementation gap, a
noisy accessibility fixture, human-gated regulated verification, a false uncached-gate timeout, and
missing FR-101 capture controls — all closed before the Phase 2 merge (`13a0d46`).

## 3. Owner decisions

⛔ **Open — one gap found this session (2026-08-14), not a merge blocker, flagged not fixed:**
`db.md`'s "every conflict resolution writes an audit row" has no implementation, and — by design —
no field-LWW-editable data for it to fire on. Every aggregate here (herd status, position, head
count, boundary) is append-only-log-and-re-derive rather than last-write-wins on a mutable field —
deliberately, so two offline devices cannot silently clobber one another. No `audit_log` table or
write path exists. This is why `testing-strategy.md`'s O-8 offline-matrix row ("sale vs death,
audit row") has nothing to test against today. Two ways to close: (a) `db.md` is describing a
FUTURE mechanism for whenever a genuinely LWW-editable field is added, and should say so; or (b) an
audit mechanism is scheduled now, ahead of any field that needs it. → _Answer:_

⛔ **Tracked, not fixed — the `landrow:` guard gap** (found while wiring land hydration). `Outbox.tsx`
has a `mobrow:` synthetic subject so a tally on a mob the server hasn't accepted is HELD, not
404-set-aside. No equivalent `landrow:` exists for land units — a move/animal/boundary-walk capture
referencing a `land_unit_id` this device queued but refused this round is not held behind it. A
distinct guard-system change (mirroring `mobrow:`), deserving its own scoped pass, not a drive-by.
Not a hydration defect — a hydrated-only land unit needs no such guard.

✅ **CLOSED 2026-08-14 — back-dated local move, fail-closed (JP's choice).** `withdrawal.ts`'s
`mobMembership` now returns an `ambiguous` flag: set when the animal has at least one known move,
its earliest is a LOCAL move (structurally no `fromMobId`), AND the animal is known off this device
(`hydratedAnimalIds`). `meatWithdrawalFor`/`meatWithdrawalForMob` refuse (`blocked: true`) rather
than trust the fallback interval. An animal known only to this device is unaffected — its own
capture log is its complete history regardless of back-dating. Five new fail-first tests in
`withdrawal.test.ts`. Commit `1b429d5`.

✅ **CLOSED 2026-08-14 — 3e's land hydration, the last open case in the two-device conflict
matrix.** New `HydratedLand.tsx` mirrors `HydratedLivestock.tsx`: two `createHydratedTableStore`
reads (`land_units`, and `events` narrowed to `type = 'boundary_walk'`), merged via `LocalLand.tsx`'s
new `useEffectiveLandUnits`/`useEffectiveBoundaryWalks` (`mergeById`, local-wins — traced against
source: nothing trusts a land unit's own `boundaryGeojson`/`hectares` for the CURRENT boundary,
`useCurrentBoundary` always re-derives from the walk log). Consumers switched: `LandScreen`,
`AddLandUnitScreen`'s duplicate-code check, `WalkBoundaryScreen`/`MoveAnimalsScreen` pickers.
`Outbox.tsx`'s send queue stays local-only by design; only its display-only `landUnitCodes` map
reads the merge. Also closes the recount/arrival-order box for land (boundaries share the tally's
absolute-reset shape, per `@werf/domain/boundary.ts`'s own header) — a new out-of-order hydration
test proves it. 5 new tests, 4/5 watched to FAIL first. Commit `8dcdaf5`.

✅ **CLOSED 2026-08-14 — 3i(c), the attachment deferred queue (previously deliberately deferred).**
Built from the prior session's design notes, followed literally:
- **`BlobStore` port + OPFS adapter** (`packages/sync/src/blob-store.ts`/`opfs-blob-store.ts`),
  mirroring `apps/api`'s `ObjectStorage` port/adapter split. `LocalAttachments.tsx` (new) holds the
  metadata half (SQLite-backed `CaptureStore`, same as every other `Local*.tsx`) and the blob half
  separately — `capture_records.payload_json` is TEXT, so a `Blob` has nowhere to live in it.
- **One `FlushItem` per attachment** (`attachments/attachmentApi.ts`'s `sendAttachment`): create →
  PUT → finalize inside one `send()`, never split into three queue entries. `createAttachment` is
  called FRESH every attempt — no presigned URL is ever cached, per offline-sync.md §3.1.
- **New `animalrow:` subject** on animal `FlushItem`s (mirroring the existing `mobrow:` pattern) —
  a photo behind an unsent/refused animal is HELD, not 404-set-aside.
- **The blob is released only once `finalize` returns**, never on the PUT's own success — a PUT can
  land while the app is killed before `finalize` runs, and the retry needs the bytes still there.
  Proven with an interruption test: PUT succeeds, finalize fails, app "restarts" (unmount/remount),
  blob is still present, retry completes.
- **PUT failures are treated as transient** (never a permanent refusal) — `createAttachment`'s
  idempotency means the whole send just retries from leg 1 with a fresh signature; there is no
  queue-safe way to distinguish "never succeeds" from "needs a new signature" without parsing S3's
  XML error body.
- **One real capture UI**: `RecordPhotoScreen.tsx` (walk-the-herd shape, same rhythm as
  `WeighSessionScreen.tsx`), reachable from `/animals/photo`. Deliberately does NOT render photos
  hydrated from other devices — capture/durability/retry only, per this box's own scope.
- **Real OPFS proof, not just the fake**: `apps/web/e2e/attachment-blob-diagnostic.spec.ts`
  (mirrors `local-db-diagnostic.spec.ts`'s two-navigation shape) — a blob written via the real
  adapter survives a fresh page navigation. jsdom has no OPFS, so the unit tier cannot prove this;
  a fake `BlobStore` (`@werf/sync/testing`'s `createInMemoryBlobStore`) backs every other test via
  the same `vi.mock` seam as `getLocalDatabase()`.
- Found and fixed along the way: jsdom's `Blob` has no `.arrayBuffer()` (a real environment gap,
  not a code defect — polyfilled once in `test-setup.ts` via `FileReader`, the same "patch the
  environment, not the code" discipline as the existing `matchMedia` stub); `AuthProvider`'s
  boot-time refresh effect (fires when a fresh mount's in-memory session has no access token) needed
  a proper mocked response in the interruption test, not `acceptingFetch()`'s blind `{}}` — a test
  gap, not a product one.
- 9 new tests in `Outbox.test.tsx` (4 refused/held/sent/interruption scenarios), 4 in
  `RecordPhoto.test.tsx`, 1 real-OPFS e2e. `pnpm --filter @werf/web build`: 161.37 KB gz (≤ 250 KB).
  Full e2e: 31 passed / 1 skipped (WERF_REAL_STACK-gated).
- Touches FR-131-adjacent code (the `animalrow:` guard on the animal/attachment path) — part of the
  compliance-pass scope below, not separately gated.

⛔ **Compliance-pass scope, not yet requested.** Everything since the last cleared pass
(`9b7fa2e..HEAD`) sits inside one un-requested `compliance-checker` scope: the back-dated-move
fail-closed fix, land hydration, and 3i(c)'s `animalrow:` guard addition. Say so before calling any
of this merge-ready; per CLAUDE.md, the owner decides when to trigger the pass.

**Condensed, full detail in git history / `phase-checklists.md` 3b–3i:** three `compliance-checker`
passes over the animals/moves/health hydration diff (2026-08-13, two real findings fixed, third pass
scoped to the fix diff → APPROVABLE, committed `ba7f680`); an owner-triggered `compliance-checker`
pass over the whole branch (CLEARED, zero findings) and a `sync-auditor` pass over the attachments
module (2 MEDIUM + 1 LOW, all fixed under §6 clause 3); 3f closed (quota-failed writes survive via
one application-scoped retry coordinator; 24-month equality-bucket event retention); the
`drizzle-kit` snapshot gap reconciled via no-op baseline migration 0023 + generated 0024; Finding 2
(per-farm events partitioning) retired outright after the "wire it up properly" option was found to
hide a worse defect for any farm signing up post-deploy — migration 0021.

## 4. Verification

| Check | Latest result |
|---|---|
| `pnpm project:check` | Green (line-count trimmed this session; unanswered owner decisions are a WARNING, not a failure) |
| `pnpm verify` (2026-08-14, this session, uncached) | See next update — run in progress as this file is written |
| `pnpm test:e2e` (2026-08-14) | ✅ 31 passed / 1 skipped (real-stack test gated behind `WERF_REAL_STACK`), incl. the new `attachment-blob-diagnostic.spec.ts` |
| `pnpm --filter @werf/web build` (2026-08-14) | ✅ 161.37 KB gz ≤ 250 KB budget |
| Review agents (2026-08-13, owner-triggered, "run all relevant agents") | ✅ `compliance-checker` over `13a0d46..HEAD`: APPROVABLE, zero findings. `sync-auditor` over `dd49a20..HEAD`: 2 MEDIUM + 1 LOW, fixed. `reviewer`: reproduced every claim, no contradictions |
| Historical baselines (2026-08-08 through 2026-08-13) | Condensed — full detail in git history and `phase-checklists.md` 3b–3i |

## 5. Next executable steps

**Everything through 2026-08-13's compliance-checker/land-hydration work is condensed above — full
narrative in git history and `phase-checklists.md`.** Do not begin payroll on local adapters.
`docs/phase-3-6-scope` still needs rebasing onto `main` before any Phase 3–6 scope-doc work.

21. ✅ Done 2026-08-14: back-dated-move fail-closed, land hydration, 3i(c) — see §3.
22. **Next: two exit-gate boxes remain open.**
    - The offline matrix (`testing-strategy.md` §4) needs its real-Postgres/real-adapter sweep for
      the rows Phase 3 actually owns (O-1 through O-11 roughly; O-12+ belong to later phases). O-1/
      O-2 are already covered (local-only, real browser). O-11 is covered by 3g against real
      Postgres. O-5/6/7 are partially covered by `real-sync-hydration.spec.ts`. The gate-verbatim
      row, O-3 (six weeks offline → sync → `occurred_at` intact), has no real-stack test yet.
    - 3i(b)'s quota-pressure/transient-retry/orphan-cleanup residuals (the `attachments_pending_idx`
      partial index exists; nothing reads it yet — mirror `MembershipExpiryService`'s interval-sweep
      shape for the orphan cleanup).
23. Issue #10 (`theft_incident_animals` surrogate-id gap — a hydrated theft incident's `animalIds`
    is always `[]`) still untouched, tracked separately, not a Phase 3 exit-gate blocker.

## 6. The review-pass stopping rule (set 2026-08-05 by JP) — ⚠️ SATISFIED, keep it anyway

Decision state, not session narrative — restored once already after a compaction deleted it. **Do
not delete it again; a rule nobody can find is not a rule.**

| # | Clause |
|---|---|
| 1 | **Scope narrows every pass.** A pass reviews only the previous pass's fix diff plus anything committed since — never the accumulated range |
| 2 | **A severity floor clears the gate.** A pass CLEARS on no SEV-1 and no SEV-2 in its range. MED/LOW are fixed or filed as tracked issues; they are not merge blockers |
| 3 ⭐ | **The terminal condition.** If a pass returns only MED/LOW, those fixes merge WITHOUT another pass, provided each is (i) mechanical, (ii) confined to the files the finding names, and (iii) covered by a test **watched to FAIL against the old code first**. A SEV-1/SEV-2 fix never qualifies |
| 4 | **Hard ceiling: two passes.** Three consecutive passes finding severe defects in a shrinking diff is a DESIGN problem — escalate as a scope decision, not more review |
| 5 ⭐ | **An accepted redesign resets the ceiling ONCE**, scoped to the replacement diff alone. ⛔ If that pass returns a SEV-2 in the replaced mechanism, the answer is **descope, not a third design** |

It does not lower the bar on regulated code: a SEV-1/SEV-2 in FR-131 / animal ID / stock theft /
POPIA blocks the merge absolutely. It changes *when reviewing stops*, never *what a defect is*.
Amendments are JP's and must be asked for out loud, never quietly re-interpreted.

**Outcome, 2026-08-08 — the recursion terminated** at the tenth pass (clause 5, no SEV-1/SEV-2 from
any agent). Two things worth keeping from it: `sync-auditor` finding #3 was REFUTED with evidence
(checking `/not-sent`'s `notSent.intro` alone is not checking `notSent.why.validation`'s actual
copy — the "fix" would have been the defect); and both `reviewer` and `sync-auditor` independently
found the same landmine (`landed()` silently wrong once hydration ships) — the seed of tripwire 3e.

## 7. Standing decisions

- Offline writes complete locally; network reconciliation is background work.
- Review agents are owner-triggered only.
- A 4xx capture is retained and set aside; a 5xx/transient error aborts the round.
- Aggregates are projections of append-only logs ordered by `(occurred_at, id)`; recounts reset —
  and this now applies identically to land boundaries (§3, 2026-08-14).
- Regulated values are effective-dated data resolved by farm jurisdiction and `occurred_at`.
- Labour-law review and verified Gazette figures gate deployment, not writing placeholder-driven
  domain mechanics.
- Phone-only invitations are handed over in person; SMS is not a second factor or credential path.
- SAFEX/red-meat licence conversations begin in the later integration/compliance work, not now.
- Attachment storage is a Phase 3 shared foundation: OPFS + SQLite locally, MinIO in dev/test, S3 in
  `af-south-1` in production; uploads are deferred and never block capture. The capture/upload
  pipeline itself (3i(c)) is now built — see §3.
