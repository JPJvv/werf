# STATUS — current project handoff

> Read this before planning. This file records current state, owner decisions, verification evidence,
> and the next executable slice. Historical session narratives belong in git history, not here.

**Last updated:** 2026-08-22 (Phase 5 planning session — plan authored into `roadmap.md` and
`phase-checklists.md` Phase 5, two owner decisions recorded below; NO code written). Previous
substantive state: 2026-08-20 (Phase 3–4 farmer-first commercial audit on
`phase-4/commercial-audit`, based on `main` @ `451f793`). Owner decision ADR-0013 resets the product
boundary: Werf is a private farmer-controlled logbook, planner and calculator, not an authority.

⚠️ **Working-tree reconcile (found 2026-08-22):** the commercial-audit changes are **uncommitted**
in the working tree — `phase-4/commercial-audit` is **0 commits ahead of `main`** (`git log
main..HEAD` is empty). The "passes `pnpm verify`" evidence in this file describes the uncommitted
tree. Nothing is lost, but it is not yet a branch. See §5 for the ordered next steps.

🆕 **Phase 5 owner decisions (2026-08-22), both load-bearing for the plan:**
- **Payroll is ADVISORY, never blocking (ADR-0013 extended to labour).** Attendance/piece-work
  capture never blocks and works offline; the payroll engine computes exactly but surfaces every
  issue (net-below-floor included) as a conspicuous pre-approval warning and STILL generates the
  run. This **supersedes** US-021 scenario 2, `legal-compliance.md §2.4` step 4, and
  `.claude/rules/domain.md`'s reject rule — all three rewritten to advisory in Phase 5 (5e) and put
  to the external labour-law reviewer (5i) for sign-off. Recommendation on record was to KEEP the
  block; JP chose advisory-only. **Recorded as [ADR-0014](docs/03-architecture/adr/ADR-0014-advisory-payroll.md)**
  (precedence 1), and the three superseded statements now carry forward-reference pointers to it.
- **Phase 5 branches from `main` AFTER the P4 audit is merged** (not from the current tree). Order
  in §5.
- **Working method for Phase 5:** Sonnet implements one small slice at a time; `advisor()` (Opus 5)
  is a required per-slice step — before committing to an approach and again before declaring done,
  after the gate is green. Review agents stay owner-triggered only. Full cadence in
  `phase-checklists.md` Phase 5 §"Working method".
Farmers now own their crop and veterinary product catalogue and optional label/interval facts;
Werf snapshots those inputs, calculates transparent reminders, and never blocks recording a spray,
harvest, sale or slaughter. Missing-stock GPS is useful but optional. The unfinished Compliance home tile is dropped. Production now refuses
to boot unless its ordinary DB connection is the forced-RLS `werf_app` role and its narrowly used
elevated maintenance connection is separately configured.

✅ **Farmer-first commercial audit verification:** the final Phase 3–4 tree passes `pnpm verify`
(project coherence, lint/format, forced typecheck, full tests and production build). Focused evidence
also covers 164 livestock API tests, 56 crop API/UI tests, 87 capture/configuration tests and 14
private-reminder screen tests. Commercial deployment still requires the Phase 7 penetration,
operability and pilot gates. A chemical-product source is not a gate because capture uses the farm's
own product list.

