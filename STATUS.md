# STATUS — current project handoff

> Read this before planning. This file records current state, owner decisions, verification evidence,
> and the next executable slice. Historical session narratives belong in git history, not here.

**Last updated:** 2026-08-16 (fourteenth session). Continuing JP's Phase 3 punch-list closure.
**P3.11–P3.15 and the conflict-audit gate are closed; P2.9's schema half is closed; P3.16 is
5/7 sub-items closed** (see §5). **About 3 of ~21 punch-list items remain, and both are
genuinely blocked** — not sliceable further without input this session didn't have (see §5's
P3.16 remainder). Do not re-run P1/P2.5–P2.10, conflict audit or P3.11–P3.15.

✅ **Owner-triggered `compliance-checker` over `428200a..45775ea` (18 commits: P2.10, conflict
audit, P3.11–P3.15, P3.16's first two sub-items): CLEARED, no SEV-1/SEV-2/MED/LOW.** Full account
in §3. Earlier: `reviewer` + `sync-auditor` + `compliance-checker` over `baf4b4d..428200a`, also
ALL CLEARED — `reviewer`'s one LOW (a STATUS.md mis-citation) was checked and REFUTED. ⛔ Commits
`c7358b0`, `016fb5d` and `fc5759d` (P3.16's third/fourth/fifth sub-items) landed AFTER that pass and
are NOT yet compliance-reviewed; `016fb5d` is POPIA-adjacent auth evidence and needs the owner's
next pass — `fc5759d` is a DB-grant-only change (no application code touched) and lower risk, but
still in the unreviewed range.

**Active branch:** `phase-3/powersync-foundation`, off `main` @ `13a0d46`; committed work through
`fc5759d` (P3.16 users column grants) ← `016fb5d` (P3.16 immutable auth audit) ← `c7358b0` (P3.16
production WebAuthn config) ← `e24a281` (P3.16 challenge sweep) ← `06ca3d6` (P3.16 invite fix).
Older chain is in git history. Not pushed — local commits only.

**Remote state:** Phase 2 merged to `main` via PR #3 (`13a0d46`); both CI lanes were green at merge.

## 1. Delivery position

| Phase | State | Evidence / boundary |
|---|---|---|
| 0 — Scaffold | Merged | `main` |
| 1 — App shell, auth & 2FA | Merged | PR #2, `9452ebc` |
| 2 — Livestock | ✅ **Merged** | `main` @ `13a0d46` (PR #3, 2026-08-08). Tenth pass cleared — no SEV-1/SEV-2. MED/LOW fixed or filed as issues #4–#9 (not merge blockers) |
| 3 — Offline sync | 🔶 Every phase-checklist box `☑`; a SEPARATE punch list of P1/P2/P3/quality items (opened 2026-08-14) sits on top of the checklist and is ~18/~21 done | 3a–3i all CLOSED (§3, historical): 3e in full, 3i(b)/3i(c), O-3. **Punch list (not phase-checklist items, a stricter closure pass JP asked for on top of the checklist):** P1.1–P1.4, P2.5–P2.10, conflict audit and P3.11–P3.15 are done; P3.16 is 4/7 sub-items done. 3 of P3.16's sub-items plus Q17–Q19 remain — full sliced list in §5 |
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

✅ **CLOSED 2026-08-16 (fourteenth session) — three P3.16 decisions JP made when asked directly:**
attachment size cap is **25 MB** per attachment; per-farm **quota tracking is IN SCOPE** for the
MIME/size/quota sub-item (JP chose to build it now rather than defer, despite it being new
infrastructure); registration-enumeration hardening (email verification on `/auth/register`) is
**DEFERRED to Phase 7 hardening** — rate limiting narrows the gap meanwhile. Unblocks the
attachment MIME/size/quota sub-item; leaves P3.16 at 6/7 once that lands.

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
| `pnpm verify` (2026-08-16, fourteenth session, fully uncached, after P3.16 users-column grants) | ✅ **115 test files / 1254 tests, 7/7 builds, 168.10 KB gz** |
| `pnpm verify` (2026-08-15, thirteenth session, fully uncached, after P3.16 auth audit) | ✅ 115 test files / 1252 tests, 12/12 typecheck tasks, 7/7 builds, 168.10 KB gz |
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

✅ **31–36. Done 2026-08-15 (sixth–eleventh sessions), condensed — full detail in git history:**
**31** conflict audit/review (O-6/O-7/O-8) — migration `0026_conflict_audit`'s immutable `audit_log`
+ `conflict_reviews`, deterministic idempotent conflict keys, `(occurred_at,id)` LWW for movement,
sale-outranks-death-outranks-sale-etc. projection, legitimate-twin-batch handling, `GET/POST
/conflicts` and cached offline review UI (`b88b29b`-adjacent, 113 files/1210 tests). **32** P3.11 —
recent step-up (≤10 min) before starting TOTP/passkey enrolment; a stale caller gets 403
`STEP_UP_REQUIRED` and a full re-login. **33** P3.12, `cd0d3c0` — Google-first OIDC/cookie-BFF
migration phasing across seven additive slices; no email-equality linking or farm authority. **34**
P3.13, `144e7bc` — FR-001 business contact/address fields (migration 0027); all seven fields
excluded from every Sync Stream. ⛔ Was POPIA-adjacent-unreviewed until the twelfth-session
compliance pass cleared it (§3). **35** P3.14, `764c53e` — branding-register create/list/link
(FR-601/602); real-Postgres tenancy/authorship/idempotency/species-safe-linking coverage; the
unmarked-past-window alert stays deferred (no verified prescribed-window data to compute it from).
**36** P3.15, `aa2b023` — one shared `parseRandsToCents` in `@werf/core/money.ts` replacing three
hand-rolled, float-crossing `Math.round(Number(rands)*100)` duplicates in AddAnimal/AdjustMob/
RecordLoss; refuses a third decimal digit as a likely typo. Verification baselines climbed from 113
files/1210 tests through 114 files/1245 tests across these six items — each had its own green
`pnpm verify` at the time; see §4 for the current number.

**37. P3.16 — auth hardening batch. 4/7 sub-items done 2026-08-15 (thirteenth session).** All seven
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
✅ **Immutable auth audit, commit `016fb5d`.** Migration 0028 adds an account-global, append-only
`auth_audit_log` for login outcomes, logout, refresh-token reuse, farm switches and invitations.
It retains actor/subject, farm, session/family, source IP, bounded user agent and controlled metadata
without credentials, tokens, email contents or OIDC claims. `werf_app` has no table/sequence grants;
forced zero-policy RLS plus a rejecting UPDATE/DELETE trigger protects the elevated path. Session
issuance/revocation and their evidence commit atomically. Real-Postgres tests prove immutability,
ordinary-role denial, idempotent logout/reuse evidence, and invitation/farm-switch attribution.
⛔ POPIA-adjacent; landed after the owner-triggered compliance pass and is not merge-ready until the
owner requests the next pass. `pnpm verify`: **115 files / 1252 tests, 12/12 typechecks, 7/7 builds,
168.10 KB gz**.
✅ **Users-table column grants, commit `fc5759d` (2026-08-16, fourteenth session).** Migration 0029
revokes `werf_app`'s table-wide `SELECT/INSERT/UPDATE` on `users` (granted by 0001 with no column
list) and re-grants only the profile-shaped columns — id/email/phone/full_name/locale/theme/
last_seen_at/created_at/updated_at/deleted_at. `password_hash`, `totp_secret_encrypted`,
`totp_enrolled_at`, `totp_last_used_step` and `recovery_codes_hashed` are now reachable only from
`ElevatedDb`. An audit of every `AppDb`-scoped touch of `users` (grep across `apps/api/src`) found
**zero production paths** querying `users` via `werf_app` at all — every credential-shaped path
already ran elevated, exactly as `two-factor.service.ts`'s own header comment described — so
nothing needed to change in application code, only the grant. Two existing RLS tests did
`select().from(users)` (all columns) through the scoped connection and needed narrowing to the
columns they actually use (`client.integration.test.ts`, `farms.integration.test.ts`). Fail-first
verified against a real Postgres: reverting the migration lets `werf_app` read a TOTP secret and
rewrite `totp_last_used_step`; with it applied both are rejected while ordinary profile columns
stay read/writable in the same transaction shape. `pnpm verify`: **115 files / 1254 tests, 7/7
builds, 168.10 KB gz** (bundle unchanged — this is a pure DB-privilege change).

**Remaining 2 sub-items, both genuinely blocked, not just unsliced:** registration-enumeration
hardening (NOT a message tweak — security.md is explicit that the real fix is email verification,
which needs delivery infra this repo doesn't have yet — a provider/SES decision, not an engineering
default); attachment MIME/size/quota controls (touches the attachments pipeline P1.2/P2.5 just
closed — read those commits first, do not re-litigate their design). ⛔ **Checked the latter
specifically for "small enough to just do" and declined:** the MIME whitelist half is mechanical,
but the size cap has no existing number anywhere in the docs to anchor to — picking one (e.g. 25MB)
is a real product decision about what a farmer's phone may upload, not an engineering default like
a TTL, and quota tracking is new infrastructure on top of that. Worth a quick number decision from
JP before the MIME/size half is even worth splitting out on its own.

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
