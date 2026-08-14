# STATUS — current project handoff

> Read this before planning. This file records current state, owner decisions, verification evidence,
> and the next executable slice. Historical session narratives belong in git history, not here.

**Last updated:** 2026-08-14 (second session that day). Session goal, as set by JP: a large
"implementation and closure session" over a big pre-agreed punch list (P1 data-loss/safety
blockers, P2 completeness gaps, an owner-decision gate, P3 items, doc/quality closure). **The
punch list was too large for one session — this is a mid-list handoff, not a completion.** Closed
this session: all four P1 blockers (SQLite capture durability, the attachment orphan
create/finalize/sweep race, the effective-dated withdrawal fail-closed fix, production browser
CSP/CORS) and P2.5 (secure attachment reads + the FR-603 evidence pack actually embedding a
verified photo). **17 of the ~21 items on the punch list remain — see §5 for the full sliced
list, sized for separate sessions.** Do not re-run the P1/P2.5 work; do not re-derive the P2.6
design already worked out below.

**Active branch:** `phase-3/powersync-foundation`, off `main` @ `13a0d46`, HEAD `422e09d` (P2.5) ←
`c2cc48a` (P1.1–P1.4) ← `5e1957f` (3i(b)). Not pushed — local commits only, awaiting go-ahead.

**Remote state:** Phase 2 merged to `main` via PR #3 (`13a0d46`); both CI lanes were green at merge.

## 1. Delivery position

