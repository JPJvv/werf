# STATUS — current project handoff

> Read this before planning. This file records current state, owner decisions, verification evidence,
> and the next executable slice. Historical session narratives belong in git history, not here.

**Last updated:** 2026-08-17 (sixteenth session). **Phase 3 is APPROVABLE for merge.** Punch list
fully closed; whole-branch `reviewer`+`sync-auditor`+`compliance-checker` pass found one SEV-2 and
two LOW, both fixed and re-verified — see below and §3. Do not re-run P1/P2.5–P2.10, conflict
audit, P3.11–P3.15 or P3.16.

✅ **Whole-branch review-agent pass (sixteenth session, JP-requested), `main...HEAD`: APPROVABLE
after one fix round.** `compliance-checker` CLEARED outright. `sync-auditor` found two LOW
(`conflict_reviews`/`attachments` grant `werf_app` whole-row UPDATE, same class 0029 closed for
`users`) — fixed as `47c0ffe` (migration 0031), qualifies for §6 clause 3, no second pass needed.
`reviewer` found one **SEV-2**: `opfs-blob-store.ts`'s `put()` let a real OPFS `QuotaExceededError`
propagate straight out, uncaught anywhere in the chain up to `RecordPhotoScreen.tsx`'s save
handler — a photo taken while device storage was full was silently lost, contradicting the Phase 3
exit gate's own words. Fixed as `c45cd01`: `put()` now retries indefinitely via a new
`retryDurably` helper, the same never-reject guarantee `sqlite-capture-store.ts` already gives the
metadata half (P1.1). A **narrow follow-up `reviewer` pass, scoped to `71f3804..HEAD` only** (§6
clause 1), confirmed the fix closes the exact path traced end-to-end and found nothing new:
**APPROVABLE.** Full account in §3.

✅ **Owner-triggered `compliance-checker`, three passes through `ec8336e` (sessions 4/12/14): all
CLEARED, no SEV-1/SEV-2, one LOW fixed same-session (`c12fbfc`).** Full account in §3.

**Active branch:** `phase-3/powersync-foundation`, off `main` @ `13a0d46`; committed work through
`47c0ffe` (grant-narrowing fix) ← `c45cd01` (SEV-2 fix) ← `dd1fac8` (final-sweep e2e fixes). Older
chain is in git history. Not pushed — local commits only. **Ready to push and open the PR.**

**Remote state:** Phase 2 merged to `main` via PR #3 (`13a0d46`); both CI lanes were green at merge.

## 1. Delivery position

| Phase | State | Evidence / boundary |
|---|---|---|
| 0 — Scaffold | Merged | `main` |
| 1 — App shell, auth & 2FA | Merged | PR #2, `9452ebc` |
| 2 — Livestock | ✅ **Merged** | `main` @ `13a0d46` (PR #3, 2026-08-08). Tenth pass cleared — no SEV-1/SEV-2. MED/LOW fixed or filed as issues #4–#9 (not merge blockers) |
| 3 — Offline sync | ✅ **APPROVABLE for merge** — every phase-checklist box `☑`, the punch list fully closed, whole-branch review-agent pass cleared after one fix round | §5 has the full item list; §3 has the review-agent account. Not yet pushed — ask JP before pushing/opening the PR |
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
owner-triggered).** 18 commits: P2.10, the conflict audit/review feature (migration 0026),
P3.11–P3.15, P3.16's first two sub-items. **CLEARED, no SEV-1/SEV-2/MED/LOW** — no hardcoded
regulated numbers, `parseRandsToCents` float-safe at all three replaced call sites, P3.13's new
columns excluded from every Sync Stream, `audit_log` immutability proven by a real UPDATE/DELETE
attempt, P3.16's invite fix proven to refuse-and-not-revive. ⛔ New scope from `45775ea` forward.

✅ **CLOSED 2026-08-15 — owner chose A: implement conflict audit/review now.** Migration 0026 adds
immutable server-only `audit_log` evidence plus a separate review queue; both facts, rule, winner,
actor/session and timestamps are retained, and events are never rewritten. Movement uses
`(occurred_at,id)` LWW; death outranks sale; separate similar birth batches are flagged while one
shared batch protects legitimate multiples. RLS-scoped API/cache/UI and owner/manager review are
built. O-6/O-7/O-8/NFR-211 have real-Postgres coverage; full detail is in §5 item 31.

