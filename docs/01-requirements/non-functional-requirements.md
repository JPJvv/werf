# Non-Functional Requirements

Every NFR here has a **number** and a **way to measure it**. An NFR without a threshold is an opinion; an NFR without a test is a wish. Each is enforced in CI where the technology permits.

⚠️ **"Measured by" is aspirational for several rows below (Q18 audit, 2026-08-16 — see STATUS.md
§5 item 39).** Marked rows are checked against the actual repo, not assumed from this doc's own
prose: **✅ real** means the mechanism named exists and genuinely fails CI/the build today; **❌ not
wired** means nothing in the repo enforces it yet, however the threshold reads. Two are genuinely
real and previously undocumented as such (bundle size, dependency audit); the rest — Lighthouse,
coverage thresholds, the regulated-constant lint rule, per-chunk lazy budgets, file/function-length
limits — are unimplemented. This is the same failure mode Q17 found in the delivery docs: a claimed
gate that doesn't exist is worse than an absent one, because a reader stops looking for the real one.

---

## NFR-0xx · Performance

The reference device is a **Samsung Galaxy A15** (or equivalent: 4GB RAM, Snapdragon 680-class, Android 13) on a **throttled 3G connection**. Not an iPhone on office wifi. Every budget below is measured on that device.

| ID | Requirement | Threshold | Measured by |
|---|---|---|---|
| NFR-001 | First Contentful Paint, cold, 3G | ≤ 1.8s | ❌ Not wired — no Lighthouse config exists in the repo |
| NFR-002 | Largest Contentful Paint, cold, 3G | ≤ 2.5s | ❌ Not wired — same gap as NFR-001 |
| NFR-003 | Time to Interactive, cold, 3G | ≤ 3.5s | ❌ Not wired — same gap as NFR-001 |
| NFR-004 | **Warm start (already installed, offline)** | ≤ 1.0s to interactive | Playwright, offline context |
| NFR-005 | Interaction to Next Paint | ≤ 200ms p75 | ❌ Not wired — needs Lighthouse CI (not built) + production RUM (not built) |
| NFR-006 | Cumulative Layout Shift | ≤ 0.1 | ❌ Not wired — same gap as NFR-001 |
| NFR-007 | **Local write commit** (tap "save" → durably in SQLite) | ≤ 50ms p95 | Instrumented perf test |
| NFR-008 | Local query, 5,000-animal herd list | ≤ 100ms p95 | Instrumented perf test |
| NFR-009 | Initial JS bundle, gzipped | ≤ 250KB | ✅ Real. `apps/web/scripts/check-bundle-size.mjs`, wired into `pnpm build` → `pnpm verify` → CI, **fails the build**. A hand-written gzip-and-sum script, not the `size-limit` npm package this row used to name — the mechanism is real, the tool name was wrong |
| NFR-010 | Per-route lazy chunk, gzipped | ≤ 100KB | ❌ Not wired — `check-bundle-size.mjs` sums ALL app-code chunks against the 250KB total; it does not check any individual chunk against 100KB |
| NFR-011 | Full initial sync, 5,000 animals + 3y history | ≤ 3 min on 3G | Load test |
| NFR-012 | Incremental sync, typical day's changes | ≤ 5s, ≤ 100KB transferred | Load test |
| NFR-013 | API p95 latency (server-side) | ≤ 200ms | APM |
| NFR-014 | API p99 latency | ≤ 800ms | APM |
| NFR-015 | Payroll run, 100 employees, 1 month | ≤ 10s | Integration test |
| NFR-016 | PDF evidence pack generation | ≤ 15s | Integration test |
| NFR-017 | Local DB footprint, 5,000 animals + 3y | ≤ 200MB | Instrumented test |

**NFR-009 fails the build.** Not warns. Bundle size is a moral hazard: every PR adds 5KB and nobody notices until the app takes eleven seconds to load on the device your customers actually own. The gate is the only thing that works.

---

## NFR-1xx · Availability & Reliability

| ID | Requirement | Threshold | Measured by |
|---|---|---|---|
| NFR-101 | **Client availability while offline** | **100%** — no network dependency for any capture path | Playwright offline suite |
| NFR-102 | Sync service uptime | 99.5% monthly | Uptime monitor |
| NFR-103 | API uptime | 99.5% monthly | Uptime monitor |
| NFR-104 | Sync eventual-success rate | ≥ 99.9% within 24h of connectivity | Sync telemetry |
| NFR-105 | **Data loss** | **Zero.** A committed local write is never lost | Chaos test: kill mid-sync, reboot, verify |
| NFR-106 | RPO (recovery point objective) | ≤ 5 min | Backup verification |
| NFR-107 | RTO (recovery time objective) | ≤ 4 h | Quarterly restore drill |
| NFR-108 | Backup retention | 30 daily, 12 monthly, 7 annual | Automated |
| NFR-109 | **Restore drill** | Quarterly, tested, timed, documented | Calendar + runbook |

**NFR-101 is absolute.** Not 99.9%. A farmer in a camp with no signal must be able to record a calving. Any code path that can fail because the network is down is a defect, full stop.

