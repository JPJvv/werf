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
| **Spoofing** | Credential stuffing | Google/passkey target · Argon2id during migration · layered burst/account/edge throttles · **passkey/TOTP mandatory for owner+bookkeeper** (FR-014, §3.5) · compromised-password screening before password onboarding can be launchable |
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
| A04 Insecure design | This document · ADRs · pen test at Phase 7 |
| A05 Misconfiguration | Terraform · no console changes · `terraform plan` in CI |
| A06 Vulnerable components | `pnpm audit` blocks on critical · Dependabot |
| A07 Auth failures | Rate limits · TOTP · rotating refresh · breach-list check |
| A08 Integrity failures | Signed images · `--frozen-lockfile` · SLSA provenance (Phase 7) |
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

**On s22 and "identify affected data subjects fast":** this is an engineering requirement hiding in a legal clause. When a breach happens, we have hours to answer "whose data?" — and if that answer requires a bespoke query written under pressure at 2am, we will get it wrong. Build the query in Phase 6. Test it in the restore drill.

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

For a farm worker, "in writing" means **in a language they read**, delivered somehow — and their contact details may be their employer's records. Work this out in Phase 6, not during the incident.

---

## 8. Pre-launch security gate

Phase 7. Every line must be true.

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
| `TwoFactorService.*` | TOTP seeds and recovery-code hashes are credential state no request path may read; verification runs before there is a session to scope by |
| `PasskeyService.*` | Same, plus `webauthn_challenges` is granted nothing on `werf_app`; the ceremony resolves a credential before the session exists |
| `RecoveryCodeService.*` | Reads and consumes `users.recovery_codes_hashed`, which `werf_app` must never see |

`createFarm` and `invite` both authorise the caller through the **RLS-bound** path first, so the elevated write is only ever reached by someone RLS already agreed is an owner. That ordering is the control; reversing it would be a silent privilege escalation.

**`user_sessions` is doubly unreachable from the request path.** RLS is `ENABLE`d and `FORCE`d with *zero policies*, and `werf_app` is granted nothing (`migrations/0003`). Either lock alone would suffice; both exist so that a future stray `GRANT` is not the difference between a leak and no leak. `@werf/sync` classifies it `server-only`, so sync and RLS agree by both saying "never".

**Refresh-token rotation with family reuse detection.** Single-use; replaying a spent token revokes the entire lineage. The revocation is deliberately committed *outside* the transaction that rejects the request — issuing it inside means the rollback silently undoes it and the stolen family keeps working. This was a real bug, caught by its own test.

**Half-authenticated sessions cannot act.** A session whose `second_factor_at` is null is rejected by both `SessionService.rotate` and `findLive`, so the login challenge token can only be spent at the 2FA step. Without this, the challenge token (which *is* a refresh token) could be presented to `/auth/refresh` for a full access token — ADR-0007's "2FA at login" would have been decorative.

**The guard fails closed.** `AuthGuard` is registered as `APP_GUARD`, so a newly added controller defaults to *denied* and reaching the public routes takes a deliberate `@Public()`. It re-reads the session on every request rather than trusting the token alone, so a logout or a reuse-revocation takes effect immediately instead of surviving for the remainder of a 15-minute access token; and it asserts `session.userId === claims.sub`, so the JWT signature is not the only lock between a forged `sub` and another tenant's data.

**Invitations require consent (`migrations/0004`).** An invitation writes a *pending* membership and grants nothing until accepted. Two predicates enforce this and **both are required**: `app_user_farm_ids()` ignores pending rows, *and* the co-member arm of the `users_self_and_comembers` policy requires `accepted_at IS NOT NULL`. Fixing only the first leaves the disclosure fully open — an owner naming any email address would still read that person's name, phone, locale and `last_seen_at`, and sync it to their device, because `users` is farm-scoped. POPIA makes an owner's unilateral choice of whose PII to acquire our problem.

