# STATUS — current project handoff

> Read this before planning. This file records current state, owner decisions, verification evidence,
> and the next executable slice. Historical session narratives belong in git history, not here.

**Last updated:** 2026-08-17 (twenty-first session). ✅ **4b + 4c closed AND owner-triggered
`reviewer`+`sync-auditor`+`compliance-checker` pass complete — 4c now CLEARS, see the note just
below.** Phase 3 MERGED to `main` as `6823858` (PR #11, merge commit, all 3 CI lanes green at merge).
Do not re-run P1/P2.5–P2.10, conflict audit, P3.11–P3.15 or P3.16.

✅ **Whole-branch `reviewer`+`sync-auditor`+`compliance-checker`, `main..HEAD` on
`phase-4/crops-fields` — CLEARS, 2026-08-17 (twenty-first session, owner-requested).** First pass on
this branch (4a+4b+4c, 78 files). ⛔ **`reviewer` caught a real gate failure this session's earlier
`pnpm verify` runs had MISSED**: `@werf/api:typecheck` was a stale Turbo **cache hit, replaying
logs** both times, masking a genuine `exactOptionalPropertyTypes` compile error in the tie-order test
just added (`[uuidv7(), uuidv7()].sort()` destructures to `string | undefined`, not a fixed tuple).
Fixed with an explicit tuple cast; re-verified with `pnpm turbo typecheck --force` (0 cached, 12/12)
and a fully forced `pnpm verify` chain — **131 files / 1409 tests, 12/12 typecheck, 7/7 builds,
177.66 KB gz, genuinely cold.** ⭐ **Lesson: a green `pnpm verify` log is not proof unless the
typecheck/build legs show `cache miss` or `force executing` — a replayed cache hit proves nothing
changed, not that nothing is broken.** `sync-auditor` and `compliance-checker` independently found
the SAME MED (`listSprayHistory` ordered by `occurredAt` alone — back-dated captures land on the
identical noon instant, so same-day sprays tie with no Postgres ordering guarantee; fixed with the
standard `(occurredAt, id)` total order, fail-first proven). `compliance-checker` additionally found
a MED in the FR-211 report itself: `SpraysScreen.tsx` read `phiDays === undefined` as "not yet
synced" for BOTH that case AND "resolved, product has no PHI on record" — the latter is permanent,
so a fully GlobalGAP-clear spray showed a stale "PHI not yet confirmed" label forever. Fixed the
discriminator to `activeIngredients` (required non-empty on the wire, so present on every hydrated
echo, absent on every local-only capture), added a distinct "no PHI on record" state and a fail-safe
for the still-unreached case of `phiDays` without `earliestHarvestDate`, fail-first proven, and added
`SpraysScreen.test.tsx` (had zero coverage before this pass — how the MED shipped unnoticed). Per
CLAUDE.md §6 clause 3 (mechanical + confined to the named files + fail-first tested), these MED
fixes merge WITHOUT a second compliance-checker pass. **Filed, not fixed**: a schema-level
`.refine()` on `sprayPayloadSchema` to guarantee `phiDays`/`earliestHarvestDate` co-occur, as
defense-in-depth — compliance-checker itself flagged this as not reachable via the current write
path. All findings + fixes: commit `3d10103`. **4c is now MERGE-READY on its own compliance
grounds** — the outstanding PHI-block-at-capture guard (`legal-compliance.md` §4.3) is explicitly
4d's own scope, not a 4c gap; compliance-checker confirmed 4c's spray-capture write path (server-
side PHI resolution, date-in-force lookup, client-write-blocking) is otherwise sound.

✅ **Phase 3 closed clean.** Two SEV-2s found and fixed before merge: OPFS quota loss under device
storage pressure (16th session, `c45cd01`) and a capture buffered only in memory losing a record to
a reload before hydration landed (17th session, `c77debb` — found from a real CI failure on
`offline-capture.spec.ts`, not a review agent; a loaded CI runner widened a race a fast local
machine closed before it could be observed). Whole-branch `reviewer`+`sync-auditor`+
`compliance-checker` pass: APPROVABLE after one fix round. Full account in §3 — do not re-litigate.

🔶 **Open decision — chemical_products production data source, asked 2026-08-17 (18th session).**
JP: not decided yet, flag and move on. Dev/test `chemical_products` rows ship as explicitly
unverified placeholders (mirrors `regulatory_rates`); this blocks production seeding/deployment
only, not 4a–4e development. Revisit before any production deploy that includes spray capture.

✅ **Phase 4 planned in detail (17th session), before any code.** Full slice plan (4a–4e,
schema/API/screen/projection/tests per slice) is in `phase-checklists.md`'s Phase 4 section — read
it first, do not re-derive. Fixed a wrong FR bucketing shared by that file and `roadmap.md` (the
"two incompatible phase maps" defect class, already paid for once).

✅ **4b + 4c closed (21st session) — "fertiliser + chemical reference & spray."** Two separate
commits, split deliberately (advisor guidance): `feat(crops): record a fertiliser application
(FR-206)` landed and verified green FIRST, THEN 4c's migration/domain/screens started, so a
`pnpm verify` failure could never be ambiguous between the two. 4b: `fertiliser` event, filed under
`FARM_SCOPED_EVENT_TYPES` the identical way `planting` is, no compliance gate, `/crops/fertilise`.
4c: migration 0032 `chemical_products` (mirrors `veterinary_products`, `registration_number` NOT
NULL unlike the vet table), `ReferenceService.listChemicalProducts` + client cache, `recordSpray`
(PHI/active-ingredients resolved server-side and stored on the event, ADR-0005 — the wire contract
`recordSprayRequestSchema` deliberately ENUMERATES fields rather than spreading the payload schema,
unlike 4b's fertiliser/planting, so a future payload field can't silently become client-dictatable),
and FR-211's spray-history report (`GET /crops/sprays` + `SpraysScreen.tsx`, built from local cached
data, no invented "season" concept — grepped first, found only a rainfall-specific one). ⭐ A null
`phi_days` is OMITTED from the event, never zeroed — `attachDosing`'s zero-withdrawal-vaccine
precedent, reused rather than re-derived. ⭐ `LocalSprays.tsx` does NOT call the domain `recordSpray`
builder client-side (unlike planting/fertiliser) — it needs the resolved PHI as an input this device
doesn't have, mirroring `LocalHealth.tsx`'s identical treatment/vaccination/dip shape; the hydrated
echo of a device's own spray WINS on merge (`mergeByIdPreferHydrated`) once it carries the resolved
PHI. Two real defects found and fixed along the way: `packages/db/src/schema/tables.ts`'s
hand-maintained schema-MODULE list needed the new file added by hand (caught by
`tenancy.spec.ts`'s classification-vocabulary test going red); `packages/db/src/testing.ts`'s
real-Postgres test-reset TRUNCATE list is ALSO hand-maintained and predates this table, so a fresh
`chemical_products` row leaked across tests until added (caught by the reference-register
integration tests). **Deliberately deferred, named rather than smuggled in or silently missed**: the
"N within PHI" home-tile badge (sits under its own checklist heading; worth pairing with 4d's guard
rather than building the computation twice), and everything 4d itself owns (harvest capture, the PHI
guard, `phiOverride`). ✅ **4c touched regulated code and was reviewed — see the top-of-file review-
pass note; 4c is now merge-ready.** `pnpm test:e2e` default lane: 31 passed / 5 skipped (same gated
real-stack specs as always; current `pnpm verify` numbers are in the review-pass note above, not
repeated here). Next: 4d (harvest + PHI guard, one slice, never split — see the phase-checklist's
own note on why) or 4e (grazing/feed/inventory).

✅ **4a fully closed (4a·1/4a·2/4a·3, 18th–20th sessions) — "blocks & plantings."** 4a·1 (FR-201,
define a block, 18th). 4a·3 (FR-203, record a planting, 19th): new `apps/api/src/crops/` +
`packages/domain/src/crops/` modules; `planting` reuses `FARM_SCOPED_EVENT_TYPES` rather than a
new parallel list; fixed a pre-existing `FirstRunGuide.tsx` mismatch (crop step pointed at
`/harvest`, now `/crops/plant`). **4a·2 (FR-202, split a block, 20th) — and the open
planting-inheritance question ANSWERED: YES, unbounded.** No new server endpoint needed —
`POST /land-units` already accepted `parentId` since Phase 2; `SplitBlockScreen.tsx`
(`/land/split`) is a bulk-creation UI over the existing write path, never closes the parent. New
shared `@werf/domain` primitive `ancestorChainOf` walks `parent_id`; `LocalPlantings.tsx` folds
over it UNBOUNDED (a later planting always wins by the total order, so nothing to bound); 4d's
PHI guard will reuse the same primitive but MUST bound it to `occurred_at` before the child's own
`createdAt` — different callers, one shared walk, named so 4d doesn't reuse the wrong bound. Also
found+fixed a live P2.7-class Outbox gap this slice made real for the first time: land-unit
creation had no `guardedBy` on its own `parentId` — fixed, fail-first proven. ⭐ Advisor review then
caught two more: the picker offered already-split blocks (fixed to leaf-only, one generation, so
4d's per-hop PHI bound stays valid) and the inheritance test asserted a raw COUNT rather than which
rows carried it (rescoped to `within(row)`) — both fail-first proven. Full account in
`phase-checklists.md`'s Phase 4 section. Next: 4b (fertiliser) or 4c (chemical reference + spray —
dev/test unblocked, production seeding waits on JP's source decision above).

**Active branch:** `phase-4/crops-fields`, off `main` @ `6823858` (Phase 3 merge commit).

**Remote state:** Phase 2 merged to `main` via PR #3 (`13a0d46`). Phase 3 merged to `main` via
PR #11 (`6823858`, 2026-08-17) — 3/3 CI lanes green at merge, no post-merge fixes needed.

## 1. Delivery position

| Phase | State | Evidence / boundary |
|---|---|---|
| 0 — Scaffold | Merged | `main` |
| 1 — App shell, auth & 2FA | Merged | PR #2, `9452ebc` |
| 2 — Livestock | ✅ **Merged** | `main` @ `13a0d46` (PR #3, 2026-08-08). Tenth pass cleared — no SEV-1/SEV-2. MED/LOW fixed or filed as issues #4–#9 (not merge blockers) |
| 3 — Offline sync | ✅ **Merged** | `main` @ `6823858` (PR #11, 2026-08-17). Every phase-checklist box `☑`, punch list fully closed, whole-branch review-agent pass cleared after one fix round — full account in §3 |
| 4 — Crops & fields | 🔶 **In progress** (4a ☑ full, 4b ☑, 4c ☑ merge-ready; 4d/4e open), `phase-4/crops-fields` off `main` @ `6823858` | `phase-checklists.md` §Phase 4 has the full 4a–4e slice plan. ⛔ Production `chemical_products` (4c) needs JP to name a maintained Act 36/1947 source — asked 18th session, does not block dev. ✅ 4c's compliance-checker pass CLEARED (21st session) — see top-of-file note |
| 5 — Labour & wages | Not started | Placeholder rate rows only; deployment needs verified Gazette sources + labour-law review |
| 6 — Finance & compliance packs | Not started | Evidence packs, obligations, fuel/refund, reporting |
| 7 — Hardening & pilot | Not started | Performance, security review, deployment, pilot |

## 2. Audit findings closed (Phase 0–2, historical)

Full detail lives in git history and merged PR #3. Summary: wrong-branch-on-start, an oversized
handoff doc, two incompatible phase maps, the sync-architecture-ahead-of-implementation gap, a
noisy accessibility fixture, human-gated regulated verification, a false uncached-gate timeout, and
missing FR-101 capture controls — all closed before the Phase 2 merge (`13a0d46`).

## 3. Owner decisions

✅ **Whole-branch `reviewer`+`sync-auditor`+`compliance-checker`, `main..HEAD` on
`phase-4/crops-fields` — CLEARS, 2026-08-17 (twenty-first session, JP-requested).** Full account is
the top-of-file note — not repeated here to stay under the line budget. Two MED (server-side spray
ordering; FR-211 report's PHI-pending/no-PHI conflation) found and fixed as `3d10103`, both
fail-first proven; one LOW-MED filed rather than fixed (compliance-checker's own call — not
reachable via the current write path). `reviewer` also caught a stale Turbo cache hit masking a real
typecheck failure this session's earlier `pnpm verify` runs had missed. ⛔ New scope opens from
`3d10103` forward.

✅ **Whole-branch `reviewer`+`sync-auditor`+`compliance-checker`, `main...HEAD` — APPROVABLE,
2026-08-17 (sixteenth session, JP-requested).** Full account is the top-of-file note — not
repeated here to stay under the line budget. One SEV-2 (attachment loss under OPFS quota
pressure) + two LOW (grant scoping) found and fixed as `c45cd01`/`47c0ffe`; narrow follow-up
`reviewer` pass over `71f3804..HEAD` confirmed the SEV-2 fix and found nothing new. ⛔ New scope
opens from `47c0ffe` forward.

✅ **Compliance-pass scope `45775ea..ec8336e` — CLOSED 2026-08-16 (fourteenth session,
owner-triggered).** 4 code commits: production WebAuthn config (`c7358b0`), immutable auth audit
log (`016fb5d`), users-table column grants (`fc5759d`), attachment MIME/size/quota (`49677b4`).
**CLEARED, no SEV-1/SEV-2/MED — one LOW, fixed same session (`c12fbfc`), no second pass needed.**
Specifically traced: `auth_audit_log`'s immutability trigger and zero `werf_app` grant are proven
by a test that attempts the forbidden UPDATE/DELETE and asserts both reject, not just documented;
every write site runs on the elevated connection, none on the scoped one; no secret ever enters a
logged row (checked every `metadata:` object, all controlled enums/ids). The 0029 column-grant SQL
was cross-checked against the real 15-column `users` table — the SELECT list names exactly the 10
non-credential columns, no omission, no accidental credential inclusion. The 0030 quota charge was
re-derived from the code: a single conditional `UPDATE ... WHERE attachment_bytes_used + n <= CAP
RETURNING id` inside the same transaction as the row insert/revival, the same TOCTOU-closing idiom
`finalizeAttachment` already uses — genuinely race-safe, not merely asserted to be. Sync/RLS
agreement for `farms.attachment_bytes_used` verified against the actual `TENANCY` registry, not
taken on trust. ⛔ New scope opens from `ec8336e` forward.

✅ **CLOSED 2026-08-16 (fourteenth session) — three P3.16 decisions JP made when asked directly:**
attachment size cap is **25 MB** per attachment; per-farm **quota tracking is IN SCOPE** for the
MIME/size/quota sub-item (JP chose to build it now rather than defer, despite it being new
infrastructure); registration-enumeration hardening (email verification on `/auth/register`) is
**DEFERRED to Phase 7 hardening** — rate limiting narrows the gap meanwhile. The attachment
MIME/size/quota sub-item landed the same session as `49677b4` — P3.16 is now 6/7, see item 37.

✅ **Compliance-pass scope `428200a..45775ea` — CLOSED 2026-08-15 (twelfth session).** 18 commits:
P2.10, conflict audit/review (migration 0026), P3.11–P3.15, P3.16's first two sub-items. **CLEARED,
no SEV-1/SEV-2/MED/LOW.** ⛔ New scope from `45775ea` forward.

✅ **CLOSED 2026-08-14/15 (sessions one/three/four/twelfth), condensed — full detail in git
history:** back-dated-move fail-closed; 3e land hydration; 3i(c) attachment deferred queue; 3i(b)
residuals; O-3 real-stack sweep; P2.6/P2.7/P2.8/P2.9 fixes; conflict audit/review (migration 0026,
immutable `audit_log` + review queue, `(occurred_at,id)` LWW, O-6/O-7/O-8/NFR-211 — §5 item 21-41).
Four review passes (`baf4b4d..428200a` incl.) all CLEARED, no SEV-1/SEV-2/MED; one claimed LOW
REFUTED with evidence (comment existed verbatim).

**Condensed, full detail in git history / `phase-checklists.md` 3b–3i (2026-08-13):** three
`compliance-checker` passes over the animals/moves/health hydration diff → APPROVABLE (`ba7f680`);
a whole-branch `compliance-checker` pass (CLEARED) and a `sync-auditor` pass over attachments (2
MEDIUM + 1 LOW, fixed under §6 clause 3); `drizzle-kit` snapshot gap reconciled (0023/0024);
per-farm events partitioning retired (migration 0021).

## 4. Verification

| Check | Latest result |
|---|---|
| `pnpm project:check` | Green (unanswered owner decisions are a WARNING, not a failure) |
| `pnpm verify`, forced/uncached typecheck+build (2026-08-17, twenty-first session, after the review-pass fixes — the number to trust) | ✅ **131 test files / 1409 tests, 12/12 typecheck, 7/7 builds, 177.66 KB gz** |
| Whole-branch `reviewer`+`sync-auditor`+`compliance-checker`, `main..HEAD` (2026-08-17, twenty-first session) | ✅ CLEARS — full account in the top-of-file note. `reviewer` caught a stale-cache-hit masked typecheck failure; both fixed |
| `pnpm verify` (2026-08-17, twenty-first session, after 4c, BEFORE the review pass — superseded, see above) | 130 test files / 1402 tests, 7/7 builds, 177.56 KB gz — typecheck leg was a false cache hit, do not cite |
| `pnpm test:e2e` default lane (2026-08-17, twenty-first session, after 4c) | ✅ 31 passed / 5 skipped |
| `pnpm verify` (2026-08-17, twenty-first session, after 4b alone, before 4c started) | ✅ **127 test files / 1358 tests, 7/7 builds, 174.74 KB gz** |
| Earlier Phase 4/Phase 3 baselines (4a·1, 4a·3, the Phase 3 SEV-2/LOW fixes, sixteenth session onward) | Condensed — see item 37 |
| `WERF_REAL_STACK=1`, all 5 gated tests, each run isolated (2026-08-17, sixteenth session) | ✅ All pass — two real test-tooling defects found and fixed as `dd1fac8`; full account in §5 item 41 |
| Whole-branch review-agent pass + narrow follow-up (2026-08-17, sixteenth session) | ✅ APPROVABLE — full account in §3 |
| `compliance-checker` `45775ea..ec8336e` (2026-08-16, fourteenth session) | ✅ CLEARED, one LOW fixed same session — full account in §3 |
| `compliance-checker` `428200a..45775ea` (2026-08-15, twelfth session) | ✅ CLEARED, no SEV-1/SEV-2/MED/LOW — full account in §3 |
| Review agents `baf4b4d..428200a` (2026-08-15, fourth session) | ✅ `reviewer`+`sync-auditor`+`compliance-checker` all CLEARED — full account in §3 |
| Historical baselines (2026-08-08 through 2026-08-14) | Condensed — full detail in git history and `phase-checklists.md` 3b–3i |

## 5. Next executable steps — the punch list, sliced for separate sessions

**Everything through 2026-08-13's compliance-checker/land-hydration work is condensed in §3 — full
narrative in git history and `phase-checklists.md`.** Do not begin payroll on local adapters.
`docs/phase-3-6-scope` still needs rebasing onto `main` before any Phase 3–6 scope-doc work.

**Origin of this list, condensed — now fully closed:** JP asked (2026-08-14, second session) for a
large implementation-and-closure pass, three priority bands plus a doc/quality band, one item (or a
tightly related pair) per session. Ran second through sixteenth sessions; every item below closed.

✅ **21–41. Done 2026-08-14 through 2026-08-17 (first–sixteenth sessions), fully closed — condensed,
full detail in git history.** P1 data-loss/safety blockers (SQLite durability, attachment orphan
race, withdrawal fail-closed, prod CSP/CORS, `c2cc48a`); P2.5–P2.10 (secure attachment reads,
`theft_incident_animals` surrogate id, `landrow:` dependency guards, a true two-browser O-3 run,
UUIDv7 schema-boundary enforcement, adversarial tenancy mutants — `422e09d`/`6820a21`/`256d06a`/
`38268b5`/`b88b29b`); conflict audit/review, O-6/O-7/O-8 (migration 0026, immutable `audit_log` +
`conflict_reviews`, `(occurred_at,id)` LWW); P3.11–P3.15 (step-up re-auth, Google-first OIDC/
cookie-BFF, FR-001 business fields, branding register FR-601/602, one shared `parseRandsToCents`);
P3.16 auth-hardening batch, 7/7 (invitation reuse of soft-deleted identities `06ca3d6`, WebAuthn
challenge cleanup `e24a281`, production WebAuthn config `c7358b0`, immutable auth audit `016fb5d`,
users-table column grants `fc5759d`, attachment MIME/size/quota `49677b4` — 25MB/attachment, 5GB/
farm running quota on `farms.attachment_bytes_used`, five-type photo whitelist; registration-
enumeration hardening deferred to Phase 7 as an owner decision, not a gap). Q17/Q18/Q19 closed
(`f875dcc`/`1b036bf`/`testing-strategy.md` §7a's five Phase-3 field-evidence rows). Final
definition-of-done sweep (sixteenth session): `pnpm verify` **116 files/1278 tests, 7/7 builds,
168.78 KB gz**; `pnpm test:e2e` 31/5 skipped; `WERF_REAL_STACK=1` all 5 gated specs pass in
isolation — two real defects found and fixed in test tooling only, `dd1fac8` (a stale MIME literal
predating the P3.16 whitelist, and an unscoped-by-`farm_id` fixture lookup that collided against a
persistent dev Postgres). Every **phase-checklist** box is `☑`; this punch list was a stricter pass
on top of that, not a reopening.

## 6. The review-pass stopping rule (set 2026-08-05 by JP) — ⚠️ SATISFIED, keep it anyway

Decision state, not narrative — restored once already after a compaction deleted it. **Do not delete it again.**

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

**Outcome, 2026-08-17 (Phase 3) — cleared in two passes** (clause 4's ceiling, not breached): pass
one found one SEV-2 + two LOW across three agents; pass two, narrowed to the fix diff alone
(clause 1), found nothing new. APPROVABLE.

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
