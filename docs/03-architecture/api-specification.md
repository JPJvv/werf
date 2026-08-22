# API Specification

> ⛔ **READ THIS BEFORE §1. This document is the PHASE-3 TARGET, and §1 currently contradicts the
> API that is built.** As at the end of Phase 2 the server carries **24 REST capture endpoints** —
> `POST /api/livestock/animals`, `/mobs`, `/mob-tallies`, `/births`, `/deaths`, `/sales`,
> `/treatments`, `/dips`, `/moves`, `/matings`, `/pregnancy-tests`, `/theft-incidents`, …, plus
> `POST /api/land-units`, `/api/land-units/boundary-walks` and `POST /api/rainfall`. §1 below says
> those must not exist ("*if you find yourself adding `POST /animals`, stop*"). **They are not a
> defect and they are not a REST twin of the sync path** — they are the interim transport, because
> **the PowerSync replication engine is Phase 3** (`phase-checklists.md` § Phase 2 scope boundary,
> ADR-0003). The client captures offline through the `packages/sync` adapter seam and the outbox
> flushes to these endpoints; in Phase 3 the engine is swapped underneath with no UI rewrite, and
> the write path becomes `POST /sync/write`. **There is still only ONE validation path** — every one
> of these endpoints goes through the shared `insertEvent` / `assertCanCapture` /
> `assertOwnedReferences` / `assertHerdScoped` helpers in `apps/api/src/common/event-capture.ts`,
> which is what §1's rule is actually protecting. When the swap happens, delete this warning and
> §1 becomes true as written.
>
> **Two more things below are wrong today, and both are load-bearing if you are calling the API:**
> - **The base path is `/api`, not `/v1`.** `main.ts` does `setGlobalPrefix('api')`; there is no
>   version segment anywhere in the app. Every path printed in this document has the wrong prefix.
> - **The auth routes do not match.** Built: `POST /api/auth/{register,login,refresh,logout}`,
>   `PATCH /api/auth/profile`, `POST /api/auth/2fa/verify`, and under `/api/auth/2fa/`:
>   `totp`, `totp/confirm`, `passkey`, `passkey/confirm`, `passkey/challenge`, `passkey/verify`,
>   `GET passkey`, `DELETE passkey/:passkeyId`. The `/v1/auth/totp/enrol`, `/v1/auth/verify-otp`
>   and `/v1/auth/passkey/auth` spellings in §3 below are the design, and were never built.
> - **Undocumented but live:** `GET /api/reference/species-gestation`,
>   `GET /api/livestock/residue-register`, `GET /api/health`, and the `/api/farms` surface.

---

## 1. What this API is, and is not

**It is not a CRUD API for the domain.** Animals, events, blocks, and camps do not have REST endpoints. They move over the sync path (see [architecture.md §3](architecture.md)). A client that wants to create a calving inserts into local SQLite and lets the sync engine handle it.

**This API is the server-authoritative path.** It exists for the things a client must not be trusted to compute or generate:

| Group | Why it cannot live on the client |
|---|---|
| Auth | Obviously |
| Payroll | Stale rate table → a legally wrong document |
| Compliance packs | Needs certificates, PDF rendering, and evidence the client does not hold |
| Reports | Aggregation across data the client does not sync (finance, audit) |
| Integrations | Credentials |
| Admin | Regulatory rates, user management |
| Sync write path | PowerSync routes client writes here so RLS and business rules apply |

If you find yourself adding `POST /animals`, stop — that is the sync path, and adding a REST twin means two write paths with different validation.

**Base:** `https://api.werf.co.za/v1` · **Auth:** `Authorization: Bearer <jwt>` · **Content:** `application/json` · OpenAPI generated from NestJS decorators; `/v1/openapi.json` is the artifact, this document is the intent.

---

## 2. Conventions

**Errors** — RFC 9457 Problem Details, always:

```json
{
  "type": "https://werf.co.za/errors/invalid-payroll-period",
  "title": "Pay period ends before it starts",
  "status": 422,
  "detail": "The end date 2026-03-01 is before the start date 2026-03-31. Choose a valid period.",
  "instance": "/v1/farms/019.../payroll/runs"
}
```