**Account-enumeration resistance — on login and `invite`, but NOT on register.** Login answers an unknown address exactly as it answers a wrong password — same error type, same message, and the same cost, because an unknown address still pays for an argon2 verification against a dummy hash computed at runtime from random bytes. `invite` likewise answers identically whether or not the address already had an account. **`register` does not**, and it is the hole in this claim: it answers 409 for an address that already has one. Tracked in §10.2; it needs email verification rather than a vaguer message, because an honest registrant genuinely has to be told.

**Membership writes are owner-only in RLS, not just in application code** (`migrations/0007`). `farm_users` is where `role` lives, so the original farm-scoped policy — `WITH CHECK (farm_id IN app_user_farm_ids())` — let *any* member of a farm, down to a worker, satisfy the check for a row naming themselves `owner`. The farm boundary held; the authority boundary inside it did not exist. Nothing exploited it, because every membership write runs elevated and authorises the caller first — which is exactly why it was worth closing: RLS is the layer that must still hold when the code above it is wrong, and one future endpoint doing a membership `UPDATE` through `AppDb.asUser` would have been a self-service promotion to owner that looked like ordinary code. Reads are deliberately unchanged, because `FarmsService` decides authorisation by reading this table through the same scoped connection, and a narrowed `USING` would turn "wrong role" into "no such farm".

**An invited address can still be registered by the person it belongs to.** `invite` writes a password-less `users` row so the pending membership has something to point at, and `users.email` is `UNIQUE`. Treating every existing row as a registration conflict meant any owner could name a stranger's address and permanently bar that person from signing up — a denial of service one API call wide, aimed at anyone, with no invitation actually delivered to explain it. Registration now *claims* a password-less, undeleted row (writing the registrant's own name over the inviter's guess) and still refuses one that has a password or a tombstone. Any pending invitation on the claimed row stays pending: this grants nothing, and acceptance remains the invitee's own act.

**Credential storage.** Passwords: argon2id at OWASP's 19 MiB / t=2 / p=1 baseline. Refresh tokens: 256 bits of CSPRNG output stored as SHA-256 — deliberately *not* a slow KDF, because full-entropy input has no guessing attack to slow down and this runs on every refresh from a phone on a weak connection.

**TOTP as the universal second factor (FR-014, ADR-0007).** RFC 6238, implemented in-house against the RFCs' published test vectors rather than taken as a dependency. SMS is not implemented and is not implementable through this path — there is no SMS method in the wire schema. The seed is encrypted with **AES-256-GCM under the PII key**, a key separate from the JWT secret and from anything the database holds, so a stolen dump yields nothing; boot refuses a configuration where the two keys are the same *material* (compared as bytes, not as strings, so base64-of-the-JWT-secret is caught too). The ciphertext is bound to its owner's user id as AAD, so a seed copied from one user row onto another fails to decrypt.

**Second factors are single-use.** A TOTP code stays valid for its whole period, and the ±1 drift window widens that to 90 seconds — ample time to replay six digits read over a shoulder. `users.totp_last_used_step` records the highest step accepted and the check **is the UPDATE's own predicate** (`WHERE totp_last_used_step IS NULL OR < $step`), not a comparison against a previously-read row. Recovery codes are removed with `array_remove` gated on the hash still being present, not by writing back a filtered copy of the array. Both were read-modify-write races when first written; both now have concurrency tests that fail against the old code.

**A challenge buys exactly one attempt.** The half-authenticated challenge is revoked *before* the submitted code is judged, so a wrong code costs the attacker the challenge and forces them back through the password. Revoking after the rejection — the obvious ordering, and what the first draft did — leaves the challenge alive and turns `/auth/2fa/verify` into an unlimited oracle on a six-digit space. Challenge sessions also expire in **5 minutes**, not the 30-day refresh window they would otherwise inherit by being the same row shape.

