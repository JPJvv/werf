# STATUS — current project handoff

> Read this before planning. This file records current state, owner decisions, verification evidence,
> and the next executable slice. Historical session narratives belong in git history, not here.

**Last updated:** 2026-08-20 (thirty-second session). ✅ **Crop home-metrics checklist item CLOSED
— the Sprays tile's "N within PHI" badge, the last item under Phase 4's own "crop-facing home
metrics" heading.** New pure `blocksWithinPhi` (`apps/web/src/crops/usePhiGuard.ts`) runs the
IDENTICAL `phiGuardFor` every other PHI consumer in the file runs — never a second, narrower rule —
called per-block against `farmToday()` rather than a specific harvest date; `useBlocksWithinPhiCount`
wraps it over local+hydrated caches (land units, sprays, chemical products) and feeds
`HomeScreen.tsx`'s `badges.sprays`, the exact `{count, label}` shape `tile.withholding` already
established for Health. ⭐ Deliberately excludes `reason: 'unresolved'` — an unconfirmed spray this
device cannot vouch for is a real gap disclosed elsewhere (the harvest guard blocks on it), but it
is not the fact "within PHI" states, so counting it in would overstate what this badge can actually
compute — proven fail-first in `usePhiGuard.test.ts`, mirroring `phiRegister.test.ts`'s
`localPhiFlags` pure-function split. New `tile.withinPhi` dictionary key, en + af. Both boxes under
Phase 4's "Crop-facing home metrics" heading now ☑ — full account in `phase-checklists.md`.
`pnpm verify` (composite): **1680/1680** (+5), lint/typecheck/build clean, **194.26 KB gz**.
`pnpm test:e2e -- a11y` 33/33 (5 real-stack specs skipped, as expected). Phase 3 MERGED to `main`
as `6823858` (PR #11). Do not re-run P1–P3, 4a–4e·6, or either compliance-checker pass
(25th/29th sessions).
**Next: Phase 4 exit review — checklist sweep on the "Quality gates" heading + whole-branch
compliance-checker pass for 4c/4d's regulated code (JP to trigger), then close the phase.** ⭐
Standing gap to close in that review, not before: three 4e slices (spray's stock-lot picker,
harvest's override UI, feed's mob/camp toggle) have each disclosed rather than closed their
POPULATED-state a11y coverage — worth one sweep across all three rather than three more one-off
fixes. The Sprays-tile badge's own populated-state (badge actually showing) is the identical
disclosed-not-audited posture the pre-existing `tile.withholding` badge already carries — named
here so it reads as consistent with precedent, not a new gap.

✅ **4a/4b/4c/4d/4e·1–4e·6 condensed (18th–31st sessions) — fully closed, full accounts in
`phase-checklists.md`'s Phase 4 section.** 4e·6 (31st session): FR-153 feed consumption — new
`feed` event type (migration `0036`), mob/camp scoping via the existing `assertHerdScoped` guard,
mob's camp/enterprise server-derived never client-trusted, `estimatedUnitCostCents` derives a
weighted-average cost preview rather than accepting a farmer-typed figure (an `advisor()` pass
caught the draft that would have re-typed a re-derivable number). Warning-only, unregulated, no
compliance-checker pass needed. 4a: blocks + plantings. 4b: fertiliser, no compliance
gate. 4c: chemical-products reference + spray capture (PHI resolved server-side, ADR-0005) +
FR-211 report — **whole-branch review CLEARED** (21st session, `3d10103`). 4d: PHI guard
(`phiGuardFor`, shared client+server) + harvest capture + FR-205 override + cross-device race
register (22nd session). 4e·1: grazing-days/rest-days/stocking-rate projection (FR-151, 26th
session). 4e·2: camp rest-period warning threshold (FR-152, farm-wide, warns never blocks, 27th
session). 4e·3: inventory items/lots/movements (FR-501), migration `0033` (23rd session). 4e·4:
inventory auto-decrement on spray/fertiliser capture (FR-502, 28th session), cleared by the
29th-session compliance pass. 4e·5: low-stock/expiry warnings (FR-503, migration `0035`,
warning-only, 30th session). ⭐ The 21st-session pass caught a stale Turbo cache hit masking a real
compile error behind two earlier "green" `pnpm verify` runs — a `cache hit, replaying logs` line on
a package just touched proves nothing changed, not that nothing is broken.

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
| 4 — Crops & fields | 🔶 **Feature-complete, exit review next** (4a ☑, 4b ☑, 4c ☑ merge-ready, 4d ☑ **compliance-checker APPROVABLE 25th session (4d·11 re-verified)**; 4e·1 ☑, 4e·2 ☑, 4e·3 ☑, 4e·4 ☑ **merge-ready, compliance-checker CLEARS 29th session**; 4e·5 ☑ closed 30th session, warning-only; 4e·6 ☑ closed 31st session, warning-only/unregulated; crop home-metrics badge ☑ closed 32nd session), `phase-4/crops-fields` off `main` @ `6823858` | `phase-checklists.md` §Phase 4 has the full slice plan. ⛔ Production `chemical_products` source still unnamed (18th session). ✅ 4c CLEARED (21st session). ✅ 4d CLEARED (25th session) — see §3. 4e·3 closed 23rd session, no gate of its own. 4e·1 closed 26th session, projection covered by the 29th-session pass. 4e·2 closed 27th session (rest-period warning, FR-152). 4e·4 closed 28th session (inventory auto-decrement, FR-502), **compliance-checker CLEARED 29th session — merge-ready**. 4e·5 closed 30th session (low-stock/expiry warnings, FR-503). 4e·6 closed 31st session (feed consumption, FR-153) — every 4e sub-item now done. 32nd session closed the "crop-facing home metrics" checklist heading (Sprays tile's "N within PHI" badge) — every PER-SLICE box in the Phase 4 checklist is now ☑; the "Quality gates" heading's six boxes are still open, by design (they are exit-review sweep items, not slice work — `pnpm verify`/`test:e2e` green, TENANCY/sync-artifact discipline, offline-write discipline, and the batched compliance-checker pass itself); next session is that whole-branch exit review |
| 5 — Labour & wages | Not started | Placeholder rate rows only; deployment needs verified Gazette sources + labour-law review |
| 6 — Finance & compliance packs | Not started | Evidence packs, obligations, fuel/refund, reporting |
| 7 — Hardening & pilot | Not started | Performance, security review, deployment, pilot |

## 2. Audit findings closed (Phase 0–2, historical)

Full detail lives in git history and merged PR #3. Summary: wrong-branch-on-start, an oversized
handoff doc, two incompatible phase maps, the sync-architecture-ahead-of-implementation gap, a
noisy accessibility fixture, human-gated regulated verification, a false uncached-gate timeout, and
missing FR-101 capture controls — all closed before the Phase 2 merge (`13a0d46`).

## 3. Owner decisions

✅ **4e·5's two design questions RESOLVED (JP asked directly, 30th session, before code) — full
account in `phase-checklists.md` 4e·5.** Which slice next: 4e·5 over 4e·6. Expiry scope: "expired"
only this slice, no farm-wide warn-before-N-days setting — avoids a guessed default, same
discipline as 4e·2's rest-period threshold.

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

✅ **4e·1's mob-move decision RESOLVED (JP chose (a)), CAPTURE built (25th session), projection
CLOSED (26th session) — full account condensed above and in `phase-checklists.md` 4e·1.**
`recordMobMove` + `mobPositionBefore` scope strictly on `animalId IS NULL`, proven by an
integration test that transfers an animal INTO a mob and asserts the mob's own camp is untouched
(the structural risk the original decision named). ⚠️ Deliberately NOT built: a cross-device
mob-move race register (4d·6/4d·11's counterpart) — filed, not dropped.

✅ **4e·2's setting-shape decisions RESOLVED (JP asked directly, 27th session) — full account in
`phase-checklists.md` 4e·2.** One farm-wide default, no per-camp override (YAGNI); starts unset,
no seeded default number.

✅ **`compliance-checker` pass on `d331a2c..HEAD` (4e·1 projection + 4e·2 + 4e·4), JP-requested
2026-08-19 (29th session) — CLEARS, no SEV-1/SEV-2.** Re-derived from the code, not STATUS.md's own
claims: `phi-guard.ts` untouched in range; `assertOwnedReferences` genuinely rejects a cross-farm
lot on both spray AND fertiliser (integration-test-proven, not inferred); the Outbox reorder holds
a refused lot's spray/fertiliser correctly across all four occupancy states. 4e·1 genuinely sources
occupancy from live animals/mobs, never the move-log fold alone. 4e·2 genuinely never blocks and is
farm-set, not a hardcoded regulated number. Two LOW fixed, fail-first proven: a stale doc reference
in `GrazingSettings.tsx` (`isRestPeriodPremature` → `restPeriodWarning`); `MoveAnimalsScreen.tsx`'s
rest-period warning gated on "destination named" alone (not `wouldMove.length > 0` like
`MoveMobScreen.tsx`) — naming a resting camp with nothing selected showed a warning for a move that
cannot happen. One LOW disclosed, not actioned: lot OWNERSHIP is enforced server-side, lot CATEGORY
is not (client-UX filter only, no tenancy/compliance consequence — a crafted request could attach a
feed lot's id to a spray event, still farm-owned either way). `pnpm verify` re-run clean:
**1632/1632** (+1), lint/typecheck clean, build 7/7, 190.88 KB gz. 4e·4 is now merge-ready.

✅ **`compliance-checker` pass on 4d·11 + the mob-move capture, JP-requested 2026-08-19 (25th
session) — 4d·11 APPROVABLE, one HIGH found+fixed on the mob-move diff.** 4d·11 re-derived from the
code: `sprayPhiGuardFor` genuinely blocks, resolves PHI by the spray day (never `now()`), override
server-audited with `by` client-unsettable. **HIGH, mob-move:** `possessionTrail`
(`livestock.service.ts`, FR-603 evidence pack) filtered `events.animalId IN (...)`, so a mob-level
move (`animalId: null`) was invisible to it — the same defect class already fixed once for
whole-flock doses, reopened for moves by this session's new capture. Fixed by extending the same
`mobMembership`-windowed reconstruction to pull mob-scoped `move` events too, proven fail-first.
`pnpm verify` forced-cold: **1570/1570** (+26), 187.62 KB gz; `pnpm test:e2e` 31/5 skipped. One
earlier run hit Postgres testcontainer contention, confirmed transient on re-run.

✅ **4e·3 closed (23rd session) — inventory items/lots/movements (FR-501), narrowed from 4e's full
six-item scope on `advisor()` guidance before writing code — full account condensed above and in
`phase-checklists.md` 4e·3.** Migration `0033_inventory`; `recordInventoryMovement`/
`projectQuantityOnHand` mirror the mob-tally shape except a `consumed` movement larger than stock
on hand is RECORDED, never refused; two mechanical gotchas closed same session (`testing.ts`'s
hand-maintained table registries, both `@werf/db` and `@werf/sync`).

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
owner-triggered).** 4 code commits: production WebAuthn config, immutable auth audit log,
users-table column grants, attachment MIME/size/quota (`c7358b0`/`016fb5d`/`fc5759d`/`49677b4`).
**CLEARED, no SEV-1/SEV-2/MED — one LOW, fixed same session (`c12fbfc`).** Traced, not just
documented: `auth_audit_log`'s immutability trigger + zero `werf_app` grant proven by a test that
attempts the forbidden UPDATE/DELETE; the 0029 column-grant SELECT list cross-checked against the
real 15-column `users` table (exactly the 10 non-credential columns); the 0030 quota charge
re-derived as a single conditional `UPDATE ... RETURNING id` in the same transaction as the insert —
genuinely race-safe. Same session, three P3.16 decisions JP made directly: size cap **25 MB**/
attachment; quota tracking **in scope**; registration-enumeration hardening **deferred to Phase 7**.
⛔ New scope opens from `ec8336e` forward.

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
| `pnpm verify` — crop home-metrics PHI badge (2026-08-20, 32nd session, composite command, **the number to trust**) | ✅ **1680/1680 (+5), lint/typecheck/build clean, 194.26 KB gz.** `pnpm test:e2e -- a11y` 33/33 (5 real-stack specs skipped, expected) |
| `pnpm verify` — 4e·6 feed consumption (2026-08-20, 31st session) | ✅ **1675/1675 (+19), lint/typecheck/build clean, 194.15 KB gz.** `pnpm test:e2e -- a11y` 20/20 both themes |
| `pnpm verify` — 4e·5 low-stock/expiry (2026-08-19, 30th session) | ✅ **1656/1656 (+24), lint/typecheck clean, 7/7 builds, 192.32 KB gz.** `pnpm test:e2e -- a11y` 20/20 both themes |
| `compliance-checker` on `d331a2c..HEAD` (4e·1/4e·2/4e·4), 29th session | ✅ CLEARS, no SEV-1/SEV-2. Two LOW fixed (stale doc reference; rest-period warning gating) — full account in §3 |
| `pnpm verify` — 4e·4 (28th)/4e·2 (27th)/4e·1+4d·11 (26th/25th) sessions | ✅ All green, condensed — full per-session numbers in git history and `phase-checklists.md` Phase 4. 25th session hit transient Postgres contention, confirmed not a regression |
| `compliance-checker` on 4d·11+mob-move (25th) / 4d+4e·3 (24th) | ✅ 4d·11 APPROVABLE after one HIGH fixed — full account in §3 |
| Whole-branch `reviewer`+`sync-auditor`+`compliance-checker`, 21st/16th sessions | ✅ Both CLEARS/APPROVABLE — full accounts in §3. 21st caught a stale-cache-hit masked typecheck failure |
| `WERF_REAL_STACK=1`, all 5 gated tests, isolated (sixteenth session) | ✅ All pass — two real test-tooling defects found and fixed as `dd1fac8` |
| `compliance-checker` `45775ea..ec8336e` / `428200a..45775ea` (14th/12th) & review agents `baf4b4d..428200a` (4th) | ✅ All CLEARED — full accounts in §3 |
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
