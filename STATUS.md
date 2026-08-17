# STATUS — current project handoff

> Read this before planning. This file records current state, owner decisions, verification evidence,
> and the next executable slice. Historical session narratives belong in git history, not here.

**Last updated:** 2026-08-16 (fifteenth session). Continuing JP's Phase 3 punch-list closure.
**P3.11–P3.15 and the conflict-audit gate are closed; P2.9's schema half is closed; P3.16 is
6/7 sub-items closed; Q17 and Q18 are closed** (see §5). **Q19 plus the final sweep remain.**
Do not re-run P1/P2.5–P2.10, conflict audit or P3.11–P3.15.

✅ **Q17 (doc reconciliation) — CLOSED, `f875dcc`.** Fixed five contradictions, worst being
`phase-checklists.md`+`testing-strategy.md` both still claiming the O-6/O-7/O-8 conflict
audit/review mechanism (migration 0026) was NOT built though it closed 2026-08-15.

✅ **Q18 (NFR gates: implement or honestly label) — CLOSED, `1b036bf`.** Audited every gate
`non-functional-requirements.md` claims. Two made real: NFR-208 dependency audit (new CI job,
`pnpm audit --audit-level=critical --prod`) and NFR-009 bundle size, already real under the wrong
tool name. Traceability (`test:trace`) is now phase-aware — `--strict` never counts a gap in a
phase that hasn't started. Everything still unimplemented (Lighthouse, coverage thresholds,
regulated-constant lint, per-chunk budgets, file-length limits) is now marked ❌, not falsely
claimed.

✅ **Owner-triggered `compliance-checker` over `45775ea..ec8336e` (fourteenth session,
2026-08-16): CLEARED, one LOW.** Covered `c7358b0`/`016fb5d`/`fc5759d`/`49677b4` (P3.16's
third–sixth sub-items). No SEV-1/SEV-2/MED. The one LOW — `image/jpg`, a real non-standard MIME
alias some Android WebViews report for a camera JPEG, would have been falsely refused by the
exact-match whitelist check — was fixed under §6 clause 3 (mechanical, confined to the files
named, fail-first tested) as `c12fbfc`, no second pass needed. Full account in §3. Earlier:
`compliance-checker` over `428200a..45775ea` (18 commits, P2.10 through P3.16's first two
sub-items) and `reviewer`+`sync-auditor`+`compliance-checker` over `baf4b4d..428200a`, also ALL
CLEARED. ⛔ New scope opens from `ec8336e` forward — nothing outstanding right now.

**Active branch:** `phase-3/powersync-foundation`, off `main` @ `13a0d46`; committed work through
`1b036bf` (Q18 NFR gates) ← `f875dcc` (Q17 doc reconciliation) ← `c12fbfc` (P3.16 image/jpg alias
fix). Older chain is in git history. Not pushed — local commits only.

**Remote state:** Phase 2 merged to `main` via PR #3 (`13a0d46`); both CI lanes were green at merge.

## 1. Delivery position