| Phase | State | Evidence / boundary |
|---|---|---|
| 0 — Scaffold | Merged | `main` |
| 1 — App shell, auth & 2FA | Merged | PR #2, `9452ebc` |
| 2 — Livestock | ✅ **Merged** | `main` @ `13a0d46` (PR #3, 2026-08-08). Tenth pass cleared — no SEV-1/SEV-2. MED/LOW fixed or filed as issues #4–#9 (not merge blockers) |
| 3 — Offline sync | 🔶 Every phase-checklist box `☑`; a SEPARATE punch list of P1/P2/P3/quality items (opened 2026-08-14, this session) sits on top of the checklist and is 5/~21 done | 3a–3i all CLOSED (§3, historical): 3e in full, 3i(b)/3i(c), O-3. **This session's punch list (not phase-checklist items, a stricter closure pass JP asked for on top of the checklist):** P1.1–P1.4 (data-loss/safety) and P2.5 done — commits `c2cc48a`, `422e09d`. P2.6–P2.10, an owner-decision gate, P3.11–P3.16, and Q17–Q19 remain — full sliced list in §5 |
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
fail-closed fix, land hydration, 3i(c)'s `animalrow:` guard addition, **and now this session's
`c2cc48a` (touches FR-131 withdrawal resolution) and `422e09d` (touches the FR-603 evidence
pack)**. Say so before calling any of this merge-ready; per CLAUDE.md, the owner decides when to
trigger the pass. The remaining punch-list slices in §5 will keep adding to this same scope —
P2.6 (stock theft), P3.14 (branding/animal ID), P3.16 (auth/POPIA) are each regulated-code
touches in their own right.

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
| `pnpm project:check` | Green (unanswered owner decisions are a WARNING, not a failure) |
| `pnpm verify` (2026-08-14, second session, fully uncached, after P1.1–P1.4 + P2.5) | ✅ **111 test files / 1181 tests, 7/7 builds, 162.10 KB gz** — incl. real-Postgres + real-MinIO attachment, orphan-sweep, and evidence-pack photo integration tests |
| `pnpm test:e2e` (2026-08-14, second session, default lane, after both commits) | ✅ 31 passed / 4 skipped (all four `WERF_REAL_STACK`-gated real-stack specs, incl. the new deployed-connectivity pair, correctly skip by default) |
| `WERF_REAL_STACK=1` deployed-connectivity e2e (2026-08-14, P1.4) | ✅ Real deployed-headers build, real browser, real CSP, real presigned PUT against MinIO — 2/2 passed. Not re-run after P2.5 (P2.5 touches no client/CSP code) |
| `pnpm --filter @werf/web build` (2026-08-14, second session) | ✅ 162.10 KB gz ≤ 250 KB budget |
| Review agents (2026-08-13, owner-triggered, "run all relevant agents") | ✅ `compliance-checker` over `13a0d46..HEAD`: APPROVABLE, zero findings. `sync-auditor` over `dd49a20..HEAD`: 2 MEDIUM + 1 LOW, fixed. `reviewer`: reproduced every claim, no contradictions. **Predates this session's `c2cc48a`/`422e09d` — see the compliance-pass scope note in §3, not yet re-triggered** |
| Historical baselines (2026-08-08 through 2026-08-13) | Condensed — full detail in git history and `phase-checklists.md` 3b–3i |

## 5. Next executable steps — the punch list, sliced for separate sessions

**Everything through 2026-08-13's compliance-checker/land-hydration work is condensed in §3 — full
narrative in git history and `phase-checklists.md`.** Do not begin payroll on local adapters.
`docs/phase-3-6-scope` still needs rebasing onto `main` before any Phase 3–6 scope-doc work.

**Origin of this list:** JP asked (2026-08-14, second session) for a large implementation-and-
closure pass over a specific punch list, in three priority bands plus a doc/quality band, with an
owner-decision gate partway through. **One session got through P1.1–P1.4 and P2.5 (5 of ~21
items) before running out of room.** ⭐ **Budget one session per item below, or at most a tightly
related pair (e.g. P2.9+P2.10) — do not attempt to batch a whole band in one sitting; that is what
made this session's list too big.** Each item is independently scoped and independently
verifiable (own tests, own `pnpm verify`, own commit) — that is what makes slicing safe.

✅ 21–23. Done 2026-08-14 (first session): back-dated-move fail-closed, land hydration, 3i(c),
    3i(b) residuals, O-3's real-stack sweep — see §3. Every **phase-checklist** box is `☑`; the
    punch list below is a stricter pass on top of that, not a reopening of it.
✅ 24. Done 2026-08-14 (second session): **P1 — data-loss/safety blockers, all four, commit `c2cc48a`.**
    SQLite capture durability (`append()` resolves only once durable; whole-database-open retry).
    Attachment orphan create/finalize/sweep race (revive-on-retry + symmetric conditional UPDATE).
    Effective-dated withdrawal fail-closed (every product version cached; missing version → BLOCKED,
    never clear). Production CSP/CORS (generated deployed headers; MinIO/S3 CORS; proven in a real
    browser against a real deployed build).
✅ 25. Done 2026-08-14 (second session): **P2.5 — secure attachment reads + FR-603 evidence-pack
    photos, commit `422e09d`.** `POST /attachments/download`; the evidence pack now embeds a
    checksum-verified photo instead of naming an `animals.photo_key` reference nothing ever wrote.

### Not started — P2.6 through the final close-out, in order

**26. P2.6 — `theft_incident_animals` surrogate id + audit columns (Issue #10). Design is DONE,
ready to implement without re-deriving it:**
- Root cause, confirmed: `packages/sync/scripts/derive-local-schema.ts`'s `NO_SURROGATE_ID` set
  excludes this table because it has a composite `(incident_id, animal_id)` PK and no `id` —
  PowerSync needs a single-column identity. `packages/sync/test/local-schema.spec.ts` pins this as
  a "known gap" test. This is *why* a hydrated theft incident's `animalIds` is always `[]`.
- New additive migration (`packages/db/migrations/0025_...sql`, follow `0015_evidence_authorship.sql`
  and `animals.ts`'s `animalIdentifiers` table as the two closest precedents): add
  `id uuid DEFAULT uuid_generate_v7() NOT NULL` (backfills existing rows via the function default —
  safe, small table), `updated_at`, `deleted_at`, `created_by`, `updated_by`; drop the composite PK;
  add `PRIMARY KEY (id)`; replace the dropped uniqueness with a **partial** unique index on
  `(incident_id, animal_id) WHERE deleted_at IS NULL` (exactly `animal_identifiers_unique`'s shape —
  lets an unlinked animal be relinked, matches "soft-delete only"). Recreate
  `theft_incident_animals_incident_idx` with the same `WHERE deleted_at IS NULL` filter. No RLS/GRANT
  change needed — `farm_id` and the existing policy are untouched.
- Mirror the migration in `packages/db/src/schema/theft.ts`'s `theftIncidentAnimals` table def
  (`primaryId()` + `auditColumns` + `createdBy`/`updatedBy` + the partial `uniqueIndex`, same shape
  as `animalIdentifiers` in `animals.ts`).
- Remove `'theft_incident_animals'` from `NO_SURROGATE_ID` in `derive-local-schema.ts`; update/replace
  the "excludes theft_incident_animals" test in `local-schema.spec.ts` (and the
  `if (tableName === 'theft_incident_animals') continue` skip in the same file) — it should now
  assert the table **is** present, watched to fail against pre-migration code first.
- The link's own `id` does **not** need to be client-generated: unlike `attachments`, this row is
  never independently offline-captured — it is only ever written server-side inside
  `LivestockService.createTheftIncident`'s bulk insert, and that whole call is already idempotent by
  the incident's own client-generated id. A DB-side default is correct; no wire-contract change to
  `newTheftIncidentSchema` is needed.
- Once synced, wire the actual client hydration read (a `HydratedTheft.tsx` alongside
  `HydratedLivestock.tsx`/`HydratedLand.tsx`, merged into `LocalTheft.tsx` the same way `LocalLand.tsx`
  merges hydrated + local) — the schema fix alone does not close the bug if nothing reads the synced
  rows. This is the part most likely to eat the session; consider splitting the migration/schema half
  from the client-hydration half into two commits (still one session, two verified steps).
- Tests: a real-Postgres integration test proving the surrogate id round-trips and the partial unique
  index allows relink-after-unlink; the flipped `local-schema.spec.ts` assertion; a client-side
  hydration test analogous to 3e's animals/land hydration tests proving `animalIds` is populated
  after a raw-REST-authored incident is read back through the local store on a second device.
- ⛔ Touches the stock-theft table — regulated code (§3's compliance-pass scope note applies).

**27. P2.7 — `landrow:` dependency subjects/guards** (already tracked as an open item in §3, closed
by doing this slice). `Outbox.tsx` has a `mobrow:`/`animalrow:` synthetic-subject pattern so a
capture referencing a not-yet-accepted mob/animal is HELD, not 404-set-aside. Add the equivalent
`landrow:` guard for `land_unit_id` references (a move, an animal create, a boundary walk). Cover:
boundary walks, mobs, animals, and the next-round recovery once the referenced land unit is
eventually accepted. A hydrated-only land unit needs no guard (already true today, per §3's note).

**28. P2.8 — a TRUE two-browser O-3 scenario.** The current `real-offline-matrix.spec.ts` proves
`occurred_at` survives via direct REST + one hydration read — useful but not the actual claim
(offline capture → reconnect → flush → second device). Replace/extend it: device A captures into
SQLite with the network OFF, closes and reopens the browser (OPFS survives), reconnects, the Outbox
flushes for real, Postgres gets the exact `occurred_at`, and a SEPARATE Playwright browser context
(device B) hydrates through real PowerSync and projects correctly. Two real `browser.newContext()`s,
not one context reused.

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