`detail` names the person, the number, and the rule. An error that says "Validation failed" has told the user nothing and will generate a support ticket.

**Idempotency** — every mutating request accepts `Idempotency-Key`. Required on payroll and billing. A client on EDGE will retry, and a double-approved payroll pays everyone twice.

**Money** — always an object, never a bare number:

```json
{ "amount": "241.84", "currency": "ZAR" }
```

String, not float. `241.84` as a JSON number is a float somewhere downstream, and floats do not belong in payroll.

**Dates** — `occurred_at` is ISO 8601 with offset (`2026-03-15T06:00:00+02:00`). Preserve the offset the client sent; it carries information about when the farmer thinks it happened.

**Pagination** — cursor, never offset: `?cursor=<opaque>&limit=50` → `{ data: [], nextCursor: "..." }`.

---

## 3. Auth

```
GET    /v1/auth/google            → 302 Google authorization (target, ADR-0011)
GET    /v1/auth/google/callback   → 302 app; sets hardened session cookie (target)
POST   /v1/auth/register          → 201 browser-safe session; sets session cookie (migration)
POST   /v1/auth/login             → 200 browser-safe session or 2FA challenge; sets cookie
POST   /v1/auth/refresh           → 200 browser-safe session; rotates HttpOnly cookie
POST   /v1/auth/logout            → 204; clears cookie
POST   /v1/auth/totp/enrol        → 200 { secret, qrCode }
POST   /v1/auth/totp/verify       → 204
POST   /v1/auth/passkey/register/options   → 200 { WebAuthn creation options }
POST   /v1/auth/passkey/register           → 201 { credentialId, deviceLabel }
POST   /v1/auth/passkey/auth/options       → 200 { WebAuthn request options }
POST   /v1/auth/passkey/auth               → 200 browser-safe session; sets cookie
DELETE /v1/auth/passkey/{credentialId}     → 204
POST   /v1/auth/recovery-codes             → 200 { codes: [10] }   # shown ONCE
POST   /v1/auth/2fa/reset-request          → 202 { availableAt }   # 48h delay
```

`POST /v1/auth/register` creates the business, first farm, owner membership and session in one
transaction. Its `business` member carries `name`, nullable `registrationNumber`, a `contact`
object with nullable `email` and `phone` (at least one required), and a `physicalAddress` object
with required `line1`, `locality`, `province` and `postalCode` plus nullable `line2` (FR-001).
The database columns remain nullable only so tenants created before migration 0027 survive the
additive rollout; the current wire contract does not accept an incomplete new business. These
details are not in the PowerSync projection: no current offline screen needs contact/address data,
so sending a sole proprietor's details to every accepted farm member would violate data minimisation.

**Token policy:**
- Access during BFF migration: 15 min, returned to the SPA and held in memory only. Contains
  `sub`, farm context and `exp`; server/RLS authorization remains authoritative.
- Refresh/session: **30 days**, rotating, single-use, hashed server-side and transported only by a
  host-only HttpOnly Secure SameSite cookie. It is never serialized into the browser response.
- Auth responses use `Cache-Control: no-store`. Refresh and logout carry no token request body.
- The 30 days is the offline session window (FR-006). A farmer offline for three weeks must not be locked out of their own data.

Google OIDC and the cookie-only BFF end state are defined in ADR-0011. Until that migration is
complete, the password endpoints are compatibility routes, not the desired onboarding direction.
The additive route sequence, old-PWA overlap and removal gates are defined in the
[Google OIDC and cookie-BFF migration plan](../04-delivery/google-bff-migration-plan.md).

**The rule that matters:** if a refresh token has expired and the client has a pending write queue, **the queue is held, not discarded** (UC-050 A2.1). Prompt for login, then upload. Discarding a farmer's month of work because a token expired is the single worst thing this system could do, and it is a two-line mistake to make.

---

## 4. Sync write path

Called by PowerSync, not by application code. Documented because it is where every client write lands.

```
POST /v1/sync/write
Authorization: Bearer <jwt>
Idempotency-Key: <uuid>

{
  "writes": [
    { "id": "019...", "op": "put", "table": "animals",
      "data": { ... }, "occurredAt": "2026-03-01T06:00:00+02:00" },
    { "id": "019...", "op": "put", "table": "events", "data": { ... } }
  ]
}
```

