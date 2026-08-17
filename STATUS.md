# STATUS — current project handoff

> Read this before planning. This file records current state, owner decisions, verification evidence,
> and the next executable slice. Historical session narratives belong in git history, not here.

**Last updated:** 2026-08-17 (seventeenth session). **Phase 3 is APPROVABLE for merge, PR #11 open,
all 3 CI lanes green** (`93ff171`→`c77debb`, JP said push). Punch list fully closed; whole-branch
`reviewer`+`sync-auditor`+`compliance-checker` pass found one SEV-2 and two LOW (16th session, both
fixed); a SECOND SEV-2 (17th session, below) was found from real CI evidence, not an agent pass —
see §3. Do not re-run P1/P2.5–P2.10, conflict audit, P3.11–P3.15 or P3.16.

✅ **SEV-2 #2 found and fixed this session (17th), from PR #11's own CI, not a review agent:**
`sqlite-capture-store.ts`'s `append()` buffered a capture ONLY in memory
(`pendingAppends`) until the store's first async hydration completed; a page reload or app close in
that window silently and permanently lost the capture — same class as the 16th session's OPFS SEV-2.
CI's E2E lane caught it: `offline-capture.spec.ts` failed deterministically twice on GitHub's
runner, never once locally (3/3 clean, even under matched `CI=1`/worker/order conditions) — a loaded
CI runner widens exactly the race a fast local machine closes before it can be observed. Root cause
confirmed from the actual Playwright trace (downloaded via a new failure-only CI artifact upload,
`df56a5f`): the weight capture's POST was never even attempted, meaning the record never reached the
local store at all. Fixed as `c77debb`: `append()` now also writes synchronously to a
localStorage-backed write-ahead buffer before anything async happens; hydration recovers any entry
`capture_records` lacks and clears the buffer once durable. New regression test abandons a store
before its `database()` promise ever resolves, confirmed to fail against the prior code with the
exact CI symptom and pass with the fix. CI re-run after the fix: all 3 lanes green.

✅ **Phase 4 planned in detail this session (17th), before any code.** Full slice plan (4a–4e,
schema/API/screen/projection/tests per slice) is in `phase-checklists.md`'s Phase 4 section — read
it first, do not re-derive. Fixed a wrong FR bucketing shared by that file and `roadmap.md` (both
together — "two incompatible phase maps" is a defect class already paid for once). Key findings:
`chemical_products` schema + the `listVeterinaryProducts` pattern it mirrors already exist; no
`plantings` table needed (current planting = latest `planting` event per block — a UX call, not a
PHI dependency, since PHI reads spray history directly); harvest + the PHI guard ship as ONE slice,
never split (roadmap had them sequential — Phase 2's treatment/sale mistake, repeated). ⛔ New
blocker, B-1/B-2 class: production `chemical_products` needs JP to name a maintained Act 36/1947
source; does not block writing 4a–4e.

✅ **Whole-branch review-agent pass (16th session): APPROVABLE after one fix round.**
`compliance-checker` CLEARED outright. `sync-auditor` found two LOW (grant scoping, `47c0ffe`,
qualifies for §6 clause 3). `reviewer` found **SEV-2 #1**: `opfs-blob-store.ts`'s `put()` let a real
OPFS `QuotaExceededError` propagate uncaught — a photo lost under device storage pressure. Fixed as
`c45cd01` (`retryDurably`, the same never-reject guarantee SEV-2 #2 above now also gives captures).
A narrow follow-up pass (§6 clause 1) found nothing new: APPROVABLE. Owner-triggered
`compliance-checker`, three earlier passes through `ec8336e`: all CLEARED. Full account in §3.

**Active branch:** `phase-3/powersync-foundation`, off `main` @ `13a0d46`; head `c77debb` (SEV-2 #2
fix). Pushed; **PR #11 open, all CI lanes green** — merge is JP's call.

**Remote state:** Phase 2 merged to `main` via PR #3 (`13a0d46`); both CI lanes were green at merge.
Phase 3's PR #11: 3/3 CI lanes green as of `c77debb` (2026-08-17).

## 1. Delivery position

| Phase | State | Evidence / boundary |
|---|---|---|
| 0 — Scaffold | Merged | `main` |
| 1 — App shell, auth & 2FA | Merged | PR #2, `9452ebc` |
| 2 — Livestock | ✅ **Merged** | `main` @ `13a0d46` (PR #3, 2026-08-08). Tenth pass cleared — no SEV-1/SEV-2. MED/LOW fixed or filed as issues #4–#9 (not merge blockers) |
| 3 — Offline sync | ✅ **APPROVABLE for merge, PR #11 open** — every phase-checklist box `☑`, the punch list fully closed, whole-branch review-agent pass cleared after one fix round | §5 has the full item list; §3 has the review-agent account. Check CI on PR #11 before merging |
| 4 — Crops & fields | Not started — planned in detail | `phase-checklists.md` §Phase 4 has the full 4a–4e slice plan; no code written yet |
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
no SEV-1/SEV-2/MED/LOW** — no hardcoded regulated numbers, `audit_log` immutability proven by a real
UPDATE/DELETE attempt. ⛔ New scope from `45775ea` forward.

✅ **CLOSED 2026-08-15 — owner chose A: implement conflict audit/review now** (migration 0026,
immutable `audit_log` + review queue, `(occurred_at,id)` LWW, O-6/O-7/O-8/NFR-211 real-Postgres
coverage) — full detail in §5 item 31.

✅ **CLOSED 2026-08-14/15 (sessions one/three/four), condensed — full detail in git history:**
back-dated-move fail-closed; 3e land hydration; 3i(c) attachment deferred queue; 3i(b) residuals;
O-3 real-stack sweep; P2.6/P2.7/P2.8/P2.9 fixes. Three review passes (`baf4b4d..428200a` incl.)
all CLEARED, no SEV-1/SEV-2/MED; one claimed LOW REFUTED with evidence (comment existed verbatim).

**Condensed, full detail in git history / `phase-checklists.md` 3b–3i (2026-08-13):** three
`compliance-checker` passes over the animals/moves/health hydration diff → APPROVABLE (`ba7f680`);
a whole-branch `compliance-checker` pass (CLEARED) and a `sync-auditor` pass over attachments (2
MEDIUM + 1 LOW, fixed under §6 clause 3); 3f closed; `drizzle-kit` snapshot gap reconciled
(0023/0024); per-farm events partitioning retired (migration 0021) — "wire it up properly" hid a
worse defect for any farm signing up post-deploy.

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
large implementation-and-closure pass, three priority bands plus a doc/quality band, one item (or a
tightly related pair) per session. Ran second through sixteenth sessions; every item below closed.

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
mechanically, confined to the two files named. No SEV-1/SEV-2 outstanding from any authorized
compliance/review pass (§3); MED/LOW from every closed pass fixed or filed. STATUS.md and
`phase-checklists.md` agree (Q17's reconciliation still holds; nothing drifted since).

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
