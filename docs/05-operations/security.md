# Security

---

## 1. What we are actually protecting

Not "user data". Be specific, because specificity is what makes a threat model useful:

| Asset | Who is harmed if it leaks | Severity |
|---|---|---|
| **Worker ID numbers and banking details** | Farm workers — the least powerful people in this system, with the least recourse | **Critical** |
| **Worker health data** (injury-on-duty) | Same. POPIA s26 special personal information. | **Critical** |
| Payroll data | Workers (privacy), farmer (labour relations) | High |
| Animal records + GPS | **The farmer — this is a stock theft map** | High |
| Financial data | Farmer | High |
| Brand registration | Farmer — enables fraudulent ownership claims | Medium |
| Compliance records | Farmer (audit outcome) | Medium |

**The first two rows govern this document.** A farm worker whose ID number is stolen has almost no capacity to recover from it. They did not choose this software; their employer did. They cannot switch products. That asymmetry means the security bar here is set by *their* exposure, not by our customer's risk appetite.

**And note row 4.** A farm management database is a target for stock thieves in a way that a normal SaaS database is not. "Here are 4,000 cattle, their GPS positions, their camps, and when the farmer last visited" is an operationally useful document to a criminal enterprise that costs South African agriculture roughly R1.4 billion a year. This is not a hypothetical threat actor.

---

## 2. Threat model

STRIDE, scoped to what is real here.

| Threat | Vector | Control |
|---|---|---|
| **Spoofing** | Credential stuffing | Argon2id · rate limit 10/min/IP · **passkey/TOTP mandatory for owner+bookkeeper** (FR-014, §3.5) · breach-list check at registration |
| | **SIM swap** 🇿🇦 | **SMS is never a second factor.** Industrialised in SA. See §3.5 and [ADR-0007](../03-architecture/adr/ADR-0007-authentication.md). |
| | Session theft | 15-min access token · rotating single-use refresh · bind to device fingerprint |
| **Tampering** | Client forges a sync write | **Client writes route through the API** — RLS + business rules apply regardless of path ([architecture.md §3](../03-architecture/architecture.md)) |
| | Payroll manipulation | Server-authoritative · immutable audit · approval is a separate authenticated call |
| | Audit log edited | **`REVOKE UPDATE, DELETE`** at the database level (NFR-211) |
| **Repudiation** | "I didn't approve that payroll" | Audit row: user, IP, timestamp, before/after |
| **Information disclosure** | **Cross-tenant leak via sync rules** | **Three layers + the tenancy test suite** — §4 |
| | Stolen phone | Sensitive columns never sync (NFR-215) · encrypted at rest · remote wipe on next connection |
| | PII in error reports | **Scrub before transmission — code, not config** (NFR-212) |
| | PII in logs | Structured logging with a deny-list; a test asserts it |
| **Denial of service** | API flood | WAF · rate limits · autoscaling |
| | **Sync flood from a returning device** | **Not an attack — a success case.** 10k writes/min/farm ([api-specification.md §10](../03-architecture/api-specification.md)) |
| **Elevation of privilege** | Worker → owner | RBAC guards + RLS + sync rules, all three |
| | SQL injection | Drizzle parameterises; raw SQL requires review |
| | Container escape | Fargate · read-only root · non-root user · no privileged |

---

## 3. The controls that carry weight

### 3.1 Encryption

| Layer | Control |
|---|---|
| Transit | TLS 1.3 minimum · HSTS preload · no TLS 1.0/1.1/1.2 |
| At rest | AES-256 — RDS, S3, EBS, all KMS-managed |
| **Column** | **ID numbers, banking: encrypted with a key separate from the DB key** (NFR-203) |
| Backups | Encrypted, af-south-1 only |
| Client | OPFS is not encrypted by the browser — **which is why sensitive columns never reach it** |

**On column encryption:** the DB key protects against a stolen snapshot. It does not protect against an application-layer bug that selects a column it shouldn't, or a support engineer with read access. A separate key, held in Secrets Manager and fetched by the API only for the two operations that need it (payslip generation, EFT export), means a leaked query result contains ciphertext.

```ts
// packages/core/crypto/pii.ts — the ONLY place this key is used
export async function encryptPii(plaintext: string): Promise<Buffer> {
  const key = await secrets.get('PII_ENCRYPTION_KEY');   // separate from DATABASE_URL
  return aes256gcm.encrypt(plaintext, key);
}

// And the rule enforced by review: nothing outside packages/domain/payroll
// and packages/domain/exports may call decryptPii().
```