```json
200 {
  "checkpoint": "01HXYZ...",
  "results": [
    { "id": "019...", "status": "applied" },
    { "id": "019...", "status": "conflict_resolved",
      "resolution": "field_merge", "auditId": "019..." },
    { "id": "019...", "status": "quarantined",
      "reason": "references deleted entity", "reviewId": "019..." }
  ]
}
```

**Every write returns a per-write status.** Never a bare 200. The client needs to know which of its 47 queued records need human attention, and `quarantined` is how a write survives a validation rule that changed while the device was offline (UC-050 E4.2). It is never dropped.

Writes are applied in `occurredAt` order within a batch, in one transaction, with RLS and business rules enforced exactly as if the write had arrived online.

---

## 5. Payroll 🇿🇦

The most important endpoints in the system. See [legal-compliance.md §2.4](../00-business/legal-compliance.md).

```
POST /v1/farms/{farmId}/payroll/runs
{ "periodStart": "2026-03-01", "periodEnd": "2026-03-31" }
```

```json
201 {
  "id": "019...",
  "status": "warned",
  "totalGross": { "amount": "48204.11", "currency": "ZAR" },
  "totalNet":   { "amount": "45890.22", "currency": "ZAR" },
  "warnings": [
    {
      "severity": "warning",
      "code": "PIECE_RATE_TOPPED_UP",
      "employeeId": "019...",
      "employeeName": "Thabo Mokoena",
      "message": "Piece rate earnings of R160.00 fell below the minimum of R241.84 for 8 hours. Topped up by R81.84.",
      "gazetteReference": "GG 54075, 2026-02-03"
    },
    {
      "severity": "warning",
      "code": "OVERTIME_EXCEEDS_CAP",
      "employeeId": "019...",
      "employeeName": "Maria Sithole",
      "message": "14 overtime hours worked; the weekly cap is 10. All hours are paid in full. Review the roster.",
      "gazetteReference": "BCEA s10"
    },
    {
      "severity": "warning",
      "code": "NET_BELOW_MINIMUM",
      "employeeId": "019...",
      "employeeName": "Sipho Ndlovu",
      "message": "Deductions of R5,200.00 would reduce net pay below the reference floor. Review the deductions or continue.",
      "gazetteReference": "BCEA s34"
    }
  ]
}
```

```
GET  /v1/farms/{farmId}/payroll/runs/{runId}          → the draft with warnings
POST /v1/farms/{farmId}/payroll/runs/{runId}/approve  → 200; warnings remain attached to the run
GET  /v1/farms/{farmId}/payroll/runs/{runId}/payslips → payslips
GET  /v1/payslips/{id}/pdf                            → 302 → presigned S3
POST /v1/farms/{farmId}/payroll/runs/{runId}/exports  → { "format": "pdf"|"xlsx"|"uif"|"sars"|"eft" }
POST /v1/farms/{farmId}/labour/documents              → { "document": "particulars"|"employees"|"attendance"|"piece_work"|"leave"|"employment_record", "format": "pdf"|"docx"|"xlsx", "from"?: "...", "to"?: "...", "employeeIds"?: [...] }
```

**Design notes worth defending:**

- **Creating a run does not approve it.** `POST /runs` computes and returns warnings. Approval is a second, explicit call. There is no `?autoApprove=true`, ever.
- **Every warning carries a `gazetteReference`.** When the farmer asks "says who?", the API has already answered.
- **Warnings never make `/approve` return 422.** They are returned data shown before approval; only
  structural integrity, authorisation or tenancy failures reject a request (ADR-0015).
- **Documents are explicit downloads.** The API generates an audit-logged job and expiring link; it
  does not email, file or send the output to a third party.
- **This endpoint has no offline story and that is deliberate.** See [UC-020 step 2](../01-requirements/use-cases.md).

---

## 6. Compliance 🇿🇦

