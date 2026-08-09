# STATUS — current project handoff

> Read this before planning. This file records current state, owner decisions, verification evidence,
> and the next executable slice. Historical session narratives belong in git history, not here.

**Last updated:** 2026-08-09

**Active branch:** `phase-3/powersync-foundation`, off `main` @ `13a0d46`. Not pushed yet — local
commit only, awaiting the owner's go-ahead to push/open a PR.

**Remote state:** Phase 2 merged to `main` via PR #3 (`13a0d46`); both CI lanes were green at merge

## 1. Delivery position

| Phase | State | Evidence / boundary |
|---|---|---|
| 0 — Scaffold | Merged | `main` |
| 1 — App shell, auth & 2FA | Merged | PR #2, `9452ebc` |
| 2 — Livestock | ✅ **Merged** | `main` @ `13a0d46` (PR #3, 2026-08-08). Tenth pass cleared — no SEV-1/SEV-2 from `reviewer`, `sync-auditor` or `compliance-checker`. MED/LOW fixed under §6 clause 3 or filed as issues #4–#9 (open, tracked on `main`, not merge blockers) |
| 3 — Offline sync | 🔶 In progress — 3a done, unmerged | `phase-3/powersync-foundation`: `@powersync/web`/`@powersync/common` installed behind the `@werf/sync` seam; local SQLite schema derived from `TENANCY` + the real Postgres schema. See §4/§5. Not yet connected to a service — that's 3b |
| 4 — Crops & fields | Not started | Blocks, plantings, sprays, PHI and harvest move here; they were incorrectly still promised by the old Phase 2 roadmap |
| 5 — Labour & wages | Not started | Build may use placeholder rate rows; deployment requires verified Gazette sources and external labour-law review |
| 6 — Finance & compliance packs | Not started | Includes evidence packs, obligations, fuel/refund and reporting |
| 7 — Hardening & pilot | Not started | Performance, security review, deployment, pilot and launch readiness |

## 2. Audit findings closed

1. **Wrong branch on session start.** The workspace opened on `main`, where `STATUS.md` did not
   exist, while the active branch was more than 100 commits ahead. Always reconcile branch + SHA
   before planning.
2. **The handoff had become a review transcript.** The former `STATUS.md` was 1,839 lines, carried
   several superseded “next session” blocks, and contradicted itself about open decisions. Git
   already preserves that history; this file is now constrained to 300 lines by
   `pnpm project:check`.
3. **The plan had two incompatible phase maps.** The checklist called Phase 2 “Livestock” and its
   build list empty, while the authoritative roadmap called it “Livestock & Crops”. The code has no
   crop module. The delivery map is being aligned to the architecture: livestock → offline sync →
   crops → labour → compliance → hardening.
4. **The architecture promise is ahead of the implementation.** `@werf/sync` currently persists
   browser-local JSON stores and has no PowerSync dependency. That is an honest Phase 2 adapter,
   not the SQLite/OPFS replication described by ADR-0003. Phase 3 now owns closing that gap.
5. **A green browser lane was noisy.** The populated accessibility fixture looked unsent, so the
   real outbox repeatedly attempted API writes; reference reads also bypassed page routes through
   the service worker. The fixture now carries its sent log, known reads are narrowly aborted, and
   only the axe file blocks the worker. The dedicated offline test still uses the production worker.
6. **Regulated verification remains human-gated.** The 2026 NMW figure and animal-marking period
   were checked against primary government sources during this audit, but no regulated production
   data is being changed. Phase 2 still waits for the owner-triggered compliance pass.
7. **The uncached gate exposed a false timeout.** Four full registration journeys now have a
   10-second ceiling instead of the 5-second unit default; under concurrent integration-test load,
   two healthy flows had crossed five seconds. A stalled journey still fails promptly.
8. **FR-101 fields existed without capture controls.** The create-animal screen now records DOB,
   whether it is estimated, and the actual acquisition day. A back-dated purchase carries that day
   on both the animal and its event; it is no longer silently dated to the day the phone was used.

## 3. Owner decisions

**Three of four sync-rules questions RESOLVED empirically, 2026-08-09**, against a real
`journeyapps/powersync-service:1.23.3` self-hosted instance (`docker compose up postgres
powersync`, Postgres storage backend, `infra/powersync/`) — not from docs, which paraphrased
inconsistently across fetches earlier in this same investigation. Evidence trail:
`packages/sync/src/sync-streams.ts`'s header, `packages/sync/scripts/derive-sync-streams.ts`,
`infra/powersync/sync-config.yaml`.

1. ✅ **Sync Streams (`edition: 3`), not classic Sync Rules (`bucket_definitions`).** Confirmed:
   the pinned self-hosted image validated a `streams:` config with zero errors, and classic
   Rules' JOIN/subquery ban would have blocked questions 2–3 below permanently. The generator
   was re-targeted (`derive-sync-streams.ts`); the classic-rules attempt is preserved in git
   history, not the working tree.
2. ✅ **`businesses`, `regulatory_rates`, `veterinary_products` now sync.** The two-hop predicate
   (`auth.user_id()` → `farm_users` → `farms` → `business_id`/`jurisdiction`), written as
   `IN (SELECT ...)`, validated and REPLICATED REAL ROWS against the running service — confirmed
   by reading the container's replication log, not just config validation. No migration needed.
3. ✅ **`users` now syncs a co-member's row, not just the viewer's own.** RLS's exact
   `id = self OR co-member-of-a-shared-farm` shape, written with `IN` (⚠️ `EXISTS` does NOT
   validate under Streams either — "Unknown function", confirmed empirically — so this uses the
   same `IN (SELECT ...)` pattern as Q2, not the more natural `EXISTS`). Validated and replicated.
4. **OPEN — `farm_users.expires_at` still cannot be enforced by any generated stream.**
   Confirmed empirically: a stream using `now()` fails validation ("Unknown function") under
   Streams exactly as it did under classic Rules — this gap is format-independent, not a Streams
   limitation that might later close. ⚠️ Also newly learned: **a single invalid stream fails the
   ENTIRE sync config**, not just that stream — there is no partial-success mode, so a future
   wrong guess for one table breaks replication for all of them, not just the one that was wrong.
   RLS already refuses an expired-but-not-deleted membership at the API, so nothing already
   on-device becomes wrongly readable, but a not-yet-downloaded row keeps landing after RLS says
   no. Closing it needs a scheduled job that soft-deletes expired memberships, making
   `deleted_at` the one revocation signal both systems share. Wanted for 3b, or deferred?
   → _Answer:_

**Resolved 2026-08-09 — Werf absorbs Voorman's planning discipline; Voorman is archived, not
merged.** The comparative audit found Werf has the stronger requirements, legal, offline, tenancy
and implementation foundation. Keep React/NestJS/Postgres/PostGIS/PowerSync and `af-south-1`;
adopt Voorman's authority index, rule ownership and readiness hygiene. Google OIDC becomes the
primary connected sign-in through the ADR-0011 server BFF. Passkeys remain the phishing-resistant
alternative/step-up path; no new password-only onboarding and never SMS. Claude Code owns canonical
workflow guidance; Codex is a support adapter and cannot override it. Full evidence and remaining
boundaries: `docs/04-delivery/werf-voorman-consolidation-audit-2026-08-09.md`.

**Resolved 2026-08-08 — object storage belongs in Phase 3.** The owner approved one shared
local-first attachment foundation for animal photos, later crop/grievance documents and generated
packs: OPFS blobs + SQLite metadata/queue on the device, an S3-compatible boundary with MinIO in
development/tests, and S3 in `af-south-1` in production. Phase 2 remains honest: it stores no photo
and claims none until that Phase 3 slice lands.

## 4. Verification

| Check | Latest result |
|---|---|
| `pnpm test:e2e` (2026-08-09, `phase-3/powersync-foundation`) | 27/27 passed in 49.7s, including the production-worker offline journey — re-run deliberately after `apps/web/vite.config.ts`'s `worker: { format: 'es' }` change, which alters how every worker in the build is emitted, not just the SDK's |
| `pnpm verify` | Uncached: 84 test files / 953 tests, 7/7 builds; bundle 148.04 KB gz ≤ 250 KB |
| `pnpm project:check` | Green. ⚠️ Unanswered owner decisions are now a WARNING, not a failure — the old exit-1 made "ask, do not guess" break the definition of done. `--strict` restores the hard failure and **nothing invokes it yet**; that is a deliberate, informed weakening, not an oversight |
| FR-101 focused tests | 22/22 green (`AddAnimal` + `Lifecycle`) |
| CI | Both PR lanes green at `a3894e6`: main gate 4m0s; E2E/axe 1m46s |
| Review agents | ✅ **Tenth pass run 2026-08-08 at owner request over `17891f0..HEAD`.** `sync-auditor`: APPROVABLE. `compliance-checker`: APPROVABLE — **withdraws its standing NOT APPROVABLE**. `reviewer`: NOT APPROVABLE, carried solely by the exit-gate line "owner-triggered passes still open", which this pass closed. **No SEV-1 and no SEV-2 from any agent** |
| `pnpm verify` (2026-08-09, `phase-3/powersync-foundation`) | Uncached: 86 test files / 965 tests, 7/7 builds; bundle 151.17 KB gz ≤ 250 KB (was 148.04 KB — the honest cost of the pure schema code, not the SDK's WASM engine, which is deliberately kept out of the bundle; see §5) |
| `pnpm verify` (2026-08-09, consolidation/auth hardening) | ✅ Uncached: project check + lint/format + 12/12 typecheck tasks; 89 test files / 975 tests; 7/7 builds; bundle 151.69 KB gz ≤ 250 KB |
| `pnpm test:e2e` (2026-08-09, consolidation/auth hardening) | ✅ 27/27 Chromium journeys passed in 56.0s, including axe in both themes and the production-worker offline capture/reload/reconnect path |

## 5. Next executable steps

1. ✅ Done 2026-08-08: the owner-triggered tenth pass ran; see §6. MED/LOW findings were
   fixed under clause 3 (both code fixes carry a test watched to FAIL first) or filed on `main` as
   **#4** (a refused animal taints nothing), **#5** (`dobEstimated` read by nothing), **#6** (an
   aborted round wipes the hold display), **#7** (`/not-sent` says "record it again" for a tally,
   and a recount RESETS), **#8** (⛔ Phase 3 blocker — `landed()` breaks on hydration), **#9**
   (stale STATUS.md section pointers, low/docs-only).
