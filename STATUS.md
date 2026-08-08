# STATUS — current project handoff

> Read this before planning. This file records current state, owner decisions, verification evidence,
> and the next executable slice. Historical session narratives belong in git history, not here.

**Last updated:** 2026-08-08

**Active branch:** `phase-2/livestock`, including the FR-101 capture closure

**Remote state:** implementation through `a3894e6` is pushed to draft PR #3; both CI lanes are green

## 1. Delivery position

| Phase | State | Evidence / boundary |
|---|---|---|
| 0 — Scaffold | Merged | `main` |
| 1 — App shell, auth & 2FA | Merged | PR #2, `9452ebc` |
| 2 — Livestock | Built, not merge-ready | The remaining FR-101 date/source capture gap is closed; uncached `pnpm verify` and e2e are green. Regulated livestock work still requires the owner-triggered compliance pass before this may be called merge-ready |
| 3 — Offline sync | Not started | The current browser stores are local adapters. The PowerSync/SQLite replication described by ADR-0003 is not installed or implemented and must precede another large offline domain |
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

## 3. Owner decision

**Awaiting owner — object storage:** FR-108 animal photographs and persisted evidence-pack PDFs need
an S3/MinIO tier with local-first metadata and deferred uploads. Choose one:

- Add the storage foundation to Phase 3 so later crop, grievance-document and evidence-pack work all
  use one offline upload path; or
- Defer it explicitly, keeping photo/evidence features partial and preventing UI or PDFs from
  claiming an attachment exists.

No storage implementation should begin until this is answered.

## 4. Verification

| Check | Latest result |
|---|---|
| `pnpm test:e2e` | 27/27 passed in 1.2 minutes, including all Phase 2 capture screens in both themes and the production-worker offline journey |
| `pnpm verify` | Uncached: 84 test files / 953 tests, 7/7 builds; bundle 148.04 KB gz ≤ 250 KB |
| `pnpm project:check` | Green: STATUS 99/300 lines, no unanswered decisions, phase names agree |
| FR-101 focused tests | 22/22 green (`AddAnimal` + `Lifecycle`) |
| CI | Both PR lanes green at `a3894e6`: main gate 4m0s; E2E/axe 1m46s |
| Review agents | Not run in this session. The owner will trigger them later |

## 5. Next executable steps

1. Owner decides whether the shared local-first object-storage/upload foundation belongs in Phase 3
   (recommended) or is explicitly deferred further. No Phase 2 attachment claim depends on it.
2. When ready, owner triggers the Phase 2 reviewer, sync-auditor and compliance-checker passes. This
   work touches regulated livestock/stock-theft logic; green automation is not legal clearance.
3. Close findings, re-run both gates, push, and read both CI lanes before changing draft PR #3 to
   ready. Start Phase 3 from the offline-sync checklist; do not begin payroll on local adapters.

## 6. Standing decisions

- Offline writes complete locally; network reconciliation is background work.
- Review agents are owner-triggered only.
- A 4xx capture is retained and set aside; a 5xx/transient error aborts the round.
- Aggregates are projections of append-only logs ordered by `(occurred_at, id)`; recounts reset.
- Regulated values are effective-dated data resolved by farm jurisdiction and `occurred_at`.
- Labour-law review and verified Gazette figures gate deployment, not writing placeholder-driven
  domain mechanics.
- Phone-only invitations are handed over in person; SMS is not a second factor or credential path.
- SAFEX/red-meat licence conversations begin in the later integration/compliance work, not now.