```
POST /v1/farms/{farmId}/compliance/theft-incidents/{id}/evidence-pack
     → 202 { jobId }                      # async: needs certificates + PDF render
GET  /v1/jobs/{jobId}                     → { status, resultUrl? }

GET  /v1/farms/{farmId}/compliance/checklists/{standard}
     → checklist with evidence auto-mapped and completeness %
POST /v1/farms/{farmId}/compliance/checklists/{id}/evidence-pack
     → 202 { jobId }

GET  /v1/farms/{farmId}/compliance/obligations
     → what this farm owes, when, and whether the evidence exists

GET  /v1/farms/{farmId}/reports/bcea-employment-records?from=&to=
     → 202 { jobId }                      # 🇿🇦 the inspector-at-the-gate report (US-023)
```

Everything here is async because PDF generation over 23 employees × 3 years is not a request-response operation. `202 + jobId + poll` is the honest shape.

---

## 7. Admin

```
GET   /v1/admin/regulatory-rates?jurisdiction=ZA&code=NMW_FARM
POST  /v1/admin/regulatory-rates      # requires gazetteReference. NOT NULL means NOT NULL.
PATCH /v1/admin/regulatory-rates/{id}
```

```json
POST /v1/admin/regulatory-rates
{
  "jurisdiction": "ZA",
  "code": "NMW_FARM",
  "value": "31.85",
  "unit": "ZAR_PER_HOUR",
  "effectiveFrom": "2027-03-01",
  "gazetteReference": "GG XXXXX, 2027-02-XX"
}
```

**This endpoint is why February is not a release.** The annual wage update is a POST, made by someone who read the Gazette, not a code change that needs a build, a test cycle, and a deploy window in the three weeks between publication and 1 March. [ADR-0005](adr/ADR-0005-regulatory-rates.md).

Rejects a POST without `gazetteReference`. Rejects an overlapping `effective_from` for the same code. Both are 422, both name the conflict.

---

## 8. Reference data

```
GET /v1/reference/chemical-products?jurisdiction=ZA&since=<version>
GET /v1/reference/veterinary-products?jurisdiction=ZA&since=<version>
GET /v1/reference/regulatory-rates?jurisdiction=ZA&since=<version>
GET /v1/reference/notifiable-diseases?jurisdiction=ZA&since=<version>
GET /v1/reference/public-holidays?jurisdiction=ZA&year=2026
```

**Jurisdiction is resolved from the farm, never from a query parameter the client chose.** The parameter above documents the shape; the server derives it from `farm.jurisdiction` and ignores a client that asks for someone else's law.

Versioned and cacheable. These also sync to the device (read-only) because **the PHI and withdrawal checks must work in the crush with no signal** (US-032, UC-010). This is the API for bulk refresh; the sync path keeps it current.

---

## 9. Integrations

```
POST /v1/farms/{farmId}/integrations/studbook/import   → 202 { jobId }
POST /v1/farms/{farmId}/integrations/swiftvee/listings  → 201
GET  /v1/farms/{farmId}/integrations/weather?days=7
POST /v1/farms/{farmId}/exports/accounting              → 202 { jobId }
POST /v1/farms/{farmId}/exports/full                    → 202 { jobId }   # POPIA s23
```

All async, all optional. If SwiftVEE is down, the farm still works — that is the constraint in [architecture.md §2](architecture.md).

---

## 10. Rate limits

| Scope | Limit |
|---|---|
| Per user | 100 req/min |
| Per farm | 1,000 req/min |
| Auth endpoints | 10 req/min per IP |
| **Sync write** | 10,000 writes/min per farm |
| Report/pack generation | 10 concurrent jobs per farm |

`429` returns `Retry-After`. The sync write limit is deliberately generous — a device returning after a month offline with 4,000 queued records is a *success case*, not an attack, and rate-limiting it into failure would be a self-inflicted wound.

---

## 11. Versioning

`/v1` in the path. Additive changes ship without a version bump. A breaking change means `/v2` running alongside `/v1` for **12 months minimum**, because an offline client may be weeks behind and a farmer who opens the app after harvest must not find it broken.

The client sends `X-Werf-Client-Version`. The server refuses clients below a floor with a 426 and an upgrade instruction — but that floor moves slowly, and never mid-season.