2. ✅ Done 2026-08-09: **Phase 3 slice 3a** on `phase-3/powersync-foundation` (unpushed —
   this touches sync and awaits an owner-triggered `sync-auditor` pass before it can be called
   merge-ready). `@powersync/web`/`@powersync/common` installed behind `@werf/sync`; local
   SQLite schema derived from `TENANCY` + `@werf/db` via `pnpm --filter @werf/sync
   generate:schema`, drift-checked in CI. Full detail and two real findings from building it
   (the WASM-in-bundle trap, the `theft_incident_animals` surrogate-id gap → **#10**) are in
   `docs/04-delivery/phase-checklists.md` under 3a. `createLocalDatabase` exists
   (`@werf/sync/local-database`) but is not wired to anything yet — no call site until 3b.
3. ✅ Done 2026-08-09: **Werf/Voorman consolidation and immediate auth/UI hardening.** Rotating
   session credentials moved to a host-only HttpOnly cookie; durable browser storage now holds only
   the non-secret offline identity/farm projection; auth-sensitive application throttles, strict
   header/CSP baselines, 15-character new-password floor and the first accessible semantic skeleton
   are implemented. Application throttling is not the production perimeter: shared Redis limits,
   WAF/account-aware delay and Google OIDC/account linking remain explicit ADR-0011 work.
4. ✅ Done 2026-08-09: **confirmed the static WASM core actually opens in a browser** — the
   check §5 item 4 required before any other 3b work. A diagnostics-only Vite entry
   (`apps/web/diagnostics.html`, own build, own `dist/diagnostics/` output, never in the main
   bundle/precache) dynamic-imports `@werf/sync/local-database`, opens a real `PowerSyncDatabase`
   in Chromium, and round-trips a write that survives a fresh navigation — real OPFS persistence,
   not an in-memory illusion of it. `apps/web/e2e/local-db-diagnostic.spec.ts` proves it; `pnpm
   test:e2e` now builds this entry first. The postinstall 404 was a non-issue: the static WASM
   assets ship inside `@journeyapps/wa-sqlite`'s own package (confirmed on disk) regardless.
5. ✅ Done 2026-08-09, **superseded same day by item 6** — first attempt generated classic
   `bucket_definitions` sync rules from `TENANCY`. Kept only as git history: three tables could
   not be expressed at all (no JOINs/subqueries in that format) and the YAML was never validated
   against a real service. Do not resurrect this shape; item 6 is the current, empirically
   confirmed state.
6. ✅ Done 2026-08-09: **self-hosted PowerSync service stood up (docker-compose) and PowerSync
   Sync Streams generated from `TENANCY`, both empirically validated together** —
   `journeyapps/powersync-service:1.23.3` (`infra/powersync/`, Postgres storage backend on the
   same server as the source DB, `wal_level=logical` added to `docker-compose.yml`'s postgres
   service), `packages/sync/scripts/derive-sync-streams.ts` → `infra/powersync/sync-config.yaml`
   (`pnpm --filter @werf/sync generate:sync-rules`, drift-checked by
   `sync-streams-freshness.spec.ts`). Booted the real service, watched it validate and REPLICATE
   REAL ROWS from every one of the 15 synced tables (confirmed in the container's own replication
   log, not just config validation) — this is the empirical check §3's Q1 asked for, and it
   answered Q1–Q3 outright (see §3). `sync-streams-rls-agreement.spec.ts` reads the real RLS
   migrations off disk and proves tenant-scoped tables are built on `app_user_farm_ids()` and
   reference tables are `FOR SELECT USING (true)`, matching each stream's shape. Empirically
   confirmed a permissive hand-edit fails the freshness test (tampered a `WHERE` clause away,
   watched it fail, reverted). ⛔ One open owner question remains — §3 Q4, `expires_at`,
   confirmed format-independent, not Streams-specific. Dev-only RS256 keypair for
   `client_auth.jwks` generated to scratchpad, NOT committed (only the public JWK is in
   `service.yaml`) — production key custody is ADR-0011/task-4 territory, not decided here.
7. Next: a `PowerSyncBackendConnector` (`fetchCredentials` mints a short-lived PowerSync JWT
   against the HttpOnly session cookie; `uploadData` drains the local write queue) so
   `createLocalDatabase` can actually `.connect()`. ⚠️ The moment a real `.connect()` feeds any
   app read path, tripwire 3e (below) fires — decide explicitly whether that slice's connect stays
   e2e-only or pulls the `landed()` fix forward, and write the decision here.
8. ⛔ Read tripwire 3e (`phase-checklists.md`) before writing any hydration/down-sync code —
   `landed()` breaks the day mobs/tallies come down from the server.
9. Do not begin payroll on local adapters.
10. ⚠️ `docs/phase-3-6-scope` is still stacked on the pre-merge `phase-2/livestock`, not `main` —
    this was flagged last session and NOT done this session (stayed scoped to 3a/3b). Rebase it
    onto `main` before starting any Phase 3–6 scope-doc work, and before it drifts further.

## 6. The review-pass stopping rule (set 2026-08-05 by JP) — ⚠️ SATISFIED, keep it anyway

Restored here after the tenth pass found it had been deleted wholesale by this branch's own
STATUS compaction while `roadmap.md` still pointed at it. It is decision state, not session
narrative. **Do not delete it again; a rule nobody can find is not a rule.**

| # | Clause |
|---|---|
| 1 | **Scope narrows every pass.** A pass reviews only the previous pass's fix diff plus anything committed since — never the accumulated range |
| 2 | **A severity floor clears the gate.** A pass CLEARS on no SEV-1 and no SEV-2 in its range. MED/LOW are fixed or filed as tracked issues on `main`; they are not merge blockers |
| 3 ⭐ | **The terminal condition.** If a pass returns only MED/LOW, those fixes merge WITHOUT another pass, provided each is (i) mechanical, (ii) confined to the files the finding names, and (iii) covered by a test **watched to FAIL against the old code first**. A SEV-1/SEV-2 fix never qualifies |
| 4 | **Hard ceiling: two passes.** Three consecutive passes finding severe defects in a shrinking diff is a DESIGN problem — escalate as a scope decision, not more review |
| 5 ⭐ | **An accepted redesign resets the ceiling ONCE**, scoped to the replacement diff alone. ⛔ If that pass returns a SEV-2 in the replaced mechanism, the answer is **descope, not a third design** |

It does not lower the bar on regulated code: a SEV-1/SEV-2 in FR-131 / animal ID / stock theft /
POPIA blocks the merge absolutely. It changes *when reviewing stops*, never *what a defect is*.
Amendments are JP's and must be asked for out loud, never quietly re-interpreted.

**Outcome, 2026-08-08 — the recursion terminated.** Passes one to nine were all NOT APPROVABLE,
each finding a real defect inside the previous one's fixes. Clause 4 fired at the ninth; JP chose
redesign over descope; the tenth pass ran under clause 5 over the replacement and **cleared under
clause 2 — no SEV-1, no SEV-2, from any of the three agents.** The clause-5 "once" is now spent.

Two things worth keeping from it:

- **`sync-auditor` finding #3 was REFUTED with evidence, and the refutation matters as much as the
  confirmations.** It claimed `/not-sent` never says "Record it again" and that the `Outbox.tsx`
  comment saying so was a stale premise. It is not: a head shortage throws `ValidationError`
  (`mob-tally.ts:146`) → `werf-error.filter.ts:85` maps it to code `VALIDATION` → `reasonKey`
  renders `notSent.why.validation` = *"Record it again, checking the numbers and dates."* Checking
  `notSent.intro` alone is not checking that screen's copy. **The "fix" would have been the defect.**
- **Both `reviewer` and `sync-auditor` independently found the same Phase-3 landmine**, which is
  worth more than either alone: `landed()` is this device's sent-log. Exact until hydration ships,
  silently wrong after. Written into the Phase 3 checklist as tripwire 3e, not left in a comment.

## 7. Standing decisions

- Offline writes complete locally; network reconciliation is background work.
- Review agents are owner-triggered only.
- A 4xx capture is retained and set aside; a 5xx/transient error aborts the round.
- Aggregates are projections of append-only logs ordered by `(occurred_at, id)`; recounts reset.
- Regulated values are effective-dated data resolved by farm jurisdiction and `occurred_at`.
- Labour-law review and verified Gazette figures gate deployment, not writing placeholder-driven
  domain mechanics.
- Phone-only invitations are handed over in person; SMS is not a second factor or credential path.
- SAFEX/red-meat licence conversations begin in the later integration/compliance work, not now.
- Attachment storage is a Phase 3 shared foundation: OPFS + SQLite locally, MinIO in dev/test, S3 in
  `af-south-1` in production; uploads are deferred and never block capture.
