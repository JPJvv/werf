# STATUS — current project handoff

> Read this before planning. This file records current state, owner decisions, verification evidence,
> and the next executable slice. Historical session narratives belong in git history, not here.

**Last updated:** 2026-08-15 (twelfth session). Continuing JP's Phase 3 punch-list closure.
**P3.11–P3.15 and the conflict-audit gate are closed; P2.9's schema half is closed; P3.16 is
3/7 sub-items closed** (see §5). **About 4 of ~21 punch-list items remain.** Do not re-run
P1/P2.5–P2.10, conflict audit or P3.11–P3.15.

✅ **Owner-triggered `compliance-checker` over `428200a..45775ea` (18 commits: P2.10, conflict
audit, P3.11–P3.15, P3.16's first two sub-items): CLEARED, no SEV-1/SEV-2/MED/LOW.** Full account
in §3. Earlier: `reviewer` + `sync-auditor` + `compliance-checker` over `baf4b4d..428200a`, also
ALL CLEARED — `reviewer`'s one LOW (a STATUS.md mis-citation) was checked and REFUTED. ⛔ Commit
`c7358b0` (P3.16's third sub-item) landed AFTER that pass and is NOT yet compliance-reviewed —
low-risk (a boot-time env-validation gate, not regulated code), but new scope for the next pass.

**Active branch:** `phase-3/powersync-foundation`, off `main` @ `13a0d46`; committed work through
`c7358b0` (P3.16 production WebAuthn config) ← `e24a281` (P3.16 challenge sweep) ← `06ca3d6`
(P3.16 invite fix) ← `aa2b023` (P3.15 parser). Older chain is in git history. Not pushed — local
commits only.

**Remote state:** Phase 2 merged to `main` via PR #3 (`13a0d46`); both CI lanes were green at merge.

## 1. Delivery position

| Phase | State | Evidence / boundary |
|---|---|---|
| 0 — Scaffold | Merged | `main` |
| 1 — App shell, auth & 2FA | Merged | PR #2, `9452ebc` |
| 2 — Livestock | ✅ **Merged** | `main` @ `13a0d46` (PR #3, 2026-08-08). Tenth pass cleared — no SEV-1/SEV-2. MED/LOW fixed or filed as issues #4–#9 (not merge blockers) |
| 3 — Offline sync | 🔶 Every phase-checklist box `☑`; a SEPARATE punch list of P1/P2/P3/quality items (opened 2026-08-14) sits on top of the checklist and is ~17/~21 done | 3a–3i all CLOSED (§3, historical): 3e in full, 3i(b)/3i(c), O-3. **Punch list (not phase-checklist items, a stricter closure pass JP asked for on top of the checklist):** P1.1–P1.4, P2.5–P2.10, conflict audit and P3.11–P3.15 are done; P3.16 is 3/7 sub-items done. 4 of P3.16's sub-items plus Q17–Q19 remain — full sliced list in §5 |
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

✅ **Compliance-pass scope `428200a..45775ea` — CLOSED 2026-08-15 (twelfth session,
owner-triggered).** 18 commits: P2.10 adversarial tenancy verification, the conflict audit/review
feature (migration 0026), P3.11–P3.15, and P3.16's first two sub-items (invite soft-deleted-
identity fix, WebAuthn challenge sweep). **CLEARED, no SEV-1/SEV-2/MED/LOW.** Specifically traced:
no hardcoded regulated numbers introduced; `parseRandsToCents` (P3.15) never crosses a float
boundary and all three call sites it replaced were verified actually switched over; P3.13's seven
new business-contact/address columns are excluded from every Sync Stream (asserted by
`tenancy.spec.ts`, not just documented); `audit_log` immutability is proven by an integration test
that attempts both an `UPDATE` and a `DELETE` against a real row and asserts both are rejected;
P3.16's invite fix is proven to both refuse the membership AND leave the erased row un-revived.
P3.12 (Google OIDC/BFF) confirmed docs-only in this range, nothing to check yet. ⛔ New scope opens
from `45775ea` forward.

✅ **CLOSED 2026-08-15 — owner chose A: implement conflict audit/review now.** Migration 0026 adds
immutable server-only `audit_log` evidence plus a separate review queue; both facts, rule, winner,
actor/session and timestamps are retained, and events are never rewritten. Movement uses
`(occurred_at,id)` LWW; death outranks sale; separate similar birth batches are flagged while one
shared batch protects legitimate multiples. RLS-scoped API/cache/UI and owner/manager review are
built. O-6/O-7/O-8/NFR-211 have real-Postgres coverage; full detail is in §5 item 31.

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

✅ **Compliance-pass scope through `baf4b4d` — CLOSED 2026-08-14 (third session, top-of-file
note).** Covered `9b7fa2e..3a1993c`: back-dated-move fail-closed, land hydration, 3i(c)'s
`animalrow:` guard, `c2cc48a`, `422e09d`, P2.6's `6820a21`/`9e1b402`, P2.7's `256d06a`.

✅ **Review scope `baf4b4d..428200a` — CLOSED 2026-08-15 (fourth session, owner-triggered).**
Covered `a6b0c1a` (P2.8 bootstrap repair) + P2.9's UUIDv7 tightening. All three agents CLEARED, no
SEV-1/SEV-2/MED. `reviewer`'s one LOW (a claimed `auth.service.ts` citation) was checked and
REFUTED — the comment exists verbatim at `auth.service.ts:68-71`; nothing changed. ⛔ New scope
opens from `428200a` forward.

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
| `pnpm verify` (2026-08-15, twelfth session, fully uncached, after P3.16's first three sub-items) | ✅ **115 test files / 1251 tests, 12/12 typecheck tasks, 7/7 builds, 168.09 KB gz** |
| `pnpm test:e2e` (2026-08-15, tenth session, default lane, after P3.14) | ✅ 31 passed / 5 skipped — light/dark capture-screen a11y includes `/animals/brands`; the 3 `WERF_REAL_STACK`-gated specs still require the final live-stack sweep |
| `WERF_REAL_STACK=1` P2.8 e2e + deployed-connectivity (2026-08-14/15) | ✅ Both passed as of P2.8; superseded rows condensed — full detail in git history |
| `compliance-checker` `428200a..45775ea` (2026-08-15, twelfth session) | ✅ CLEARED, no SEV-1/SEV-2/MED/LOW — full account in §3 |
| Review agents `baf4b4d..428200a` (2026-08-15, fourth session) | ✅ `reviewer`+`sync-auditor`+`compliance-checker` all CLEARED — full account in §3 |
| Historical baselines (2026-08-08 through 2026-08-14) | Condensed — full detail in git history and `phase-checklists.md` 3b–3i |

## 5. Next executable steps — the punch list, sliced for separate sessions

**Everything through 2026-08-13's compliance-checker/land-hydration work is condensed in §3 — full
narrative in git history and `phase-checklists.md`.** Do not begin payroll on local adapters.
`docs/phase-3-6-scope` still needs rebasing onto `main` before any Phase 3–6 scope-doc work.

**Origin of this list:** JP asked (2026-08-14, second session) for a large implementation-and-
closure pass over a specific punch list, in three priority bands plus a doc/quality band, with an
owner-decision gate partway through. **Second–sixth sessions: P1/P2 through conflict audit closed
(10.5/~21). Seventh–tenth: P3.11–P3.14 closed (14.5/~21). Eleventh: P3.15 closed (15.5/~21);
P2.9's DB-default half remains separate.** ⭐ **Budget one
session per item, or at most a tightly related pair (e.g. P2.9+P2.10) — do not batch a whole band.**
Each item is independently scoped and verifiable (own tests, own `pnpm verify`, own commit) — that is
what makes slicing safe.

✅ 21–30. Done 2026-08-14/15 (first–fifth sessions), condensed — full detail in git history:
back-dated-move fail-closed + land hydration + 3i(c) attachment queue + 3i(b) residuals + O-3
real-stack sweep (session 1, `1b429d5`/`8dcdaf5`); **P1** data-loss/safety blockers — SQLite
durability, attachment orphan race, withdrawal fail-closed, production CSP/CORS (session 2,
`c2cc48a`); **P2.5** secure attachment reads + FR-603 evidence-pack photos (session 2, `422e09d`);
**P2.6** `theft_incident_animals` surrogate id + audit columns — found an undocumented SECOND
`NO_SURROGATE_ID` copy in `derive-sync-streams.ts` the design note missed (session 3,
`6820a21`/`9e1b402`); **P2.7** `landrow:` dependency guards, went wider than its own design note,
which had missed a move's `toLandUnitId` and a theft incident's `landUnitId` (session 3,
`256d06a`); **P2.8** a true two-browser O-3 scenario — the earlier blocked run's root cause was
reproducibility (stray per-shell secrets), not the rate limiter, fixed via `pnpm setup:local` /
`pnpm real-stack:up` (session 5, `38268b5`); **P2.9** schema-boundary UUIDv7 enforcement — caught
three real-stack e2e specs minting v4 ids by mistake; DB-default removal deliberately deferred (87
test call sites rely on it as fixture convenience) (session 4); **P2.10** adversarial tenancy
verification with three reversible RLS/Sync-Stream mutants (session 5, `b88b29b`). Every
**phase-checklist** box is `☑`; this punch list is a stricter pass on top of that, not a reopening.

✅ **31. Done 2026-08-15 (sixth session): owner chose A — conflict audit/review (O-6/O-7/O-8).**
Migration `0026_conflict_audit` creates immutable `audit_log` plus operational
`conflict_reviews`; both are `server-only` in sync, tenant-scoped by RLS, and events keep
`source_session_id` as a never-synced provenance column. Deterministic conflict keys make retries
idempotent. Cross-device movement disagreement audits both values and applies `(occurred_at,id)`
LWW; sale/death retains both events while projecting dead; possible duplicate calvings retain every
calf/birth for human review, while all calves from one legitimate multiple birth share one batch id.
`GET /conflicts` and `POST /conflicts/:id/review` expose the scoped queue; the cached offline review
surface is integrated into “Needs your attention” and its home count. Verification: **113 files /
1210 tests, 12/12 typecheck tasks, 7/7 builds, 164.57 KB gz**. O-6/O-7/O-8, audit immutability,
review closure, legitimate twins, and cached UI copy all have direct coverage.
✅ **32. Done 2026-08-15 (seventh session): P3.11 — recent step-up before TOTP/passkey enrolment.** Both enrolment-start routes require a full human authentication no older than 10 minutes; refresh rotation preserves the original `authenticated_at`, so a stolen long-lived session cannot mint a TOTP seed or WebAuthn registration challenge. A stale caller receives 403 `STEP_UP_REQUIRED`, and the English/Afrikaans client clears the old session and returns to full sign-in, where an existing passkey remains the preferred phishing-resistant route and TOTP/recovery remains ADR-0011's transitional fallback.
Real-Postgres guard and browser recovery coverage: **46/46 focused; `pnpm verify` 113 files / 1212 tests, 12/12 typecheck tasks, 7/7 builds, 164.84 KB gz**.

✅ **33. Done 2026-08-15 (eighth session): P3.12 — Google-first OIDC/cookie-BFF migration phasing,
commit `cd0d3c0`.** Seven additive slices cover identity/audit, explicit linking, FR-014-preserving
login, passkey recovery/onboarding, dual bearer/cookie migration, old-PWA overlap and password
retirement. No email-equality linking or farm authority; offline queues survive every rollback.
`pnpm verify`: **113 files / 1212 tests, 12/12 typecheck tasks, 7/7 builds, 164.84 KB gz**.

✅ **34. Done 2026-08-15 (ninth session): P3.13 — FR-001 business contact/address fields, `144e7bc`.** Shared contract + bilingual onboarding require one contact and a complete address; migration 0027 stores them atomically while keeping old rows valid. Real Postgres proves persistence; incomplete UI input stays local; all seven personal-data fields are excluded from PowerSync/member devices.
`pnpm verify`: **113 files / 1217 tests, 12/12 typechecks, 7/7 builds, 165.88 KB gz**.
⛔ Not merge-ready until JP requests the owner-triggered compliance pass over this POPIA-adjacent scope.

✅ **35. Done 2026-08-15 (tenth session): P3.14 — branding-register create/list/link path
(FR-601/602), `764c53e`.** Bilingual offline create/list captures the registered mark, certificate, method, covered species, body position and registration date; PowerSync hydration merges it across devices. The outbox sends a mark before its linked animal and holds the animal on a permanent mark refusal. API tenancy/authorship/jurisdiction, idempotency, DB-rule translation and species-safe
linking have real-Postgres coverage. The unmarked-past-window alert remains deferred until verified,
effective-dated prescribed-window data exists — no legal number was guessed. ⛔ Animal-ID regulated
code: owner-triggered compliance-checker still gates merge-ready.

✅ **36. Done 2026-08-15 (eleventh session): P3.15 — sale-price decimal-string-to-cents parser,
commit `aa2b023`.** `AddAnimalScreen.tsx`, `AdjustMobScreen.tsx` and `RecordLossScreen.tsx` each
hand-rolled an identical, untested `toCents(rands) = Math.round(Number(rands) * 100)` — a
hand-written duplicate of the same shape the repo has been bitten by before. Replaced with one
`parseRandsToCents` in `@werf/core/money.ts`: string-based (not `Number(x)*100`, which crosses a
float boundary — `0.1*100` is `10.000000000000002` in IEEE 754), and refuses a third typed decimal
digit (e.g. `"150.999"`) as a likely typo rather than silently rounding it to R151.00. AdjustMob's
price stays optional (a trade with no price is still a valid trade); AddAnimal/RecordLoss keep it
required — that business-rule difference lived in each screen's own `priceIsValid` wrapper before
and still does, only the actual parsing arithmetic was shared. `pnpm verify`: **114 test files /
1245 tests, 12/12 typecheck tasks, 7/7 builds, 168.09 KB gz**.

**37. P3.16 — auth hardening batch. 3/7 sub-items done 2026-08-15 (twelfth session).** All seven
sub-items are pre-scoped in `docs/05-operations/security.md` §10.2 — read that table before
picking the next one; it names the exact fix for each, not just the gap.
✅ **Invitation reuse of soft-deleted identities, commit `06ca3d6`.** `FarmsService.invite`
looked up an existing `users` row with no `deleted_at` filter, so a POPIA-erased identity was
pulled back into a live `farm_users` membership and back into the `users_self_and_comembers`
co-member RLS policy's visibility (that policy is keyed off `farm_users`, not `users.deleted_at`).
Now refuses the invite outright, mirroring `AuthService.register`'s existing precedent for the
same row shape — also sidesteps falling through to an insert that would hit `users.email`'s
UNIQUE constraint, since erasure does not free the address. Fail-first verified (reverted just the
service change, confirmed the new test failed, restored).
✅ **Challenge cleanup, commit `e24a281`.** `WebauthnChallengeSweepService` hard-deletes consumed
or expired `webauthn_challenges` rows on the same one-minute `@Cron` cadence as the existing
`MembershipExpiryService` — a hard delete, not a tombstone, since this table carries no
`deleted_at` and is exempt from the soft-delete rule for the same reason `user_sessions` is. Fail-
first verified (flipped the `or` predicate to `and`, confirmed the test failed, restored).
✅ **Production WebAuthn config, commit `c7358b0`.** `loadConfig` now refuses to boot when
`NODE_ENV=production` and `WEBAUTHN_RP_ID`/`WEBAUTHN_ORIGIN` are unset, checked against the raw
env values (not the parsed `localhost` defaults) so a coincidental match can't mask the same
misconfiguration — mirrors `MailModule`'s existing production-only-required pattern. Not a
security hole either way (the browser already fails closed on an RP ID/origin mismatch), purely a
diagnosability fix. Fail-first verified (both missing-one-of-two cases). ⛔ Landed AFTER this
session's compliance-checker pass (§3) — not yet covered by a review.
`pnpm verify` after all three: **115 test files / 1251 tests, 12/12 typecheck tasks, 7/7 builds,
168.09 KB gz**.
**Remaining 4 sub-items:** narrowing users-table grants (documented at length in
`two-factor.service.ts`'s own header comment and security.md §10.2 — column-level GRANT/REVOKE
migration, needs a full audit of every `AppDb`-connection touch on `users` columns first); an auth
audit log (needs a new table or an extension of migration 0026's `audit_log` shape, plus write
sites at login/logout/failure/farm-switch/invite/reuse-revocation); registration-enumeration
hardening (NOT a message tweak — security.md is explicit that the real fix is email verification,
which needs delivery infra this repo doesn't have yet); attachment MIME/size/quota controls
(touches the attachments pipeline P1.2/P2.5 just closed — read those commits first, do not
re-litigate their design). ⛔ **Checked this one specifically for "small enough to just do" and
declined:** the MIME whitelist half is mechanical, but the size cap has no existing number
anywhere in the docs to anchor to — picking one (e.g. 25MB) is a real product decision about what
a farmer's phone may upload, not an engineering default like a TTL, and quota tracking is new
infrastructure on top of that. Worth a quick number decision from JP before the MIME/size half is
even worth splitting out on its own.

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
