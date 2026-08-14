# STATUS — current project handoff

> Read this before planning. This file records current state, owner decisions, verification evidence,
> and the next executable slice. Historical session narratives belong in git history, not here.

**Last updated:** 2026-08-14 (third session that day, still going). Continuing the punch-list
closure JP started that day (condensed P1/P2.5 record in §5). This session closed **P2.6**
(`theft_incident_animals` surrogate id, issue #10 — migration 0025 + client hydration, two
commits) and **P2.7** (`landrow:` dependency guard — went wider than its design note, which had
missed a move's destination camp and a theft incident's own camp; also fixed an adjacent
`animalrow:` gap on the same theft-incident object). Full detail in §5. **15 of ~21 punch-list
items remain.** Do not re-run P1/P2.5/P2.6/P2.7.

🔶 **P2.8 IN PROGRESS, blocked on infra — see §5 item 28 for the full account.** A second,
UI-driven real-stack e2e test was added to `real-offline-matrix.spec.ts`, commit `38268b5`. Its
sibling test (the pre-existing REST-based occurred_at proof) re-verified PASSING against the live
stack. The new test itself is lint/format-clean but **NOT YET RUN end-to-end** — repeated
registration calls this session tripped `apps/api`'s in-memory rate limiter (burst 2/min, then
sustained 5/60min → 60min block), and restarting `apps/api` to clear it failed: it needs secrets
(`databaseUrl`, `jwtSecret`, `piiEncryptionKey`, `powerSyncJwtPrivateKey`, …) injected via shell
env, not a committed `.env`, which this session does not have. ⛔ **`apps/api` is currently
STOPPED** (killed mid-restart-attempt) — bring it back up with your own env before anything
needing the live stack, including this test.

Prior session (second that day) closed: all four P1 blockers and P2.5 (secure attachment reads +
the FR-603 evidence pack).

**Active branch:** `phase-3/powersync-foundation`, off `main` @ `13a0d46`, HEAD `38268b5` (P2.8
e2e test, WIP — unverified, see §5 item 28) ← `256d06a` (P2.7 landrow guard) ← `4524bb9` ←
`9e1b402` (P2.6 client hydration) ← `6820a21` (P2.6 migration/schema) ← `de3ef93` ← `422e09d`
(P2.5) ← `c2cc48a` (P1.1–P1.4) ← `5e1957f` (3i(b)). Not pushed — local commits only.

**Remote state:** Phase 2 merged to `main` via PR #3 (`13a0d46`); both CI lanes were green at merge.

## 1. Delivery position