**Passkeys — the preferred second factor (ADR-0007).** WebAuthn via `@simplewebauthn/server`, registration and authentication both server-verified against a challenge **we** issued, the origin **we** expect and the RP ID **we** configured. Those three checks are the phishing resistance, and they are why a passkey beats TOTP: a look-alike site cannot use one. We store **public keys only** — a breach of `user_passkeys` gives an attacker nothing, which is why the credential type was chosen; the private key never leaves the phone and we could not disclose it under compulsion. `user_passkeys.deleted_at` gives FR-014c revocation, and re-enrolling a revoked-then-recovered device revives the row rather than being barred forever by the UNIQUE credential id.

Counter handling is split deliberately: **rollback** (the cloned-credential signal) is caught by the library before our code runs; our conditional `UPDATE` covers the case the library cannot see, two concurrent assertions carrying the same counter. A counter of `0` means the authenticator keeps none — normal on Apple and most Android platform authenticators, i.e. exactly the devices ADR-0007 targets — so nothing is enforced in that case rather than locking those farmers out. `userVerification` is `preferred`, not `required`: this is a *second* factor after a password, so possession of the enrolled phone is the property needed, and `required` would exclude every device with a broken sensor.

**WebAuthn challenges are server-side, single-use, and scoped to the login** (`webauthn_challenges`, migration 0006). A table rather than process memory, because the challenge is the only thing making an assertion un-replayable and that guarantee depends on the *server* remembering — in memory it breaks across API instances and evaporates on deploy, both presenting as "passkeys are flaky". Retire-and-issue runs in one transaction, and an authentication challenge is bound to the login family, not just the user: keyed by user alone, anyone holding the victim's password could retire their genuine challenge in a loop and deny them their preferred factor. RLS posture is identical to `user_sessions` — enabled, FORCEd, zero policies, `werf_app` granted nothing — and a `CHECK` stops a registration challenge being spent as an authentication one.

**Recovery codes (FR-014a).** Ten, single-use, argon2id-hashed, shown exactly once — we cannot re-display them because we do not have them. Minted by whichever factor the account enrols **first**, passkey or TOTP: a passkey-only owner whose phone drowns would otherwise have no route back at all, while the login screen offered them a recovery option that could never work. Enrolling a *second* factor returns `null` rather than a new set, so the page already in the safe keeps working. **This was only true of the passkey path until the Phase 1 audit** — `confirmTotpEnrolment` called `issue()` rather than `issueIfNone()`, so a farmer who enrolled a passkey, printed the ten codes and put them in the safe would have those codes silently retired months later by adding an authenticator app, and would discover it on the day the phone was at the bottom of a dam. Recovery codes belong to the *account*, not to whichever factor was enrolled last; both paths now agree, and an integration test pins it. Generated from an alphabet with no `0/O` or `1/I/L`, because they get printed, put in a safe, and retyped a year later under pressure; input is normalised for case, spaces and hyphens so a transcription slip does not cost someone their only way back in. Verification checks all ten hashes even after a match, so position in the array does not leak through timing.

**Mandatory enrolment is enforced server-side.** An owner or bookkeeper with no second factor gets a real session that can reach **only** the two enrolment routes and logout; every other route answers 403 `SECOND_FACTOR_ENROLMENT_REQUIRED`. It is enforced in `AuthGuard`, not in the client, because a client-side prompt is enforced by the attacker's browser. It cannot be enforced at *login* — a user with nothing enrolled has nothing to present, so refusing the login is a lockout with no exit. An unaccepted invitation cannot impose the obligation either, or naming a stranger as a farm's bookkeeper would confine their existing account.

### 10.2 Open — NOT yet implemented, and load-bearing

> These are gaps, not accepted risks. None may survive to the Phase 7 launch gate (§8). A closed
> application control remains listed when a separate edge/operational layer is still outstanding.