**NFR-109 is not optional.** A backup that has never been restored is not a backup; it is a hope. The drill is a calendar item with an owner.

---

## NFR-2xx · Security

Full threat model and controls: [security.md](../05-operations/security.md).

| ID | Requirement | Verification |
|---|---|---|
| NFR-201 | TLS 1.3 minimum; HSTS with preload | SSL Labs A+, checked in CI |
| NFR-202 | All data encrypted at rest (AES-256) | Infrastructure assertion |
| NFR-203 | **SA ID numbers and banking details encrypted at the column level** with a key separate from the DB key | Code review + test |
| NFR-204 | Google OIDC/passkeys preferred. Any migration password uses Argon2id, compromised-password screening and modern length rules; no new password-only onboarding | Code review + auth journey tests |
| NFR-205 | Rotating session credential is server-managed and delivered only in a host-only HttpOnly Secure SameSite cookie; durable browser storage contains no bearer/session token. Interim 15-minute access JWT is memory-only until the BFF migration completes | Contract, browser-storage and cookie tests |
| NFR-206 | **Tenancy enforced in three independent layers**: PowerSync sync rules, Postgres RLS, API guards | Automated tenancy test suite; **must include a test that proves a permissive sync rule cannot leak across farms even if RLS is correct** |
| NFR-207 | No secrets in source. Ever. | `gitleaks` in CI, pre-commit hook |
| NFR-208 | Dependencies scanned; no known critical CVE in production | `pnpm audit --audit-level=critical --prod` in CI (`dependency-audit` job), blocks the PR merge. Dependabot not yet configured. **A devDependency-only critical (vitest <3.2.6, GHSA-5xrq-8626-4rwp, reachable only via a local dev-server tool never run in production) is a known, tracked, non-blocking finding as of 2026-08-16** — out of scope for this gate as written, but a real upgrade worth scheduling |
| NFR-209 | OWASP Top 10 addressed and documented | Security review per phase |
| NFR-210 | Layered rate limiting: global API budget plus tighter auth/ceremony budgets; production counters shared across replicas; account-aware delay and edge/WAF controls | Unit + distributed integration/load test |
| NFR-211 | Audit log immutable — no UPDATE/DELETE grant at the database level | Migration assertion + test |
| NFR-212 | **No farm record enters third-party telemetry.** Any future offshore AI/telemetry feature needs a separate owner decision and explicit privacy design (ADR-0013) | Architecture + code tests |
| NFR-213 | CSP with no `unsafe-inline`, no `unsafe-eval` | Header test in CI |
| NFR-214 | Penetration test before public launch | External, scheduled Phase 7 |
| NFR-215 | Local SQLite contains no unencrypted ID numbers or banking details | Code review + test |
| NFR-216 | Every farm-role or platform-admin decision is enforced by a default-deny server policy and database scope. Client roles may hide controls but never authorize an action | Negative API integration + RLS tests |

**NFR-215 deserves a note.** A stolen phone with an unencrypted local database containing 40 workers' ID numbers is a POPIA breach with a notification obligation. Sensitive fields must be either server-only (never synced) or encrypted before they reach the device. Decide per field, and document the decision in the schema.

---

## NFR-3xx · Scalability

| ID | Requirement | Threshold |
|---|---|---|
| NFR-301 | Farms per instance | 10,000 |
| NFR-302 | Animals per farm | 50,000 |
| NFR-303 | Employees per farm | 500 |
| NFR-304 | Concurrent sync connections | 2,000 |
| NFR-305 | Events per farm per year | 500,000 |
| NFR-306 | Sync service scales horizontally | Documented + load tested |
| NFR-307 | API scales horizontally (stateless) | Documented + load tested |
| NFR-308 | Postgres: read replicas for reporting | Phase 6 |
| NFR-309 | 10× load headroom without re-architecture | Load test at 10× target |

Scaling posture: at 10,000 farms the database is the constraint, not the app tier. Partition `events` by `farm_id` from the start (cheap now, a nightmare later). See [database-schema.md § Partitioning](../03-architecture/database-schema.md).

---

## NFR-4xx · Usability & Accessibility

| ID | Requirement | Verification |
|---|---|---|
| NFR-401 | WCAG 2.2 Level AA | `axe-core` in CI + manual audit |
| NFR-402 | **Touch targets ≥ 48×48 CSS px** | Lint rule + visual regression |
| NFR-403 | **Contrast ≥ 4.5:1 for text, ≥ 3:1 for UI** — the app is used in direct sunlight | `axe-core` |
| NFR-404 | Full keyboard navigation | Playwright |
| NFR-405 | Screen-reader labels on every control | `axe-core` |
| NFR-406 | Works one-handed in portrait | Manual + design review |
| NFR-407 | **Primary capture actions reachable in ≤ 2 taps from home** | Design review, enforced |
| NFR-408 | No text below 16px | Lint rule |
| NFR-409 | All destructive actions confirmable and reversible | Design review |
| NFR-410 | Works with gloves (no small targets, no precise gestures, no hover-only) | Field test |
| NFR-411 | Field-usable colour semantics do not rely on colour alone | `axe-core` + design review |