### 3.2 The three-layer tenancy boundary

This is the single most important control in the system, and [architecture.md §6](../03-architecture/architecture.md) explains the mechanism. The security point:

> **PowerSync sync rules and Postgres RLS are two independent systems enforcing one invariant, and the failure mode is silent.**

A permissive sync rule replicates farm B's animals onto farm A's phone **even when every RLS policy is perfect**, because replication does not traverse the query path RLS protects. Nothing in the UI looks wrong. No error is logged. The farmer sees more animals than they own and probably assumes it is a bug in a counter.

There is no way to notice this by using the product. `packages/sync/test/tenancy.spec.ts` is the only thing that notices, which is why it is a required CI job and why it is generated from the classification table rather than hand-written per table.

### 3.5 Two-factor authentication

Full rationale: [ADR-0007](../03-architecture/adr/ADR-0007-authentication.md).

| Factor | Role | Status |
|---|---|---|
| **Passkey (WebAuthn)** | owner, bookkeeper | Preferred — phishing-resistant, nothing secret on our server |
| **TOTP (RFC 6238)** | owner, bookkeeper, manager | Universal fallback |
| **Recovery codes** | all 2FA users | 10, single-use, argon2id-hashed, shown once |
| SMS OTP | — | **Registration bootstrap only. NEVER a second factor.** |
| Worker PIN | worker | Attendance capture, not account auth |

**🇿🇦 Why SMS is not a second factor.** SIM swap fraud is industrialised in South Africa — it is the standard route into South African bank accounts, not a theoretical attack. Using SMS as the second factor on a product holding banking details, in the country where SIM swap is most developed, is choosing the one factor that is locally broken.

And the argument that makes it easy rather than merely correct: **TOTP and passkeys work with no signal. SMS does not.** TOTP is time-based — the seed is on the device, the code computes locally, it works in a camp with zero bars. SMS needs the exact thing our users lack. The insecure option is also the one that fails in the field. There is no axis on which SMS 2FA wins.

**Storage:**
- TOTP seeds: encrypted with the **PII key**, not the DB key (§3.1). Never synced.
- Passkeys: **public keys only.** A breach of `user_passkeys` gives an attacker nothing — that is the whole point of asymmetric auth, and it is why passkeys are preferred over TOTP rather than merely alongside it.
- Recovery codes: argon2id, single-use, invalidated on use.

**Support-channel reset:** identity verification + **48-hour delay** + email to every farm admin. The delay is the control. A support reset with no delay is a social-engineering hole that makes the whole scheme decorative — it is how attackers bypass 2FA at most companies.

### 3.3 Secrets

| | |
|---|---|
| Storage | AWS Secrets Manager, af-south-1 |
| Rotation | DB credentials 90d automatic · PII key annual, manual, with re-encryption |
| CI | **OIDC assumed role. No long-lived AWS keys in GitHub.** |
| Local | `.env.local`, gitignored, **never committed** |
| Detection | `gitleaks` in CI + pre-commit hook |
| Claude Code | **`Read(./.env)` and `Read(./infra/secrets/**)` denied in `.claude/settings.json`** |

That last row matters more than it looks. Claude Code reads files to understand the codebase, and a `.env` in context is a secret in a transcript. The deny rule is in the Phase 0 checklist.

### 3.4 Data residency

Everything containing personal information is in **af-south-1**. See [ADR-0002](../03-architecture/adr/ADR-0002-data-residency.md) — and note that this is a **risk decision, not a POPIA mandate**. Section 72 permits transborder flows on established grounds; we host locally because it removes s72 from our customers' compliance surface, not because the law forces us.

**Where data does leave, and what that requires:**

| Destination | Contains | Control |
|---|---|---|
| CloudFront (global) | Static assets only | No personal data, **by construction** |
| Sentry (offshore) | Error traces | **PII scrubbed before transmission** — NFR-212 |
| Email provider | Addresses, names | s72 ground: necessary for contract performance |
| Any future AI feature | TBD | **Scrub, or establish a s72 ground, or process locally. No fourth option.** |