| Gap | Consequence today | Where it lands |
|---|---|---|
| ~~**No application rate limiting** on auth routes.~~ **PARTIALLY CLOSED 2026-08-09.** Nest global throttles and tighter login/register/refresh/2FA/WebAuthn budgets are implemented and pinned by tests | A single instance now resists bursts, but in-process counters do not coordinate replicas or survive restart. Carrier NAT also makes IP-only limits unsafe as the sole control | Before internet deployment: shared Redis-backed limits, per-account exponential delay, WAF/bot rules, alerting and an emergency tuning runbook |
| ~~**A stolen session can ADD a second factor.**~~ **CLOSED 2026-08-15.** Starting either TOTP or passkey enrolment now requires a human authentication no older than 10 minutes. Session refresh carries the original `authenticated_at`, so it cannot renew that proof; a stale caller gets 403 `STEP_UP_REQUIRED`, and the client clears the old session and performs a full login (offering the phishing-resistant passkey first when enrolled, with ADR-0011's transitional TOTP/recovery fallback) | A credential still may be added by an attacker who steals a session inside the deliberately short post-login window; this is the ordinary residual risk of recent-auth gates, not the former 30-day planting window | P3.11 closed; Google/passkey-first primary authentication remains P3.12 and immutable auth events remain P3.16 |
| **No TOTP disenrolment, and no 2FA reset path.** Re-enrolling TOTP over a live factor is refused (a stolen session must not swap the factor out), and FR-014b's support-channel reset with its 48h delay is deferred | A farmer who loses their phone **and** all ten recovery codes cannot be recovered by us at all. Passkeys can at least be revoked individually | FR-014b, later phase |
| **Nothing purges spent WebAuthn challenges.** The `expires_at` index exists; the sweep does not | Consumed rows accumulate for the life of an account and slow the per-user scan on the ceremony hot path | With the session-expiry sweep |
| **`WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN` default to localhost** rather than refusing to boot, unlike `JWT_SECRET` and `PII_ENCRYPTION_KEY` | A deploy missing them fails *closed* — the browser rejects the RP ID mismatch — so this is not a security hole, but it surfaces as "passkeys are broken in production" rather than as a boot failure | Make them required when `NODE_ENV=production` |
| **`users` grants are table-wide, not column-level** (`migrations/0001`). `werf_app` holds `SELECT, INSERT, UPDATE` on all of `users` | Nothing exploits it today — every credential path is elevated and bound to the acting user — but the app role *can* read a co-member's encrypted seed and rewrite its own `totp_last_used_step`. The separation is convention, not a grant. One future `PATCH /me` doing `set(body)` on the app connection is a self-service replay-guard reset | Column-level `GRANT`/`REVOKE` in a follow-up migration |
| **`POST /auth/register` is an account-enumeration oracle.** It answers 409 `That email address is already registered` for a real account, while login and `invite` are meticulously equalised | Anyone can test an address and learn whether that person banks with us — the exact disclosure §10.1's enumeration-resistance paragraph claims we prevent. Registration genuinely has to tell an honest user their address is taken, so the fix is email verification (answer identically, send a mail that differs), not a vaguer message | With invitation/verification delivery; rate limiting narrows it meanwhile |
| **`invite` reuses a soft-deleted user row.** The lookup filters on email only, not `deleted_at IS NULL` | An erased identity (POPIA) is pulled back into a farm as a live membership and reappears in co-member lists. The account still cannot log in — `login` filters `deleted_at` — so this is a disclosure and a data-lifecycle defect, not an access one | Filter `deleted_at` in the invite lookup; decide whether re-inviting an erased person is allowed at all |
| **No auth audit log.** Logins, failures, farm switches, invitations and reuse-detected revocations write no audit row | A breach cannot be reconstructed, and §7's "whose data?" query has nothing to read. `.claude/rules/db.md` requires an audit row for every conflict resolution; auth events deserve the same | With the audit-log table |
| ~~**No security headers or CSP.**~~ **PARTIALLY CLOSED 2026-08-09.** Helmet now protects API responses, the static PWA has a strict no-inline CSP/header baseline, and the pre-paint theme script is external. The deployment layer must reproduce and test these headers; `connect-src` must name only the exact PowerSync origin when 3b connects it | A source file is not proof that CloudFront/Cloudflare emitted the header. CSP reduces XSS impact but does not cure unsafe rendering or compromised dependencies | Header assertions in deployed-environment tests; CSP reporting and production PowerSync origin in 3b/Phase 7 |
| ~~**No client passkey enrolment.**~~ **CLOSED.** The client can enrol, authenticate with, list and revoke labelled passkeys; lost-device and last-factor states are covered by user-visible tests | Pilot adoption and recovery behaviour still need real-device evidence | Phase 7 device/pilot matrix |
| ~~**Session tokens are in `localStorage`.**~~ **CLOSED FOR THE ROTATING CREDENTIAL 2026-08-09.** Refresh/session rotation uses a host-only HttpOnly cookie; auth responses no longer expose refresh tokens; durable browser storage keeps only a non-secret offline identity/farm projection. A 15-minute access token remains in React memory during the BFF migration | This removes the long-lived XSS-readable prize, not the effect of XSS itself. Same-origin script can still act as the user and read the interim memory token | ADR-0011: CSP/headers now; complete cookie-mediated BFF plus Origin/CSRF checks before broad cookie-authenticated mutations |
| ~~**Invitation delivery does not exist.**~~ **CLOSED.** An invitation by email is now delivered through the `Mailer` port (`apps/api/src/mail`), configured by `SMTP_*` env vars. A PHONE-ONLY invitation still reaches nobody, deliberately: SMS is ruled out for the same SIM-swap reason it is ruled out as a second factor, and an invitation link is a credential-shaped thing | A phone-only invitation is handed over in person. The email is best-effort — the pending membership is the durable fact and survives a failed relay | Phone invitations need a channel decision, not a fallback to SMS |
| **JWT signing is a single HS256 secret** with no rotation story | Key rotation requires invalidating every live access token | Before launch |
| **`AuthContext.activeFarmId` is advisory**, not re-checked against membership at guard time | Safe today because every `FarmsService` method re-checks membership under RLS. It *looks* authoritative, and the next feature to trust it introduces a hole | Intersect with `app_user_farm_ids()` at the guard, or rename it |

### 10.3 Deployment note

**Outbound mail (`SMTP_*`) is OPTIONAL and off by default.** With no `SMTP_HOST` the API boots with
a logging adapter that records what it *would* have sent — which is what development and tests use,
and which is deliberate: requiring a mail server to work on livestock capture would tax every
developer, and an API that silently sent nothing would make a missing invitation impossible to
diagnose. Configure `SMTP_HOST`, `SMTP_FROM` and optionally `SMTP_PORT` (default 587), `SMTP_SECURE`
(`true` for implicit TLS on 465), `SMTP_USER` and `SMTP_PASSWORD`. It is SMTP rather than a provider
SDK so the provider stays a deployment decision — SES in af-south-1, Postmark, or a relay on the same
box — for the same data-residency reason ADR-0002 gives for not reaching for a hosted platform.
Half-configuring it (a host with no from-address) fails at boot rather than silently falling back.

Mail is **best-effort by contract**: `Mailer.send` never rejects, and no operation is rolled back
because delivery failed. An invitation's durable fact is the pending membership row.


`PII_ENCRYPTION_KEY` is now required at boot: 32 bytes, base64, and it must not be the same material as `JWT_SECRET`. Generate it with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. **Losing it makes every enrolled TOTP seed undecryptable**, which locks out every user who has no recovery codes left — back it up separately from the database, or the separation that makes a stolen dump useless also makes a lost key unrecoverable. It is deliberately not derivable from anything else in the config.

The elevated connection needs a role that genuinely bypasses RLS. Because `user_sessions` and every domain table use `FORCE ROW LEVEL SECURITY`, table *ownership* is not enough — the role must be `BYPASSRLS` or superuser. `DATABASE_URL` must name `werf_app` and **must not** be the same role as `DATABASE_ELEVATED_URL`: pointing both at a superuser silently disables every RLS policy in the database, and nothing about the system looks broken while it happens.