| Phase | State | Evidence / boundary |
|---|---|---|
| 0 — Scaffold | Merged | `main` |
| 1 — App shell, auth & 2FA | Merged | PR #2, `9452ebc` |
| 2 — Livestock | ✅ **Merged** | `main` @ `13a0d46` (PR #3, 2026-08-08). Tenth pass cleared — no SEV-1/SEV-2. MED/LOW fixed or filed as issues #4–#9 (not merge blockers) |
| 3 — Offline sync | 🔶 Every phase-checklist box `☑`; a SEPARATE punch list of P1/P2/P3/quality items (opened 2026-08-14) sits on top of the checklist and is 7/~21 done | 3a–3i all CLOSED (§3, historical): 3e in full, 3i(b)/3i(c), O-3. **Punch list (not phase-checklist items, a stricter closure pass JP asked for on top of the checklist):** P1.1–P1.4, P2.5, P2.6, P2.7 done — commits `c2cc48a`, `422e09d`, `6820a21`, `9e1b402`, `256d06a`. P2.8–P2.10, an owner-decision gate, P3.11–P3.16, and Q17–Q19 remain — full sliced list in §5 |
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

✅ **CLOSED 2026-08-14 (first session), condensed — full detail in git history:**
- Back-dated local move, fail-closed (JP's choice): `withdrawal.ts`'s `mobMembership` refuses
  (`blocked: true`) rather than trust the fallback interval when an animal's earliest known move is
  LOCAL and it's known off-device. Commit `1b429d5`.
- 3e's land hydration (last open two-device conflict case): `HydratedLand.tsx` +
  `LocalLand.tsx`'s merge, same shape as livestock's. Boundaries now share the tally's
  absolute-reset/arrival-order guarantees. Commit `8dcdaf5`.
- 3i(c), the attachment deferred queue: `BlobStore` port + OPFS adapter, one `FlushItem` per
  attachment (create→PUT→finalize in one `send()`), `animalrow:` guard, blob released only once
  `finalize` returns (proven via an interruption test). `RecordPhotoScreen.tsx` is the one capture
  UI. Real-OPFS e2e proof. 161.37 KB gz. Touches FR-131-adjacent code — compliance-pass scope.
- 3i(b) residuals: retry is the AWS SDK's own (documented, not hand-rolled);
  `AttachmentOrphanSweepService` sweeps stale `pending` rows via a symmetric conditional claim, safe
  against a device genuinely offline for a week (proven directly). Quota pressure deliberately
  NOT built (no meaningful way to simulate S3 capacity refusal without new MinIO admin-API infra).
- O-3, the offline matrix's real-stack sweep: `real-offline-matrix.spec.ts`
  (`WERF_REAL_STACK`-gated) proves `occurred_at` survives Postgres + PowerSync + a second device's
  fold, against the real stack, twice clean. `testing-strategy.md` §4 now carries a per-row
  coverage column instead of reading as blanket coverage. O-6/O-7/O-8 NOT built (see the audit-row
  owner decision above); O-4/O-5/O-9/O-10 partial; O-12/O-15 belong to phases 4/5.

⛔ **Compliance-pass scope, not yet requested.** Everything since the last cleared pass
(`9b7fa2e..HEAD`) sits inside one un-requested `compliance-checker` scope: the back-dated-move
fail-closed fix, land hydration, 3i(c)'s `animalrow:` guard addition, `c2cc48a` (touches FR-131
withdrawal resolution), `422e09d` (touches the FR-603 evidence pack), `6820a21`/`9e1b402` (P2.6 —
the `theft_incident_animals` migration and its client hydration read, both touching the stock-theft
table), **and now `256d06a` (P2.7 — the theft incident's send path gained an `animalrow:` guard on
its named animals, alongside the `landrow:` work)**. Say so before calling any of this merge-ready;
per CLAUDE.md, the owner decides when to trigger the pass. The remaining punch-list slices in §5
will keep adding to this same scope — P3.14 (branding/animal ID), P3.16 (auth/POPIA) are each
regulated-code
touches in their own right.

**Condensed, full detail in git history / `phase-checklists.md` 3b–3i (2026-08-13):** three
`compliance-checker` passes over the animals/moves/health hydration diff → APPROVABLE (`ba7f680`);
an owner-triggered `compliance-checker` pass over the whole branch (CLEARED) and a `sync-auditor`
pass over attachments (2 MEDIUM + 1 LOW, fixed under §6 clause 3); 3f closed (retry coordinator;
24-month event retention); `drizzle-kit` snapshot gap reconciled (migrations 0023/0024); per-farm
events partitioning retired outright (migration 0021) after "wire it up properly" was found to
hide a worse defect for any farm signing up post-deploy.

## 4. Verification

| Check | Latest result |
|---|---|
| `pnpm project:check` | Green (unanswered owner decisions are a WARNING, not a failure) |
| `pnpm verify` (2026-08-14, third session, fully uncached, after P2.7) | ✅ **112 test files / 1195 tests, 7/7 builds, 162.34 KB gz** — incl. `theft.integration.test.ts` (real Postgres, P2.6), `HydratedLivestock.test.ts`'s `attachAnimalIds` unit tests (P2.6), and 5 new `landrow:` guard tests in `Outbox.test.tsx` (P2.7: unconditional guard, conditional guard, tri-state `toLandUnitId`, theft's dual guard, next-round recovery) |
| `pnpm test:e2e` (2026-08-14, second session, default lane, after P1/P2.5, NOT re-run for P2.6/P2.7) | ✅ 31 passed / 4 skipped as of P2.5 — neither P2.6 nor P2.7 touches an e2e-relevant surface (no new screen; `pnpm verify`'s vitest coverage, incl. real-Postgres, proves both) so this was not re-run; re-run before calling the branch merge-ready |
| `WERF_REAL_STACK=1` deployed-connectivity e2e (2026-08-14, P1.4) | ✅ Real deployed-headers build, real browser, real CSP, real presigned PUT against MinIO — 2/2 passed. Not re-run after P2.5/P2.6/P2.7 (none touches client/CSP code) |
| `pnpm --filter @werf/web build` (2026-08-14, third session) | ✅ 162.34 KB gz ≤ 250 KB budget |
| Review agents (2026-08-13, owner-triggered, "run all relevant agents") | ✅ `compliance-checker` over `13a0d46..HEAD`: APPROVABLE, zero findings. `sync-auditor` over `dd49a20..HEAD`: 2 MEDIUM + 1 LOW, fixed. `reviewer`: reproduced every claim, no contradictions. **Predates `c2cc48a`/`422e09d`/`6820a21`/`9e1b402`/`256d06a` — see the compliance-pass scope note in §3, not yet re-triggered** |
| Historical baselines (2026-08-08 through 2026-08-13) | Condensed — full detail in git history and `phase-checklists.md` 3b–3i |

## 5. Next executable steps — the punch list, sliced for separate sessions

**Everything through 2026-08-13's compliance-checker/land-hydration work is condensed in §3 — full
narrative in git history and `phase-checklists.md`.** Do not begin payroll on local adapters.
`docs/phase-3-6-scope` still needs rebasing onto `main` before any Phase 3–6 scope-doc work.

**Origin of this list:** JP asked (2026-08-14, second session) for a large implementation-and-
closure pass over a specific punch list, in three priority bands plus a doc/quality band, with an
owner-decision gate partway through. **Second session: P1.1–P1.4 and P2.5 (5/~21). Third: P2.6
and P2.7 closed, P2.8 in progress (7.5/~21).** ⭐ **Budget one session per item, or at most a
tightly related pair (e.g. P2.9+P2.10) — do not batch a whole band.** Each item is independently
scoped and verifiable (own tests, own `pnpm verify`, own commit) — that is what makes slicing safe.

✅ 21–23. Done 2026-08-14 (first session): back-dated-move fail-closed, land hydration, 3i(c),
    3i(b) residuals, O-3's real-stack sweep — see §3. Every **phase-checklist** box is `☑`; the
    punch list below is a stricter pass on top of that, not a reopening of it.
✅ 24. Done 2026-08-14 (second session): **P1 — data-loss/safety blockers, all four, commit `c2cc48a`.**
    SQLite capture durability; attachment orphan create/finalize/sweep race (revive-on-retry +
    symmetric conditional UPDATE); effective-dated withdrawal fail-closed (missing version →
    BLOCKED, never clear); production CSP/CORS (proven in a real browser against a real deploy).
✅ 25. Done 2026-08-14 (second session): **P2.5 — secure attachment reads + FR-603 evidence-pack
    photos, commit `422e09d`.** `POST /attachments/download`; the evidence pack now embeds a
    checksum-verified photo instead of naming an `animals.photo_key` reference nothing ever wrote.
✅ 26. Done 2026-08-14 (third session): **P2.6 — `theft_incident_animals` surrogate id + audit
    columns (issue #10), two commits.** `6820a21`: migration 0025 adds a DB-generated `id` (the
    one `primaryId()` NOT client-generated — this row is only ever written server-side inside
    `LivestockService.createTheftIncident`'s already-idempotent bulk insert), drops the composite
    PK for a partial unique index (relink-after-unlink); removed `NO_SURROGATE_ID` from BOTH
    `derive-local-schema.ts` AND `derive-sync-streams.ts` (the latter an **undocumented second
    copy** the design note missed — without both, no Sync Stream would ever exist). Proven
    against real Postgres (`theft.integration.test.ts`, new). `9e1b402`: `HydratedLivestock.tsx`
    gained a second `HydratedTableStore` for the link table (not a SQL JOIN — the fake
    `LocalDatabase` in `@werf/sync/testing` only recognizes single-table queries), folded onto
    incidents by the new `attachAnimalIds`. `pnpm verify`: 112 files / 1190 tests, 162.28 KB gz.
    ⛔ Touched the stock-theft table — regulated code, adds to §3's compliance-pass scope.

✅ 27. Done 2026-08-14 (third session): **P2.7 — `landrow:` dependency subjects/guards, commit
    `256d06a`.** Went WIDER than the design note: walking every
    `assertOwnedReferences({landUnitId})` call site in the API (not trusting the note) found its
    list — boundary walk, mob, animal — was incomplete. Two live gaps it missed: a MOVE's
    `toLandUnitId` (server sets `event.landUnitId` from it) and a THEFT INCIDENT's own
    `landUnitId` (`ReportTheftScreen.tsx`'s camp picker). Both wired. Checked and EXCLUDED two
    theoretical paths (land-unit self-nesting, per-camp rainfall) — neither field is
    wire-reachable from any capture screen today. Also fixed an adjacent, previously fully-
    unguarded defect in the SAME object literal: no `animalrow:` guard existed for the incident's
    named `animalIds` either, despite the server checking both. Five new tests mirror the
    `mobrow:`/`animalrow:` coverage shape. `pnpm verify`: 112 files / 1195 tests, 162.34 KB gz.
    ⛔ Adds to §3's compliance-pass scope (the theft incident's send path).

🔶 28. IN PROGRESS 2026-08-14 (third session): **P2.8 — a TRUE two-browser O-3 scenario.**
Extended (not replaced) `real-offline-matrix.spec.ts` with a second test, same describe block:
device A registers, then captures a mob + a BACK-DATED birth tally through the REAL capture
screens with `context.setOffline(true)`, reloads on the deep `/animals/groups/count` route while
still offline (real OPFS + real service-worker shell), reconnects, and the real `Outbox.tsx`
flush sends it — then a genuinely SEPARATE `browser.newContext()` (device B) authenticates
independently and hydrates purely through real PowerSync replication. Verified via direct
Postgres query (mob `head_count`, tally `occurred_at`) before device B ever reads anything, same
discipline as the existing REST-based test. Header comment updated to explain both tests now
live there and why neither subsumes the other.
- ✅ The PRE-EXISTING test re-ran clean against the live stack (proves the header/helper edits safe).
- ⛔ **The NEW test has NOT been run end-to-end** — lint/prettier-clean, every selector/route
  borrowed from a passing precedent (`offline-capture.spec.ts`, `real-sync-hydration.spec.ts`,
  `AddMob.test.tsx`, `AdjustMob.test.tsx`), but not a green run. `apps/api`'s registration
  throttle (`security/rate-limits.ts`: burst 2/min→5min block; sustained 5/60min→**60min
  block**) tripped from repeated runs — each test registers once, and the two together in one
  minute trip burst alone. Restarting `apps/api` to clear it **failed and left it stopped**:
  `pnpm --filter @werf/api dev` needs `databaseUrl`, `databaseElevatedUrl`, `jwtSecret`,
  `piiEncryptionKey`, `powerSyncJwtPrivateKey` (+ PowerSync JWT/audience vars, see
  `real-sync-hydration.spec.ts`'s header) via shell env, not a committed `.env` — this session
  didn't hold those. JP chose to skip the live run rather than share them.
- **Next: bring `apps/api` up with its usual env**, run the new test ALONE (`-g "P2.8"`, not
  back-to-back with the REST one — same burst window), wait out/reset the 60min block if still
  live, then commit `real-offline-matrix.spec.ts` and close this item — the diff is written, this
  is a verification step, not a design one.

**29. P2.9 — enforce UUIDv7 at the canonical boundary.** Client-created entities' ids must be
validated as UUIDv7 (not merely `uuidSchema`'s generic UUID check) at the schema/API boundary,
while references to existing rows keep ordinary UUID validation (a reference doesn't need to assert
the referenced row's id format, just that it's a valid UUID). Remove any remaining database-
generated id defaults on tables where OFFLINE creation requires client identity (i.e., every
farmer-capturable table — NOT `theft_incident_animals`, which P2.6 establishes is legitimately
server-authored). Grep `primaryId()` usage vs. which tables' rows a client ever creates offline to
scope this accurately before changing anything.

**30. P2.10 — adversarial tenancy verification.** `packages/sync/test/tenancy.spec.ts` currently
proves the RLS/sync-rule *design* is correct by construction (derived from one `TENANCY` registry).
Add a test that deliberately mutates a policy (an extra permissive `USING (true)` clause, a helper
function body that leaks, a sync-rule filter loosened) and proves the FIXTURE-level two-farm test
actually fails against that mutation — i.e., prove the test suite would catch a real regression, not
just that today's code matches today's derivation.

**31. Owner decision gate — conflict audit mechanism (O-6/O-7/O-8).** Must come AFTER 26–30, not
before. Show JP the current live position/status/sale-vs-death conflict paths (this is the same gap
already flagged open in §3: `db.md`'s "every conflict resolution writes an audit row" has no
implementation and, by design, no LWW-editable field to fire on) and ask him to confirm: (a)
implement a server-only audit/review mechanism now, or (b) explicitly amend `db.md`. **Do not
silently choose either, and do not merely relabel §3's existing open item as closed.** If (a): add
an immutable server-only audit/review table, record both facts/rule/winner/actor/device/timestamps,
flag contradictory sale/death and possible duplicate births without deleting facts, add O-6/O-7/O-8
tests and a review surface.

**32. P3.11 — step-up auth before TOTP/passkey enrolment** (ADR-0011 — read it first, it may already
answer most of the design).

**33. P3.12 — Google-first OIDC/BFF migration phasing.** A phasing/design decision more than a code
slice — may produce a doc (an ADR) rather than shipped code this session.

**34. P3.13 — FR-001 business contact/address fields.** Check `functional-requirements.md` FR-001
for the exact field list before touching schema.

**35. P3.14 — branding-register create/list/link path (FR-601/602) + regulated review.** ⛔ Animal-ID
regulated code — flag for compliance-checker scope, do not call merge-ready without it.

**36. P3.15 — sale-price decimal-string-to-cents parser.** Small, self-contained — good filler if a
session has room after a bigger item. Money is integer cents in TS (CLAUDE.md) — this closes
wherever a decimal string currently reaches a sale capture without a validated parse.

**37. P3.16 — auth hardening batch.** Seven sub-items, likely still too big for one sitting alone —
consider splitting: invitation reuse of soft-deleted identities; narrowing users-table grants; an
auth audit; challenge cleanup; production WebAuthn config; registration-enumeration hardening;
attachment MIME/size/quota controls (the last one touches the attachments pipeline P1.2/P2.5 just
closed — read those commits first, do not re-litigate their design).

**38. Q17 — reconcile STATUS.md/roadmap/phase-checklists.md/architecture docs/testing-strategy.md
against actual code.** By the time this runs, this file's own §5 will likely be stale again — that
is expected; this item is specifically about the OTHER docs, this file is kept current by its own
"update at session end" discipline.

**39. Q18 — implement or honestly label NFR gates** (coverage, Lighthouse, dependency-audit,
regulated-constant, traceability, performance, maintainability). Make traceability phase-aware
before strict mode (a Phase 4/5/6 requirement ID cannot trace to code that doesn't exist yet — that
is not a gap, it is the roadmap).

**40. Q19 — record required real-device/field evidence needs.** What this product needs proven on
an actual farmer's actual phone that no CI run can substitute for — write it down so it isn't
discovered at pilot.

**41. Final — definition-of-done sweep.** `pnpm verify` fully uncached; `pnpm test:e2e` full lane
including `WERF_REAL_STACK=1`; confirm no SEV-1/SEV-2 outstanding from any authorized pass; MED/LOW
fixed or filed; STATUS.md and `phase-checklists.md` tell the same truthful story; do not call Phase
3 (or this punch list) merge-ready until every clause above is evidenced, not asserted.

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