```ts
// apps/web/src/monitoring/sentry.ts
Sentry.init({
  beforeSend(event) {
    // ⭐ This is a code requirement (NFR-212), not a dashboard toggle.
    // A toggle can be flipped by someone who doesn't know why it's there.
    return scrubPii(event, {
      dropKeys: ['idNumber','id_number','bankAccount','password','token',
                 'fullName','phone','email','gps','location'],
      dropPatterns: [/\b\d{13}\b/],   // SA ID number shape
    });
  },
});
```

A test asserts that an event containing a 13-digit number never leaves. It runs in CI.

---

## 4. OWASP Top 10

| | Control |
|---|---|
| A01 Broken access control | Three layers (§3.2) · tenancy suite · `FORCE ROW LEVEL SECURITY` |
| A02 Cryptographic failures | §3.1 · TLS 1.3 · Argon2id · column encryption |
| A03 Injection | Drizzle parameterised · Zod on every boundary · raw SQL needs review |
| A04 Insecure design | This document · ADRs · pen test at Phase 5 |
| A05 Misconfiguration | Terraform · no console changes · `terraform plan` in CI |
| A06 Vulnerable components | `pnpm audit` blocks on critical · Dependabot |
| A07 Auth failures | Rate limits · TOTP · rotating refresh · breach-list check |
| A08 Integrity failures | Signed images · `--frozen-lockfile` · SLSA provenance (Phase 6) |
| A09 Logging failures | Structured logs · audit log · **PII deny-list, tested** |
| A10 SSRF | No user-supplied URLs fetched server-side. If this changes, allowlist. |

---

## 5. POPIA-specific obligations

Detail in [legal-compliance.md](../00-business/legal-compliance.md). The security-relevant ones:

| Section | Obligation | Implementation |
|---|---|---|
| s19 | Appropriate technical and organisational measures | This document |
| s21 | **Written contract with every operator** | DPA — **a launch blocker, not a nice-to-have** |
| s22 | **Breach notification to the Regulator and each data subject** | §7 · pre-drafted template · ability to identify affected subjects fast |
| s26 | Special personal information | **No biometrics in v1** · health data role-restricted · **no suspect field** |
| s72 | Transborder flows | §3.4 |

**On s22 and "identify affected data subjects fast":** this is an engineering requirement hiding in a legal clause. When a breach happens, we have hours to answer "whose data?" — and if that answer requires a bespoke query written under pressure at 2am, we will get it wrong. Build the query in Phase 5. Test it in the restore drill.

---

## 6. Claude Code guardrails

```json
{
  "permissions": {
    "deny": [
      "Read(./.env)",
      "Read(./.env.*)",
      "Read(./infra/secrets/**)",
      "Bash(rm -rf *)",
      "Bash(git push --force*)",
      "Edit(./packages/db/migrations/**)"
    ]
  }
}
```

| Rule | Why |
|---|---|
| No `.env` reads | A secret in context is a secret in a transcript |
| No force push | History is evidence |
| **No editing applied migrations** | Schema drift that surfaces three weeks later as an inexplicable production error |
| No `rm -rf` | Obvious |

And a rule that is not enforceable in config, only in review: **Claude Code must never be given production credentials.** Staging, seeded data, preview environments — yes. Production database URL — no. There is no task in this roadmap that requires it.

---

## 7. Incident response

Full runbook: [maintenance-runbook.md](../05-operations/maintenance-runbook.md). The security shape:

```
DETECT ──▶ CONTAIN ──▶ ASSESS ──▶ NOTIFY ──▶ RECOVER ──▶ LEARN
  ▲                                  │
  └── alerting, §Monitoring          └── POPIA s22: Regulator + each data subject
                                          "as soon as reasonably possible"
```

| Step | Timebox | Owner |
|---|---|---|
| Detect | Alerting (NFR-704) | On-call |
| Contain | 1h — revoke, isolate, rotate | On-call |
| Assess | 24h — what, whose, how much | Tech lead |
| **Decide on notification** | **72h** (NFR-605) | Tech lead + legal |
| **Notify** | POPIA s22 timing | Tech lead |
| Recover | Per severity | On-call |
| Post-mortem | 5 days, blameless, written | Tech lead |

**The s22 notification is not optional and it is not discretionary based on how bad it looks.** Where there are reasonable grounds to believe personal information was accessed by an unauthorised person, the Regulator and each affected data subject are notified. Notification to the data subject must be in writing and describe the possible consequences and what we intend to do.