| Phase | State | Evidence / boundary |
|---|---|---|
| 0 — Scaffold | Merged | `main` |
| 1 — App shell, auth & 2FA | Merged | PR #2, `9452ebc` |
| 2 — Livestock | ✅ **Merged** | `main` @ `13a0d46` (PR #3, 2026-08-08). Tenth pass cleared — no SEV-1/SEV-2. MED/LOW fixed or filed as issues #4–#9 (not merge blockers) |
| 3 — Offline sync | 🔶 Every phase-checklist box `☑`; a SEPARATE punch list of P1/P2/P3/quality items (opened 2026-08-14) sits on top of the checklist and is ~20/~21 done | 3a–3i all CLOSED (§3, historical): 3e in full, 3i(b)/3i(c), O-3. **Punch list (not phase-checklist items, a stricter closure pass JP asked for on top of the checklist):** P1.1–P1.4, P2.5–P2.10, conflict audit and P3.11–P3.15 are done; P3.16 is 6/7 sub-items done, the 7th deferred to Phase 7 by owner decision. Q17–Q19 remain — full sliced list in §5 |
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
re-derived from the code (not the commit message): a single conditional `UPDATE ... WHERE
attachment_bytes_used + n <= CAP RETURNING id` inside the same transaction as the row
insert/revival, the same TOCTOU-closing idiom `finalizeAttachment` already uses elsewhere in this
file — genuinely race-safe, not merely asserted to be. Sync/RLS agreement for the new
`farms.attachment_bytes_used` column was verified against the actual `TENANCY` registry and a grep
for any client-writable path to it (none), not taken on trust. ⛔ New scope opens from `ec8336e`
forward.

✅ **CLOSED 2026-08-16 (fourteenth session) — three P3.16 decisions JP made when asked directly:**
attachment size cap is **25 MB** per attachment; per-farm **quota tracking is IN SCOPE** for the
MIME/size/quota sub-item (JP chose to build it now rather than defer, despite it being new
infrastructure); registration-enumeration hardening (email verification on `/auth/register`) is
**DEFERRED to Phase 7 hardening** — rate limiting narrows the gap meanwhile. The attachment
MIME/size/quota sub-item landed the same session as `49677b4` — P3.16 is now 6/7, see item 37.

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
| `pnpm verify` (2026-08-16, fourteenth session, fully uncached, after the `image/jpg` alias fix) | ✅ **116 test files / 1278 tests, 7/7 builds, 168.78 KB gz** |
| Earlier same-session/prior baselines (attachment quota, users-column grants, auth audit) | Condensed — see item 37 |
| `pnpm test:e2e` (2026-08-15, tenth session, default lane, after P3.14) | ✅ 31 passed / 5 skipped — light/dark capture-screen a11y includes `/animals/brands`; the 3 `WERF_REAL_STACK`-gated specs still require the final live-stack sweep |
| `WERF_REAL_STACK=1` P2.8 e2e + deployed-connectivity (2026-08-14/15) | ✅ Both passed as of P2.8; superseded rows condensed — full detail in git history |
| `compliance-checker` `45775ea..ec8336e` (2026-08-16, fourteenth session) | ✅ CLEARED, one LOW fixed same session — full account in §3 |
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

**37. P3.16 — auth hardening batch. 6/7 sub-items done, 2026-08-15/16 (thirteenth–fourteenth
sessions), condensed — full detail in git history.** All seven sub-items are pre-scoped in
`docs/05-operations/security.md` §10.2, which names the exact fix for each, not just the gap.
✅ Invitation reuse of soft-deleted identities (`06ca3d6`) — `FarmsService.invite` now refuses an
address belonging to a POPIA-erased row outright, instead of pulling it back into a live
membership and the co-member RLS policy's visibility. ✅ WebAuthn challenge cleanup (`e24a281`) —
`WebauthnChallengeSweepService` hard-deletes consumed/expired `webauthn_challenges` rows hourly
(no `deleted_at`, exempt from soft-delete like `user_sessions`). ✅ Production WebAuthn config
(`c7358b0`) — `loadConfig` refuses to boot in production with `WEBAUTHN_RP_ID`/`WEBAUTHN_ORIGIN`
unset, checked against raw env values so a coincidental `localhost` default can't mask the gap.
✅ Immutable auth audit (`016fb5d`) — migration 0028's account-global, append-only
`auth_audit_log`; zero `werf_app` grants, forced zero-policy RLS, a rejecting UPDATE/DELETE
trigger. ✅ Users-table column grants (`fc5759d`) — migration 0029
narrows `werf_app`'s table-wide grant on `users` to non-credential columns only; an audit found
**zero production paths** touching `users` via the scoped connection at all, so only the grant
changed, no application code. Fail-first proven against real Postgres both ways. All four fixes
had their own green `pnpm verify` at the time; see §4 for the current number.
✅ **Attachment MIME/size/quota, commit `49677b4` (2026-08-16, fourteenth session).** Three owner
decisions unblocked this: 25MB per-attachment ceiling, a 5GB per-farm quota built now rather than
deferred, and a five-type photo whitelist (JPEG/PNG/WebP/HEIC/HEIF). Size and MIME are enforced in
the shared `@werf/core` Zod schema, so `RecordPhotoScreen.tsx` refuses an over-limit or
unsupported file AT THE PICKER, before it ever reaches OPFS or the queue. Quota is a running total
on `farms.attachment_bytes_used` (migration 0030), charged atomically against the quota the moment
`createAttachment` decides a row will occupy real storage (a fresh insert or a revival), and
released by `AttachmentOrphanSweepService` when it reclaims an abandoned upload — a new
`QuotaExceededError`/`QUOTA_EXCEEDED` code keeps the refusal distinct from `CONFLICT` in
`NotSentScreen.tsx`. Fail-first verified against real Postgres and in `RecordPhoto.test.tsx`.
Regenerated both derived-artifact freshness gates (local SQLite schema, PowerSync
`sync-config.yaml`) for the new `farms` column. ✅ **Compliance-checked `45775ea..ec8336e`
(fourteenth session): CLEARED, one LOW — `image/jpg` (a real Android MIME alias) was refused by
the exact-match whitelist; fixed as `c12fbfc` via a shared `normalizeAttachmentMimeType`, merged
under §6 clause 3, no second pass.** `pnpm verify`: **116 files / 1278 tests, 7/7 builds, 168.78
KB gz**.

**Remaining: registration-enumeration hardening — CLOSED as a decision, not open work.** JP
deferred it to Phase 7 hardening (2026-08-16): rate limiting narrows the gap meanwhile, and the
"needs delivery infra" framing in security.md was stale (the `Mailer`/SMTP port already exists,
built for invitations) — this is a scheduling choice, not a blocker.

✅ **38. Q17 — CLOSED, `f875dcc`** — full account in the top-of-file note.

✅ **39. Q18 — CLOSED, `1b036bf`** — full account in the top-of-file note.

✅ **40. Q19 — CLOSED.** Added `testing-strategy.md` §7a: five Phase-3-specific field-evidence rows
(dead-zone reconnect behaviour, low-end-device OPFS storage pressure, two-real-workers conflict-
queue legibility, big-attachment-over-bad-signal upload, real-authenticator WebAuthn/passkey
recovery) that Phase 7's generic three-farm pilot does not name on its own — recorded so they aren't
discovered under pilot pressure. None have been run; this is a record, not a clearance. Also fixed
three stale Phase numbers in §7's original table found while editing it (bookkeeper/legal-review
said `3`, should be `5`; auditor/SAPS said `4`, should be `6` — same renumbering `roadmap.md`
already reflects).

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