**NFR-402, 403 and 410 are field requirements, not accessibility box-ticking.** The user is standing in a crush, in the sun, wearing gloves, holding a phone in one hand and a stick in the other. A 32px button with 3:1 contrast is unusable there. This is the same reason WCAG exists, arriving from a different direction — which is why building for accessibility and building for a cattle crush produce the same design.

---

## NFR-5xx · Maintainability

| ID | Requirement | Threshold | Measured by |
|---|---|---|---|
| NFR-501 | Test coverage, domain logic (payroll, compliance, sync) | ≥ 90% | ❌ Not wired — `pnpm test` runs `vitest run` with no `--coverage` flag; no coverage number is even measured, let alone gated |
| NFR-502 | Test coverage, overall | ≥ 75% | ❌ Not wired — same gap as NFR-501 |
| NFR-503 | TypeScript strict; no `any` outside typed boundaries | `tsc` (typecheck) + eslint (`typescript-eslint` recommended config), fails CI — real |
| NFR-504 | No function > 50 lines, no file > 400 lines | ❌ Not wired — no `max-lines`/`max-lines-per-function` rule in `eslint.config.mjs` |
| NFR-505 | Public API documented (OpenAPI, generated from code) | CI check |
| NFR-506 | ADR for every load-bearing decision | Review |
| NFR-507 | Every regulated value in `regulatory_rates`, none in code | ❌ Custom lint rule not built — enforced today by code review and the owner-triggered `compliance-checker` agent only |
| NFR-508 | Migrations reversible or explicitly documented as not | Review |
| NFR-509 | `pnpm verify` from clean clone in ≤ 10 min | CI timing |

**NFR-507 gets a custom lint rule.** A regex that flags numeric literals near identifiers like `wage`, `rate`, `threshold`, `minimum`, `withdrawal` in domain code. It will produce false positives. Suppress them individually with a comment explaining why the number is not regulated. That friction is the point — it forces the question to be asked every time.

---

## NFR-6xx · Compliance & Data

| ID | Requirement |
|---|---|
| NFR-601 | Personal information of SA data subjects hosted in South Africa (risk posture — see [legal-compliance.md §1.4](../00-business/legal-compliance.md)) |
| NFR-602 | Data subject access request fulfilled ≤ 30 days |
| NFR-603 | Data export self-service, ≤ 24h |
| NFR-604 | Retention policy enforced per table, automated (**including the BCEA 3-year floor that overrides a delete request**) |
| NFR-605 | Breach detection → notification decision ≤ 72h |
| NFR-606 | Audit log retained 7 years |
| NFR-607 | Right to erasure honoured **except** where statutory retention applies; the exception is explained to the user, not silently applied |

---

## NFR-7xx · Operability

| ID | Requirement |
|---|---|
| NFR-701 | Structured JSON logs, correlation ID on every request |
| NFR-702 | Distributed tracing (OpenTelemetry) |
| NFR-703 | Golden signals dashboard: latency, traffic, errors, saturation |
| NFR-704 | Alert on SLO burn, not on raw thresholds |
| NFR-705 | Every alert has a runbook link. No orphan alerts |
| NFR-706 | Zero-downtime deploy |
| NFR-707 | Feature flags for risky paths |
| NFR-708 | Rollback ≤ 5 min |
| NFR-709 | **Client-side error reporting with PII scrubbed** |
| NFR-710 | **Sync health is a first-class dashboard**: queue depth, conflict rate, failure rate by farm |

**NFR-710 matters more than it sounds.** Sync failures are invisible — the farmer thinks their data is saved and it is, locally. The silent failure is on our side. If we do not watch sync health per farm, we will find out about problems when a customer calls after losing a week.

---

## Budget summary — the numbers that fail a build

**⚠️ Not every row here is actually wired (Q18, 2026-08-16) — see the per-NFR ✅/❌ marks above for
the real state of each. This table is the target; `pnpm verify` + CI is the two gates that are
real today.**

| Gate | Threshold | Real? |
|---|---|---|
| Initial JS bundle | 250KB gz | ✅ |
| Domain test coverage | 90% | ❌ not measured |
| Overall test coverage | 75% | ❌ not measured |
| Lighthouse Performance | ≥ 90 | ❌ not wired |
| Lighthouse Accessibility | 100 | ❌ not wired (distinct from `axe-core`, which is real — see below) |
| `axe-core` violations | 0 | ✅ `pnpm test:e2e`, both themes, CI `e2e` job |
| Critical CVEs (production) | 0 | ✅ `pnpm audit --audit-level=critical --prod`, CI `dependency-audit` job |
| Secrets detected | 0 | ✅ `gitleaks`, CI `verify` job |
| Type errors | 0 | ✅ `tsc`, CI `verify` job |
| Uncovered P1/P2 FR | 0 | ❌ not enforced — `pnpm test:trace` is report-only, phase-aware as of this session (STATUS.md §5 item 39), never run with `--strict` in CI |

Real gates are wired into `pnpm verify` and the CI pipeline. See [ci-cd.md](../04-delivery/ci-cd.md)
— its own top-of-file note carries the fuller "target vs. actual" caveat for the whole PR pipeline
design, not just this table.