For a farm worker, "in writing" means **in a language they read**, delivered somehow — and their contact details may be their employer's records. Work this out in Phase 5, not during the incident.

---

## 8. Pre-launch security gate

Phase 5. Every line must be true.

```
✓ External penetration test: 0 critical, 0 high
✓ Tenancy suite green, per table, generated from the classification
✓ PII scrubbing verified — an event with a 13-digit number never leaves SA
✓ Column encryption verified — ID numbers are ciphertext in a raw dump
✓ Sensitive columns absent from a device's OPFS database (NFR-215)
✓ Audit log UPDATE/DELETE grants revoked, asserted by test
✓ Secrets: zero in git history (gitleaks --log-opts=--all)
✓ TLS: SSL Labs A+
✓ CSP: no unsafe-inline, no unsafe-eval
✓ Rate limits verified under load
✓ 2FA enforced for owner + bookkeeper; recovery codes tested; 48h reset delay verified
✓ Passkey table contains public keys only — verified by inspection of a raw dump
✓ TOTP seeds encrypted with the PII key, not the DB key
✓ Operator DPA signed with every sub-processor
✓ Breach runbook rehearsed, including the "whose data?" query
✓ PAIA manual published
```

**The rehearsal matters.** A breach runbook that has never been executed is a document, not a capability. Run it against staging with a fabricated incident, time it, and find out that the "identify affected data subjects" query takes forty minutes — before it matters.

---

## 9. What we have accepted

Honest list. Every one is a decision, not an oversight.

| Accepted risk | Why | Revisit |
|---|---|---|
| OPFS is unencrypted by the browser | No portable API for it | Mitigated: sensitive columns never sync |
| 30-day offline session | A farmer offline for 3 weeks must not be locked out of their own data | If device theft becomes a real pattern |
| No biometric attendance | Consent obtained from a farm worker by their employer is of questionable voluntariness | Full DPIA + a genuine non-biometric alternative first |
| Sentry is offshore | No credible SA-hosted equivalent | Self-host GlitchTip if scrubbing proves insufficient |
| No SOC 2 | Cost, and no customer asks | When an enterprise customer asks |
| No bug bounty | Team size | Post-launch, when there is someone to triage |

The 30-day session is the one that looks worst on paper and is right anyway. The alternative — locking a farmer out of their own offline data because a token expired while they were working — is a worse outcome than the risk it prevents, and it is the exact failure mode that makes people go back to paper.

---

## 10. Phase 1 security notes (auth & tenancy implementation)

A running record of what the auth work actually changed, and what it has NOT yet done. Read §10.2 before treating auth as finished — several controls this document describes as if they exist are still open.

### 10.1 Controls now implemented

**The elevated-connection inventory.** `@werf/db` exposes two connections as two distinct *types* (`packages/db/src/client.ts`). `AppDb` connects as `werf_app` and has no method that runs a query outside `asUser()`, so an unscoped query is not expressible through it; the `app.user_id` GUC is set with `is_local = true`, bound to the transaction, so a pooled connection can never hand the next request the previous user's tenancy.

`ElevatedDb` bypasses RLS. **Every current use, exhaustively** — this list is the thing to re-audit whenever it grows:

| Operation | Why elevation is unavoidable |
|---|---|
| `AuthService.register` | Business, farm and owner rows precede the membership RLS scopes by |
| `FarmsService.createFarm` | New farm has no members yet; would fail its own `WITH CHECK` |
| `FarmsService.invite` / `acceptInvitation` | Invitee's user row and membership do not exist yet |
| `SessionService.*` | `user_sessions` is unreachable from `werf_app` by design; refresh must find a session *before* it knows whose it is |
| `AuthService.login` | Must read a user row by email before any identity is established |

`createFarm` and `invite` both authorise the caller through the **RLS-bound** path first, so the elevated write is only ever reached by someone RLS already agreed is an owner. That ordering is the control; reversing it would be a silent privilege escalation.

**`user_sessions` is doubly unreachable from the request path.** RLS is `ENABLE`d and `FORCE`d with *zero policies*, and `werf_app` is granted nothing (`migrations/0003`). Either lock alone would suffice; both exist so that a future stray `GRANT` is not the difference between a leak and no leak. `@werf/sync` classifies it `server-only`, so sync and RLS agree by both saying "never".

