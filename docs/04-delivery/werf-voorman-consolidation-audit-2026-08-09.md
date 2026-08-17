# Werf and Voorman consolidation audit

**Date:** 2026-08-09 | **Decision:** Keep Werf; archive Voorman after preserving its planning record

## Executive conclusion

The premise that Werf skipped planning is not supported by the repositories. Werf has the deeper
requirements, legal, architecture, schema, offline, test, delivery and operational design, plus a
working monorepo. Voorman is a thoughtful but incomplete planning pack with no application
implementation. Rebuilding Werf on Voorman's proposed Supabase/Vercel/Dexie stack would discard
proven work and weaken two non-negotiables: South African data residency and deterministic
offline-first conflict handling.

The unsugarcoated finding is different: Werf planned extensively but governed those documents
poorly. Its pack had no authority index, several stale phase/provider statements, and identical
Claude/Codex instruction files that allowed two tool surfaces to become competing policy sources.
Voorman is better at planning hygiene, not product architecture. This consolidation adopts that
hygiene and keeps Werf's technical foundation.

## Scope reviewed

The audit read both repository roots and their planning packs, including:

- Werf: BRD, SRS, functional and non-functional requirements, stories/use cases, legal and
  compliance registers, UX system, all architecture documents and ADRs, database/API/offline
  contracts, security/operations/runbooks, roadmap/checklists/testing/CI, user guide, `STATUS.md`,
  `CLAUDE.md`, `AGENTS.md`, and current auth/UI implementation and tests.
- Voorman: README, Claude/agent guidance, documentation index, PRD, business-rules registry,
  architecture/security/offline/backup/i18n/UX/design-system/testing plans, ADRs, open questions,
  risk/commercial/planning readiness, milestone plan and implementation-task template.

This is a document and implementation audit, not a penetration test or independent legal opinion.

## Standards basis

