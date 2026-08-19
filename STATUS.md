# STATUS — current project handoff

> Read this before planning. This file records current state, owner decisions, verification evidence,
> and the next executable slice. Historical session narratives belong in git history, not here.

**Last updated:** 2026-08-19 (twenty-fifth session). ✅ **JP answered all three open questions
((a) mob-move capture; 4d·11's `unresolved` stays a hard stop; the 4d·11 re-verification pass
BATCHED), then asked for that pass — it ran this session.** ✅ **4d·11 re-verification: APPROVABLE
— the fix is genuine, re-derived from the code, not assumed.** ⚠️ **The pass also swept the
uncommitted mob-move capture (FR-151) and found ONE HIGH finding — fixed same session, fail-first
proven**: `possessionTrail` (the stock-theft evidence pack's movement history, FR-603) filtered
`move` events by `animalId`, so a mob-level move (`animalId: null`) was invisible to it — an
individually-identified animal walked only with its flock would print "no movement history" in
the one document meant to prove continuous possession (legal-compliance.md §3.2). Full account in
§3. `pnpm verify` forced-cold: **1570/1570** (+26), lint/typecheck clean, build 7/7, 187.62 KB gz;
`pnpm test:e2e` 31/5 skipped, incl. new a11y coverage for `/animals/groups/move`.
Phase 3 MERGED to `main` as `6823858` (PR #11). Do not re-run P1–P3, 4a/4b/4c, 4e·3, this
session's mob-move capture, or its compliance-checker pass. **Next: build 4e·1's grazing-days
projection, 4e·2 (rest-period, unblocked), or 4e·4/4e·5/4e·6 — JP's pick.**

✅ **4a/4b/4c/4d/4e·3 condensed (18th–23rd sessions) — fully closed, full accounts in
`phase-checklists.md`'s Phase 4 section.** 4a: blocks + plantings. 4b: fertiliser, no compliance
gate. 4c: chemical-products reference + spray capture (PHI resolved server-side, ADR-0005) +
FR-211 report — **whole-branch review CLEARED** (21st session, `3d10103`). 4d: PHI guard
(`phiGuardFor`, shared client+server) + harvest capture + FR-205 override + cross-device race
register (22nd session). 4e·3: inventory items/lots/movements (FR-501), migration `0033` (23rd
session). ⭐ The 21st-session pass caught a stale Turbo cache hit masking a real compile error
behind two earlier "green" `pnpm verify` runs — a `cache hit, replaying logs` line on a package
just touched proves nothing changed, not that nothing is broken.

🔶 **Open decision — chemical_products production data source, asked 2026-08-17 (18th session).**
JP: not decided yet, flag and move on. Dev/test rows ship as explicitly unverified placeholders
(mirrors `regulatory_rates`); blocks production seeding/deployment only, not 4a–4e development.

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
| 4 — Crops & fields | 🔶 **In progress** (4a ☑, 4b ☑, 4c ☑ merge-ready, 4d ☑ **compliance-checker APPROVABLE 25th session (4d·11 re-verified)**; 4e·3 ☑; 4e·1 ◐ mob-move capture built + compliance-checker swept 25th session (one HIGH found+fixed), grazing-days projection still open; 4e·2/4e·4/4e·5/4e·6 open, all unblocked), `phase-4/crops-fields` off `main` @ `6823858` | `phase-checklists.md` §Phase 4 has the full slice plan. ⛔ Production `chemical_products` source still unnamed (18th session). ✅ 4c CLEARED (21st session). ✅ 4d CLEARED (25th session) — see §3. 4e·3 closed 23rd session, no gate of its own. 4e·1: mob-move decision resolved + built + compliance-swept 25th session — see §3 |
| 5 — Labour & wages | Not started | Placeholder rate rows only; deployment needs verified Gazette sources + labour-law review |
| 6 — Finance & compliance packs | Not started | Evidence packs, obligations, fuel/refund, reporting |
| 7 — Hardening & pilot | Not started | Performance, security review, deployment, pilot |

## 2. Audit findings closed (Phase 0–2, historical)

Full detail lives in git history and merged PR #3. Summary: wrong-branch-on-start, an oversized
handoff doc, two incompatible phase maps, the sync-architecture-ahead-of-implementation gap, a
noisy accessibility fixture, human-gated regulated verification, a false uncached-gate timeout, and
missing FR-101 capture controls — all closed before the Phase 2 merge (`13a0d46`).

## 3. Owner decisions

✅ **`compliance-checker` pass on 4d+4e·3, JP-requested 2026-08-18 (24th session) — one real gap
found (4d·11 in `phase-checklists.md`), fixed same session; two more disclosed, not fixed.**
(1) FIXED: legal-compliance.md § 4.3 requires a spray blocked at capture when its PHI would clear
after the block's OWN planned harvest date — only the harvest-side half (FR-205) had been built.
Added `sprayPhiGuardFor` (`@werf/domain`), wired client+server+outbox, same audited-override shape
as 4d·2. ✅ **Re-verified 2026-08-19 (25th session) — APPROVABLE, see the pass entry below.**
(2) FILED, not fixed: the spray product picker doesn't filter/label by crop,
though PHI is registered per-crop under Act 36/1947 (`chemical_products.crop` exists, unused) —
pre-existing (4c), not introduced this session. ✅ (3) **RESOLVED 2026-08-19 (25th session): JP said
leave it a hard stop.** No work done — `usePhiGuard`'s `unresolved` state stays a genuine dead-end,
by owner choice, not an oversight.

◐ **4e·1's mob-move decision RESOLVED (JP chose (a)) and the CAPTURE built, 25th session — the
FR-151 projection itself still open.** `recordMobMove` (`@werf/domain/livestock/movement.ts`,
sibling to `recordMove`) + `LivestockService.recordMobMove`/`mobPositionBefore` (mirrors
`positionBefore`'s total order exactly) + `POST /livestock/mob-moves`. ⭐ The structural risk the
decision named — an animal transferring INTO a mob also stamps that event's own `mob_id`, so a
mob-position read scoped on `mobId` alone would misread it as the WHOLE FLOCK relocating — is
closed and PROVEN (`mobPositionBefore`/`MOB_MOVE_EVENTS_SQL`/`mapHydratedMobMove` all scope on
`animalId IS NULL`; an integration test transfers an animal in and asserts the mob's own camp is
untouched). Client: `LocalMobMoves.tsx` + `MoveMobScreen.tsx` (`/animals/groups/move`, one mob +
one destination per save). Outbox `guardedBy` BOTH `mobrow:`/`landrow:`, proven fail-first.
⭐ `herd.ts`'s `useEffectiveMobs` gained `positionByMob` (the mob twin of `positionByAnimal`) so a
just-captured, unflushed mob move shows on screen immediately, offline — proven in
`MoveMob.test.tsx` with no reload. ⚠️ Deliberately NOT built: a cross-device mob-move race
register (4d·6/4d·11's counterpart) — filed, not dropped. ⭐ Also fixed: a new a11y act asserted
"move to which **camp**" against the e2e fixture's mixed farm, whose word is "block" — the exact
trap `CAPTURE_SCREENS`' own header names for `/land`. **Remainder, not yet built**: the
grazing-days/stocking-rate READ PROJECTION and its screen — the capture above is the primitive it
needed, not the deliverable. 4e·2 (rest-period tracking) is also unblocked, also not yet built.

✅ **`compliance-checker` pass on 4d·11 + the mob-move capture, JP-requested 2026-08-19 (25th
session) — 4d·11 APPROVABLE, one HIGH found+fixed on the mob-move diff.** 4d·11 re-derived from
the code, not assumed: `sprayPhiGuardFor` genuinely blocks, resolves PHI by the spray day (never
`now()`), and the override is server-audited with `by` client-unsettable. **HIGH, mob-move:**
`possessionTrail` (`livestock.service.ts`, the FR-603 evidence pack's movement history) filtered
`events.animalId IN (...)`, so a mob-level move (`animalId: null`) was invisible to it — the exact
defect class already fixed once for whole-flock DOSES (the block right above it in the same
function) was reopened for MOVES by this session's new capture. Fixed by extending the same
`mobMembership`-windowed reconstruction already used for doses to also pull mob-scoped `move`
events, proven fail-first (a temporary revert of just the new block reproduced `expected [] to
have length 1`). `pnpm verify` forced-cold: **1570/1570** (+26), lint/typecheck clean, build 7/7,
187.62 KB gz; `pnpm test:e2e` 31/5 skipped. One earlier `pnpm verify` run hit Postgres
testcontainer contention (270 failures, exactly 2 files, "recovery mode") — both re-ran clean in
isolation and a full re-run passed clean, confirmed transient, unrelated to this fix.

✅ **4e·3 closed (23rd session) — inventory items/lots/movements (FR-501), narrowed from 4e's full
six-item scope on `advisor()` guidance before writing code.** The cut: build 4e·3's schema/RLS/
domain/API completely (the other five sub-items all either depend on 4e·3's tables or are blocked —
see 4e·1 above), plus a real client route, since "a server capability with no client route" is the
half-built shape CLAUDE.md rules against. Migration `0033_inventory` — new `inventory_items`/
`inventory_lots` tables, `'inventory_movement'` appended to the `event_type` enum and to
`FARM_SCOPED_EVENT_TYPES` (stock belongs to the shed, not a herd — the identical `rainfall`/
`boundary_walk` reasoning), `events.inventory_lot_id` column. Domain: `recordInventoryMovement` +
`projectQuantityOnHand` (`packages/domain/src/inventory/stock.ts`) mirror `recordMobTally`/
`projectHeadCount` exactly EXCEPT one deliberate divergence — a `consumed` movement larger than the
recorded quantity is RECORDED, never refused, because a wrong stock figure is not a reason to lose
the record of a real farm event (the spray happened regardless); the projection floors at zero and
reports a `shortfall` flag. Client: `/inventory` (stock list) + `/inventory/receive`, wired through
the SAME local-capture-store/hydration/outbox architecture every other domain uses — the effective
quantity is PROJECTED client-side from the merged local+hydrated movement log, never trusted off
either copy of the lot row (`stock.ts`'s own module note), which matters because a lot's quantity
changes on every movement while its other fields (batch/location) do not. Outbox gained three
FK-only tiers (item → lot → movement, each `guardedBy`/`provides` the row above it) — no
`needsHead`-shaped arithmetic guard needed, unlike a tally, because a shortfall is never refused.
⭐ Two mechanical gotchas closed the same session: `packages/db/src/testing.ts`'s `reset()` TRUNCATE
list needed the two new tables by hand (confirmed `tables.ts`'s own module list is ALSO hand-edited,
contra one Explore-agent claim it was derived — only `SCHEMA_TABLE_NAMES` itself is); and the
`packages/sync/src/testing.ts` fake local database's `watch()` recognizer needed the two new
canonical tables registered by hand or every test mounting `<App/>` threw an unhandled rejection
from `HydratedInventoryProvider`'s always-mounted watch, not just inventory's own tests.

✅ **4d built (22nd session), CLEARED by compliance-checker (25th session, see above).** PHI guard
(`packages/domain/src/crops/phi-guard.ts`, shared client+server) + harvest capture + FR-205
override (audited, migration 0026) + 4d·6's cross-device race register. Client-side ancestor
checking is deliberately LEAF-ONLY (no local `created_at` to bound a split with) — disclosed on
`RecordHarvestScreen.tsx`, server (full ancestor chain) is the authoritative backstop. An advisor
review during design caught a draft that would have broken the OFFLINE case (O-12): the guard
falls back to a local-cache PREVIEW for an unsent spray, mirroring `withdrawal.ts`'s
`clearDateFor`, rather than trusting a server-resolved date a local capture never has.

⚠️ **Self-review same day (22nd session) caught three gaps a green `pnpm verify` could not have —
all closed:** `a11y.spec.ts` never covered ANY crops screen from 4a onward (fixed, 18/18 e2e green,
0 violations — the same gap in 4a/4b/4c's own screens was filed, not fixed here); a real bug in
`RecordHarvestScreen.tsx` (`valid` never checked `harvestedOn !== ''`, permanently disabling Save
on a cleared date — fixed, not a compliance bypass since the guard still blocks in the safe
direction); `AttentionScreen.tsx`'s PHI section had zero render coverage (added).

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
| `pnpm verify`, forced/cold — 4d·11 re-verify + mob-move fix (2026-08-19, 25th session, **the number to trust**) | ✅ **1570/1570 unit tests (+26), lint/typecheck clean, 7/7 builds, 187.62 KB gz.** `pnpm test:e2e` 31/5 skipped. One run hit transient Postgres testcontainer contention, confirmed not a regression (re-ran clean) |
| `compliance-checker` on 4d·11 + mob-move, JP-requested (2026-08-19, 25th session) | ✅ 4d·11 APPROVABLE; one HIGH on mob-move found+fixed same session — full account in §3 |
| `compliance-checker` on 4d+4e·3, JP-requested (2026-08-18, 24th session) | NOT APPROVABLE (1 gap) → fixed as 4d·11, re-verified by the row above |
| Whole-branch `reviewer`+`sync-auditor`+`compliance-checker`, `main..HEAD` (21st session) | ✅ CLEARS — full account in §3. Caught a stale-cache-hit masked typecheck failure |
| `WERF_REAL_STACK=1`, all 5 gated tests, each run isolated (2026-08-17, sixteenth session) | ✅ All pass — two real test-tooling defects found and fixed as `dd1fac8`; full account in §5 item 41 |
| Whole-branch review-agent pass + narrow follow-up (2026-08-17, sixteenth session) | ✅ APPROVABLE — full account in §3 |
| `compliance-checker` `45775ea..ec8336e` / `428200a..45775ea` (fourteenth/twelfth sessions) | ✅ Both CLEARED — full account in §3 |
| Review agents `baf4b4d..428200a` (2026-08-15, fourth session) | ✅ `reviewer`+`sync-auditor`+`compliance-checker` all CLEARED — full account in §3 |
| Historical baselines (2026-08-08 through 2026-08-17) | Condensed — full detail in git history and `phase-checklists.md` 3b–3i |

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
persistent dev Postgres). Every **phase-checklist** box is `☑`; this punch list was a stricter pass on top of that, not a reopening.

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