**Refresh-token rotation with family reuse detection.** Single-use; replaying a spent token revokes the entire lineage. The revocation is deliberately committed *outside* the transaction that rejects the request — issuing it inside means the rollback silently undoes it and the stolen family keeps working. This was a real bug, caught by its own test.

**Half-authenticated sessions cannot act.** A session whose `second_factor_at` is null is rejected by both `SessionService.rotate` and `findLive`, so the login challenge token can only be spent at the 2FA step. Without this, the challenge token (which *is* a refresh token) could be presented to `/auth/refresh` for a full access token — ADR-0007's "2FA at login" would have been decorative.

**The guard fails closed.** `AuthGuard` is registered as `APP_GUARD`, so a newly added controller defaults to *denied* and reaching the public routes takes a deliberate `@Public()`. It re-reads the session on every request rather than trusting the token alone, so a logout or a reuse-revocation takes effect immediately instead of surviving for the remainder of a 15-minute access token; and it asserts `session.userId === claims.sub`, so the JWT signature is not the only lock between a forged `sub` and another tenant's data.

**Invitations require consent (`migrations/0004`).** An invitation writes a *pending* membership and grants nothing until accepted. Two predicates enforce this and **both are required**: `app_user_farm_ids()` ignores pending rows, *and* the co-member arm of the `users_self_and_comembers` policy requires `accepted_at IS NOT NULL`. Fixing only the first leaves the disclosure fully open — an owner naming any email address would still read that person's name, phone, locale and `last_seen_at`, and sync it to their device, because `users` is farm-scoped. POPIA makes an owner's unilateral choice of whose PII to acquire our problem.

**Account-enumeration resistance.** Login answers an unknown address exactly as it answers a wrong password — same error type, same message, and the same cost, because an unknown address still pays for an argon2 verification against a dummy hash computed at runtime from random bytes. `invite` likewise answers identically whether or not the address already had an account.

**Credential storage.** Passwords: argon2id at OWASP's 19 MiB / t=2 / p=1 baseline. Refresh tokens: 256 bits of CSPRNG output stored as SHA-256 — deliberately *not* a slow KDF, because full-entropy input has no guessing attack to slow down and this runs on every refresh from a phone on a weak connection.

### 10.2 Open — NOT yet implemented, and load-bearing

> These are gaps, not accepted risks. None may survive to the Phase 5 gate (§8).

| Gap | Consequence today | Where it lands |
|---|---|---|
| **2FA is not enforced.** `login` marks every session second-factor-satisfied because nothing enrols TOTP yet | The whole of §3.5 is currently aspirational. Mandatory-for-owner/bookkeeper is not implemented | 2FA slice (Task #8) |
| **No rate limiting** on login, refresh, or register | Online password guessing is unthrottled; argon2's cost is the only brake, and register is a trivial resource-exhaustion vector | Before any deployment reachable from the internet |
| **No auth audit log.** Logins, failures, farm switches, invitations and reuse-detected revocations write no audit row | A breach cannot be reconstructed, and §7's "whose data?" query has nothing to read. `.claude/rules/db.md` requires an audit row for every conflict resolution; auth events deserve the same | With the audit-log table |
| **No `helmet`, no CORS policy, no CSP** on the API | Default Express headers | Before deployment |
| **TOTP seeds are not yet encrypted with the PII key** — the column exists, nothing writes it | §3.5's storage claim is not yet true | 2FA slice |
| **Invitation delivery does not exist.** Acceptance is API-only; no email/SMS is sent | An invited person has no way to learn they were invited | Client onboarding slice |
| **JWT signing is a single HS256 secret** with no rotation story | Key rotation requires invalidating every live access token | Before launch |
| **`AuthContext.activeFarmId` is advisory**, not re-checked against membership at guard time | Safe today because every `FarmsService` method re-checks membership under RLS. It *looks* authoritative, and the next feature to trust it introduces a hole | Intersect with `app_user_farm_ids()` at the guard, or rename it |

### 10.3 Deployment note

The elevated connection needs a role that genuinely bypasses RLS. Because `user_sessions` and every domain table use `FORCE ROW LEVEL SECURITY`, table *ownership* is not enough — the role must be `BYPASSRLS` or superuser. `DATABASE_URL` must name `werf_app` and **must not** be the same role as `DATABASE_ELEVATED_URL`: pointing both at a superuser silently disables every RLS policy in the database, and nothing about the system looks broken while it happens.