- [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
  and [HTML5 Security](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html):
  cookie attributes, `no-store`, and no session identifiers in localStorage.
- [OWASP Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
  and [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html): throttling, generic failures,
  phishing-resistant options and modern password handling.
- [OAuth 2.0 Security BCP (RFC 9700)](https://www.rfc-editor.org/rfc/rfc9700), the
  [IETF browser-apps BFF draft](https://datatracker.ietf.org/doc/draft-ietf-oauth-browser-based-apps/),
  and [Google's server-side OAuth guidance](https://developers.google.com/identity/protocols/oauth2/web-server):
  authorization code + PKCE and server custody of reusable tokens.
- [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/) Level AA: focus, target size, accessible
  authentication, reflow and status semantics.
- Official [NestJS throttling](https://docs.nestjs.com/security/rate-limiting) and
  [Helmet](https://helmetjs.org/) documentation for the implemented application controls.

These sources change at different cadences. Re-check their current published versions during the
Phase 7 security gate rather than treating this dated audit as a permanent copy of the standards.

## Comparison

| Area | Werf | Voorman | Consolidated decision |
|---|---|---|---|
| Product definition | Detailed BRD/SRS plus traceable FR/NFR set | Clear PRD, still review-required | Keep Werf; adopt one front-door index |
| Business rules | Deep legal detail, split across several files | Cleaner single registry with IDs/owners | Add stable ownership/source discipline to Werf's compliance register |
| Offline model | PowerSync + SQLite/OPFS; immutable logs and deterministic projections | Dexie/outbox proposal, materially less specified | Keep Werf |
| Tenancy | `farm_id`, RLS, sync rules and tests | Supabase RLS matrix is clear but unimplemented | Keep Werf; copy matrix-style documentation where useful |
| Data residency | AWS `af-south-1`, self-hosted services | Supabase/Vercel proposal has no proved ZA-resident data plane | Keep Werf; reject hosted Supabase for production |
| Authentication | Implemented password, passkey/TOTP, recovery, server guard; browser token storage was weak | Google-first + OTP is better product direction, but Supabase browser storage does not solve token theft | Adopt Google-first BFF target in ADR-0011; retain passkeys |
| Security detail | Extensive threat model and known-gap ledger | Good high-level controls, mostly proposed | Keep Werf and close gaps rather than restart |
| UX | Strong farm-specific tokens, two themes, 48px targets, offline truth | Better explicit skeleton/optimistic-state language | Add reusable skeleton and codify local-first rendering |
| Accessibility | WCAG 2.2 AA target, automated axe in both themes | General accessibility intent | Keep Werf; add manual 2.2 acceptance checks |
| Delivery governance | Detailed phase gates, but accumulated drift | Better open-question/risk/readiness structure | Adopt Voorman's hygiene |
| Implementation | Working TypeScript monorepo with broad tests | No application code found | Werf is the only rational base |

## Security findings and target

### 1. Browser session storage

The former browser cache included access and 30-day rotating refresh tokens. That was a high-value
XSS prize and should not have reached production. The applied correction makes the refresh/session
credential an `HttpOnly`, `Secure` (production), `SameSite=Strict`, host-only cookie. The browser
stores only the non-secret offline identity/farm projection; a short access token exists only in
React memory. Auth responses are `no-store` and no longer serialize refresh credentials.

This is an important interim improvement, not the final BFF. A successful same-origin XSS can still
make authenticated requests and can read a memory-held access token. The target in ADR-0011 is a
server-side BFF that holds OAuth/provider and API credentials and exposes only the hardened cookie.
CSP, Trusted Types where feasible, dependency controls and output encoding remain mandatory.

### 2. Authorization and admin

Werf's current routes already default-deny through a global server `AuthGuard`; tenant/role checks
are repeated in services and RLS. Client route guards are presentation only. There is no current
platform-admin feature to bless. Any future admin action must use server policy plus database
scope, require step-up authentication, write an immutable audit event, and never trust a client
claim, hidden button or cached role.

### 3. Rate limiting

Application-wide throttling and tighter login/register/refresh/2FA/WebAuthn ceremony budgets are
now implemented. That makes brute-force and resource exhaustion harder on one API instance. It is
not sufficient production protection: per-process counters disappear on restart and do not
coordinate replicas. Before public deployment, add edge/WAF bot controls, a shared Redis-backed
limiter, per-account exponential delay, generic responses, breached-credential signals, alerting
and a tested emergency rule-update runbook. IP-only lockouts are inadequate behind carrier NAT and
can become denial-of-service tools.

### 4. Login direction

Use Google OpenID Connect as the primary sign-in for owners, managers and bookkeepers through the
server-side authorization-code flow with PKCE, state and nonce. Do not add a new Werf password path.
Keep passkeys as the phishing-resistant alternative, step-up and recovery route; keep TOTP and
single-use recovery codes as transitional fallbacks; never use SMS as a factor.

Existing password accounts need an explicit linking migration. Do not delete their only route in
while offline queues or farm ownership depend on it. If passwords remain during migration, require
modern long-password handling, compromised-password blocklisting, no composition gimmicks,
Argon2id, aggressive throttling, and a forced/linking journey toward Google or passkey.

## UI findings and target

- Werf already has an agricultural semantic system: soil/sand/ochre foundations and
  rooigrond/klei/aloe/dam states. Keep semantic meaning stable across themes; never put raw colour
  choice or theme conditionals in components.
- A reusable, accessible skeleton list is now used on the security-device screen. Skeletons are
  appropriate only when structure is known; uncertain/long operations need honest progress copy.
  Shapes are hidden from assistive technology, loading is announced, and animation respects
  reduced motion.
- WCAG 2.2 AA remains the baseline. Automated axe checks are necessary but do not prove keyboard,
  focus order/not-obscured, screen-reader announcements, reflow, accessible authentication,
  sunlight contrast or Afrikaans truncation. Those are manual phase gates.
- Werf's local-first writes are stronger than conventional optimistic UI: commit to SQLite first,
  render immediately, then reconcile. Never show a temporary green server success for a capture
  that only exists in memory. Show durable local state (`saved on this device`, `not sent`,
  `refused`) and preserve set-aside records.

## Stack decision

Keep React/TypeScript PWA, NestJS, PostgreSQL/PostGIS, PowerSync/SQLite/OPFS and AWS
`af-south-1`. The stack fits the product unusually well. The problems found are boundary and
governance problems, not framework problems. It is not too late to change authentication because
the auth module is already isolated, but it is too costly and unjustified to replatform the data
and offline layers.

Avoid these regressions:

- hosted Supabase without contractually verified South African residency;
- Vercel/edge placement for worker PII without a full data-flow and processor review;
- a hand-rolled Dexie outbox replacing PowerSync's local database and sync boundary;
- localStorage OAuth/session credentials merely because a vendor SDK defaults to them;
- treating Google login as authorization or as proof of a farm/admin role.

## Applied in this consolidation

1. Hardened refresh/session cookies and removed secrets from the durable browser session cache.
2. Added global and auth-sensitive application throttles with tests.
3. Added an accessible semantic skeleton component and first production use.
4. Accepted ADR-0011 for Google-first BFF authentication and migration boundaries.
5. Added this authority index and made Claude guidance canonical; Codex is a support adapter.
6. Corrected material phase/provider drift in operational and delivery documents.

## Remaining release blockers

- Implement Google OIDC discovery, callback, account linking and provider credential storage after
  the owner supplies Google Cloud client configuration and approved redirect origins.
- Finish the BFF migration so domain API access is cookie-mediated; add CSRF/origin controls before
  broadening cookie-authenticated mutation routes.
- Deploy a shared distributed limiter and edge/WAF rules; application throttling alone is not a
  claim of brute-force resistance at scale.
- Close the existing security gap ledger: CSP/headers, step-up for factor enrolment/admin,
  enumeration-safe registration/email verification, auth audit log, key rotation and recovery.
- Run independent security testing before pilot and the owner-triggered specialist reviews at the
  gates defined by repository policy.

## Voorman disposition

Do not delete it immediately. Tag or zip the repository read-only with this audit reference so its
decision history survives. After the useful governance patterns are represented in Werf and the
owner confirms no unique commercial material remains, archive Voorman. Do not merge its codebase,
dependency choices or Supabase assumptions into Werf.