✅ **CLOSED 2026-08-14 (first session) — condensed, matches §5 items 21–30's `1b429d5`/`8dcdaf5`
entries; full detail in git history:** back-dated-move fail-closed; 3e land hydration; 3i(c)
attachment deferred queue (real-OPFS e2e proof, FR-131-adjacent — compliance-pass scope); 3i(b)
residuals (AWS SDK retry, `AttachmentOrphanSweepService`, quota pressure deliberately not built);
O-3 real-stack sweep (`real-offline-matrix.spec.ts`, `WERF_REAL_STACK`-gated, twice clean).

✅ **Compliance-pass scope through `baf4b4d` — CLOSED 2026-08-14 (third session, top-of-file
note).** Covered `9b7fa2e..3a1993c`: back-dated-move fail-closed, land hydration, 3i(c)'s
`animalrow:` guard, `c2cc48a`, `422e09d`, P2.6's `6820a21`/`9e1b402`, P2.7's `256d06a`.

✅ **Review scope `baf4b4d..428200a` — CLOSED 2026-08-15 (fourth session, owner-triggered).**
Covered `a6b0c1a` (P2.8 bootstrap repair) + P2.9's UUIDv7 tightening. All three agents CLEARED, no
SEV-1/SEV-2/MED. `reviewer`'s one LOW (a claimed `auth.service.ts` citation) was checked and
REFUTED — the comment exists verbatim; nothing changed. ⛔ New scope opens from `428200a` forward.

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
| `pnpm verify` (2026-08-17, sixteenth session, fully uncached, AFTER the SEV-2/LOW fixes) | ✅ **117 test files / 1283 tests, 7/7 builds, 168.80 KB gz** |
| Earlier same-session/prior baselines (attachment quota, users-column grants, auth audit) | Condensed — see item 37 |
| `pnpm test:e2e` default lane (2026-08-17, sixteenth session, after the SEV-2 fix — real OPFS `put()` still works) | ✅ 31 passed / 5 skipped |
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
large implementation-and-closure pass over a specific punch list, in three priority bands plus a
doc/quality band, sliced one item (or a tightly related pair) per session. Ran second through
sixteenth sessions; every item below closed.

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

✅ **41. Final — definition-of-done sweep. CLOSED, 2026-08-17 (sixteenth session).**
`pnpm verify` fully uncached: **116 files / 1278 tests, 7/7 builds, 168.78 KB gz.**
`pnpm test:e2e` default lane: **31 passed / 5 skipped.** `WERF_REAL_STACK=1`: all 5 gated tests
(`deployed-connectivity` ×2, `real-offline-matrix` ×2, `real-sync-hydration` ×1) pass — run each in
isolation with a fresh `apps/api` process between them, not as one batch; the in-memory auth
Throttler's register-burst limit (2/min, `rate-limits.ts`) is real and correctly strict, and five
real registrations inside one Playwright worker's run window trips it. Verified this is throttling,
not a defect: the SAME test passes clean immediately after an API restart clears its in-memory
bucket. ⭐ **Two real defects surfaced and fixed as `dd1fac8`, both in real-stack e2e test tooling,
neither in application code:** `deployed-connectivity.spec.ts` sent `mimeType: 'text/plain'`,
predating P3.16's MIME whitelist (`49677b4`) — that commit silently broke this spec's presigned-PUT
proof, undetected because the spec is `WERF_REAL_STACK`-gated and nothing had run it since.
`real-offline-matrix.spec.ts`'s P2.8 test looked up its test mob by `name` with no `farm_id` scope
— itself a tenancy gap, in test tooling rather than product code — so rerunning the gated spec
against a persistent local dev Postgres accumulated same-named mobs across different test farms and
broke the next query's SQL string once a second row existed. Both fail-first verified, both fixed
mechanically, confined to the two files named. `pnpm lint` clean after. No SEV-1/SEV-2 outstanding
from any authorized compliance/review pass (§3); MED/LOW from every closed pass fixed or filed.
STATUS.md and `phase-checklists.md` agree (Q17's reconciliation still holds; nothing drifted since).

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