Phase 3 MERGED to `main` as `6823858` (PR #11). Do not re-run P1–P3, 4a–4e·6, either
compliance-checker pass (25th/29th sessions), or this session's own mechanical checks above.

✅ **Historical 4a/4b/4c/4d/4e·1–4e·6 record (superseded where ADR-0013 differs) — fully closed, full accounts in
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

✅ **Product-authority decision — accepted 2026-08-20 (ADR-0013).** No production crop-chemical or
veterinary reference-data source is required. Farmers enter the products and label facts they use;
Werf calculates reminders from those entries without verifying, approving or reporting them.

**Active branch:** `phase-4/commercial-audit`, based on `main` @ `451f793`. Phase 5 not started.

**Remote state:** Phase 2 merged to `main` via PR #3 (`13a0d46`). Phase 3 merged to `main` via
PR #11 (`6823858`, 2026-08-17) — 3/3 CI lanes green at merge, no post-merge fixes needed. Phase 4
merged to `main` via PR #13 (`580c611`, 2026-08-20) — 3/3 CI checks green at merge.

## 1. Delivery position

| Phase | State | Evidence / boundary |
|---|---|---|
| 0 — Scaffold | Merged | `main` |
| 1 — App shell, auth & 2FA | Merged | PR #2, `9452ebc` |
| 2 — Livestock | ✅ **Merged** | `main` @ `13a0d46` (PR #3, 2026-08-08). Tenth pass cleared — no SEV-1/SEV-2. MED/LOW fixed or filed as issues #4–#9 (not merge blockers) |
| 3 — Offline sync | ✅ **Merged** | `main` @ `6823858` (PR #11, 2026-08-17). Every phase-checklist box `☑`, punch list fully closed, whole-branch review-agent pass cleared after one fix round — full account in §3 |
| 4 — Crops & fields | ✅ **Merged; farmer-first audit repaired and verified** | PR #13 merged the phase. `phase-4/commercial-audit` replaces authoritative product/PHI logic with farmer-owned inputs and advisory reminders, tightens production RLS configuration, and passes the full gate |
| 5 — Labour & wages | Not started | Placeholder rate rows only; deployment needs verified Gazette sources + labour-law review |
| 6 — Finance & compliance packs | Not started | Evidence packs, obligations, fuel/refund, reporting |
| 7 — Hardening & pilot | Not started | Performance, security review, deployment, pilot |

## 2. Audit findings closed (Phase 0–2, historical)

Full detail lives in git history and merged PR #3. Summary: wrong-branch-on-start, an oversized
handoff doc, two incompatible phase maps, the sync-architecture-ahead-of-implementation gap, a
noisy accessibility fixture, human-gated regulated verification, a false uncached-gate timeout, and
missing FR-101 capture controls — all closed before the Phase 2 merge (`13a0d46`).

## 3. Owner decisions

🕰️ **34th-session whole-branch pass (2026-08-20, `main..HEAD` on `phase-4/crops-fields`) — condensed;
full account in [[phase-4-status]] and git history.** `sync-auditor` CLEARS (one disclosed LOW:
`useSetReorderPoint`/`saveRestPeriodDays` online-only by design, fail honestly). `reviewer` found one
SEV-2, **fixed**: `Outbox.tsx`'s `queue` useMemo read `mobMoves` but omitted it from the dep array,
so a mob move captured post-mount silently never flushed while the strip claimed "Saved and sent";
fixed + fail-first test driven through `MoveMobScreen` post-mount. `compliance-checker` found one
SEV-1, **filed as GitHub issue #12, NOT fixed (JP's explicit call, merge on the SEV-2 fix alone):**
`recordSpray`/`recordHarvest` throw a 4xx with no override when the server PHI guard blocks a capture
that carried none (a stale cross-device cache race) — the refusal lands in `NotSentScreen`, whose
"refusal clears when its cause clears" model has no resubmit-with-override path, so the capture is
stuck in `/not-sent` permanently. Fixing it is new UI on regulated code needing its own pass. #12 is
Phase-5-adjacent by timing only, not mandated (see §5).

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
(2) RESOLVED in the commercial audit: product options name the registered crop and warn when it
does not appear to match the current planting. It deliberately does not hard-filter: both fields
are legacy free text (`grapes` / `Table grapes`), so exclusion would invent a false legal rule.
✅ (3) **RESOLVED 2026-08-19 (25th session): JP said
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

✅ **Phase 2/3-era passes (12th–16th sessions, 2026-08-14…17), all CLOSED — full detail in git
history, condensed here to hold the line budget.** 16th: whole-branch `reviewer`+`sync-auditor`+
`compliance-checker` `main...HEAD` APPROVABLE, one SEV-2 (attachment loss under OPFS quota) + two
LOW fixed (`c45cd01`/`47c0ffe`), follow-up pass found nothing new. 14th: scope `45775ea..ec8336e`
(WebAuthn prod config, immutable auth audit log, users column grants, attachment MIME/size/quota)
CLEARED, one LOW fixed; JP set attachment cap 25 MB, quota in scope, reg-enumeration hardening →
Phase 7. 12th: scope `428200a..45775ea` (18 commits, P2.10 + conflict audit/review migration 0026 +
P3.11–16) CLEARED clean. Sessions 1/3/4: back-dated-move fail-closed, 3e land hydration, 3i
attachment queue/residuals, P2.6–2.9, conflict audit/review + `(occurred_at,id)` LWW; four passes
`baf4b4d..428200a` all CLEARED (one LOW REFUTED with evidence). 3b–3i: hydration passes APPROVABLE
(`ba7f680`), partitioning retired (0021), drizzle snapshot gap reconciled (0023/0024).

## 4. Verification

| Check | Latest result |
|---|---|
| Phase 4 commercial audit (2026-08-20, current branch) | ✅ Forced-cold `pnpm verify`: **1688/1688**, 151/151 files; lint/typecheck clean with 0 Turbo cache hits; build 7/7, 196.30 KB gz. Focused web 75/75; focused Postgres crop/livestock 218/218 |
| `pnpm project:check` | Green (unanswered owner decisions are a WARNING, not a failure) |
| Whole-branch agent pass + SEV-2 fix (2026-08-20, 34th session, **the number to trust**) | ✅ `pnpm verify`: full pass 1630 green + 1 suite hit a transient testcontainer health-check timeout, re-run in isolation clean (51/51) — **1681/1681 real**, lint/typecheck clean (web typecheck genuinely re-ran, cache miss on the edited file). `pnpm build` 7/7, 194.26 KB gz. `Outbox.test.tsx` 53/53 including the new fail-first test |
| Phase 4 exit-review sweep, 33rd session | ✅ `pnpm verify` 1680/1680 (baseline this session's 1681 builds on), artifact-drift/TENANCY/offline-write/a11y sweeps all clean — full account in git history |
| `pnpm verify` — 32nd/31st/30th/28th/27th/26th/25th sessions | ✅ All green, condensed — full per-session numbers in `phase-checklists.md` Phase 4 and git history. 25th hit transient Postgres contention, confirmed not a regression |
| Earlier agent passes (4th–29th sessions, Phase 2–4) | ✅ All CLEARED/APPROVABLE — 29th (4e·1/2/4) CLEARS + 2 LOW; 25th/24th 4d·11 APPROVABLE after 1 HIGH; 21st/16th whole-branch (21st caught a stale-cache typecheck mask); 16th `WERF_REAL_STACK` 5/5 (`dd1fac8`); 14th/12th/4th CLEARED. Full accounts in §3 and git history |

## 5. Next executable steps

Ordered — Phase 5 must not branch until step 2 lands (owner decision 2026-08-22).

1. **Close out the P4 commercial audit.** Commit the uncommitted commercial-audit tree, open its PR
   from `phase-4/commercial-audit`, run CI, merge to `main` (§7: every `main`-bound change goes
   through a PR). The production privacy promise (tenant-private vs delayed provider-blind E2E) is
   still open and touches Phase 5's 5b PII encryption — decide and document it, but it does not block
   Phase 5 starting; 5b uses the current PII-key model and flags the migration exposure.
2. **Branch `phase-5/labour-rates` from `main`.** Its FIRST commit carries the post-merge STATUS.md
   reconcile note (§7 precedent — not a push to `main`).
3. **Answer the two external blockers BEFORE 5a code** (they are not satisfied by reading the repo):
   - **B-1** — book the external labour-law review, with a date. It gates 5i (an exit-gate line) and
     is on someone else's calendar, so book it now, not in week seven. Ask it to bless or overturn
     the advisory-only payroll decision specifically.
   - **B-2** — re-verify every figure in `legal-compliance.md §2.2` against the current Government
     Gazette. Today is 2026-08-22; the NMW (R30.23, eff 2026-03-01) and BCEA threshold (R269,600.90,
     eff 2026-05-01) are the current rows but must still be confirmed and their gazette references
     recorded on every seeded row.
4. **5a** — the rates seed + production seed gate + `listRegulatoryRates` read path + client cache +
   `PayrollRules`/`jurisdictions/za/` + FR-615 admin UI + NFR-507 lint rule. The pure lookup seam
   and the (empty) table already exist — see `phase-checklists.md` Phase 5 reuse map. Standalone
   session, standalone owner-triggered compliance-checker pass.

Production deployment still waits for Phase 7 penetration, operability and pilot evidence.

**Out of scope for Phase 5 unless JP says otherwise:** issue #12 (the PHI override-resubmit dead end)
is Phase-5-adjacent by timing only, not a Phase 5 work item; FR-320 SIZA pack is Phase 6.

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
- ⛔ **Every `main`-bound change goes through a PR, no exceptions** (`github-strategy.md`: PR
  required even solo). One exception exists on record: `1dc00ef` (2026-08-20, Phase 4's post-merge
  STATUS.md reconcile) was pushed straight to `main` — the token has an admin bypass on branch
  protection and it went unnoticed until after push. Content was correct and low-risk; left as-is
  rather than force-pushing `main` to erase it (JP's call). The actual Phase 2→3/3→4 precedent for
  a post-merge reconcile note is to make it the FIRST commit of the NEXT phase's branch, not push
  to `main` directly at all — follow that shape once Phase 5 branches, not this one's shortcut.
