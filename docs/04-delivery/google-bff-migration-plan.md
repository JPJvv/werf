# Google OIDC and cookie-BFF migration plan

**Status:** Active implementation plan | **Date:** 2026-08-15 | **Authority:**
[ADR-0011](../03-architecture/adr/ADR-0011-google-first-bff-authentication.md)

This document turns ADR-0011's accepted direction into independently deployable slices. It makes no
new product decision and may not weaken the ADR. In particular, Google identity never grants a
farm role, an email match never links a live account, and an authentication migration never clears
offline work.

## 1. Baseline and destination

### Implemented baseline

- The rotating 30-day Werf session credential is an opaque value stored as a hash server-side and
  delivered only in the hardened session cookie. It is absent from JSON and durable browser
  storage.
- The SPA still receives a 15-minute Werf JWT and holds it in React memory. Domain API clients,
  deferred uploads and the PowerSync credential exchange still depend on that bearer token.
- Registration and primary login are password-first. Passkeys are currently second factors:
  registration and authentication use `userVerification: preferred`, so existing credentials must
  not be silently treated as user-verified passwordless credentials.
- The API has no Google identity store, OIDC transaction store, cookie-authenticated domain guard,
  CSRF control or global auth audit. The farm-scoped conflict audit cannot represent account-global
  identity events.
- A non-secret identity/farm projection opens the local app offline. Losing online authority holds
  pending writes and attachments; it does not delete them or the local database.

### Destination

- Google authorization-code OIDC with PKCE is the normal connected entry. NestJS owns discovery,
  state, nonce, code exchange and token validation. No Google token enters browser JavaScript.
- The browser authenticates Werf API calls with only `__Host-werf-session`. The SPA has no Werf
  access JWT. State-changing calls require an exact allowed Origin and a session-bound CSRF header.
- PowerSync still receives its own short-lived, audience-limited token. The cookie authenticates a
  call to `/api/sync/token`; only that returned connection token enters the sync runtime, in memory.
- Passkeys have a separately proven user-verified alternative-login/recovery ceremony. TOTP and
  recovery codes remain transitional fallbacks; SMS remains absent.
- Existing password accounts keep working until that specific account has a verified Google link
  or a user-verified passkey recovery route. No calendar date or deployment may strand an account.

## 2. Invariants every slice must preserve

1. **Identity is not authorization.** An `(issuer, subject)` proves a person controls one Google
   identity. Farm membership, role and active farm still come from Werf and RLS.
2. **No email-equality linking.** A live Werf account is linked only from its authenticated security
   settings after phishing-resistant step-up. A callback never selects a live user by email.
3. **A pending invitation shell is not a live identity.** A verified Google address may claim an
   undeleted shell only when it has no password and no provider identity; invitations remain
   pending until separately accepted. This policy is explicit and tested, not a generic email
   merge.
4. **No credential in durable browser storage.** Google tokens, Werf session cookies, Werf JWTs,
   PowerSync tokens, OIDC state and PKCE verifiers never enter localStorage, IndexedDB, SQLite,
   OPFS, a service-worker cache, logs or URLs (except the protocol-required opaque `state` and
   authorization `code` on the callback).
5. **Offline work survives every auth outcome.** Logout, expiry, provider outage, link conflict,
   CSRF failure and rollback may disconnect sync and hold the outbox; none may clear SQLite, OPFS,
   drafts, blobs or refused captures.
6. **Existing clients remain valid through cutover.** Bearer and cookie contracts overlap. Removal
   happens only after the compatibility window and evidence gate below.
7. **Sensitive identity changes are proved and recorded.** Link, unlink, recovery-route changes and
   factor changes require recent phishing-resistant step-up and an immutable account-global audit
   event. P3.11's recent-login check alone is not sufficient proof of the authentication method.
8. **Google is an offshore recipient of account-login data.** The privacy notice, vendor/operator
   register and s72 analysis must name the identity flow before it is enabled. Werf sends only the
   OIDC fields needed for authentication and requests no unrelated Google API scopes.

## 3. Server-owned state

Names below describe the contract; the schema migration remains the implementation slice.

### Provider identities

`user_identities` is server-only and account-global:

- `id`, `user_id`, `provider`, exact `issuer`, opaque `subject`;
- `email_at_link` and `email_verified_at_link` as evidence, not as the lookup key;
- `linked_at`, `last_used_at`, `deleted_at`;
- a permanent uniqueness constraint on `(issuer, subject)`, including tombstones, so a revoked
  identity cannot later move silently to another Werf user.

Re-linking a tombstoned identity may revive it only for the same Werf user after the normal
step-up flow. The Google email does not overwrite `users.email` automatically.

### OIDC transactions

`oidc_transactions` is server-only, short-lived and single-use:

- hash of CSPRNG `state`, encrypted nonce and PKCE verifier;
- intent: `login`, `link` or `onboard`;
- allowlisted internal return path;
- nullable initiating `user_id` and `session_family_id` for link intent;
- expiry, consumed time and created time.

The callback does not depend on the Werf cookie: `SameSite=Strict` correctly withholds it on the
cross-site return from Google. The server resolves the transaction by `state`, validates every OIDC
property, and for a link re-checks that the bound Werf session family is still live before writing.
Expired, consumed, wrong-issuer, wrong-audience, wrong-nonce, wrong-PKCE and unverified-email
callbacks all fail closed and produce no identity or session.

Werf does **not** retain Google access or refresh tokens in the first implementation because login
does not need them. If a future Google API feature creates a real need, provider credentials get a
separate encrypted store and a new review; they are not added speculatively to this migration.

### Authentication evidence and audit

- Sessions record the method that established them and the method/time of the latest step-up. A
  passkey assertion used for linking requires `userVerification: required`; password, TOTP and
  recovery-code login do not masquerade as phishing-resistant proof.
- `auth_audit_log` is account-global, append-only, unavailable to `werf_app`, and has database-level
  UPDATE/DELETE revocation. It records event, actor/target user, session family, provider/issuer,
  outcome and bounded request metadata without tokens, codes, email contents or OIDC claims.
- The auth audit is a prerequisite for enabling linking, not a follow-up hidden behind a feature
  flag. P3.16 owns the shared audit implementation and grant tightening.

## 4. HTTP contracts at the destination

The existing password/2FA routes remain compatibility routes during migration. Route names below
are relative to the API prefix; this plan does not decide the separate external version-prefix
drift tracked for the documentation-reconciliation slice.

| Route | Purpose and protection |
|---|---|
| `GET /auth/google` | Creates a `login` or `onboard` transaction and redirects to Google. Only an allowlisted internal `returnTo` is accepted |
| `GET /auth/google/callback` | Consumes the OIDC transaction, validates the response, and issues a full Werf cookie only when FR-014 is already satisfied; otherwise it returns the existing Werf second-factor/enrolment journey. It then redirects without provider parameters |
| `POST /auth/google/link` | Requires a live Werf session, recent user-verified passkey step-up, Origin and CSRF; creates a link transaction and returns/redirects to its authorization URL |
| `DELETE /auth/google/link/:identityId` | Same controls; refuses removal of the last proven recovery/login route |
| `GET /auth/session` | Cookie-authenticated, `no-store`; returns the browser-safe identity/farm projection and a session-bound CSRF token, never a bearer token |
| `POST /auth/session/refresh` | Rotates the opaque cookie without returning it in JSON; does not refresh authentication/step-up time |
| `POST /auth/passkey/login/options` and `/verify` | User-verified alternative login/recovery, separated from today's password-following second-factor ceremony |
| `POST /sync/token` | Cookie-authenticated; returns only the short-lived PowerSync audience token to its runtime |

Cookie authentication resolves the opaque token hash to the same live `user_sessions` authority the
bearer guard checks today. It does not rotate the cookie on every domain request. Mutation requests
then require both:

- an exact production Origin from a closed allowlist (missing/null/wrong Origin rejected); and
- `X-Werf-CSRF`, a short-lived HMAC bound to the current session row and returned by
  `GET /auth/session`.

The CSRF value is not authentication and does not defend against same-origin XSS; CSP, output
encoding and dependency controls remain required. OIDC callbacks use single-use state/nonce/PKCE
rather than the mutation header.

## 5. Deployable slices

Each row is one independently verified change. A later row may not be bundled into an earlier one
to make a demo look complete.

| Slice | Change | Exit gate | Safe rollback |
|---|---|---|---|
| **A — identity foundation** | Add provider-identity/OIDC-transaction schema, production-required Google configuration, transaction cleanup, session authentication-method evidence and account-global auth audit. Feature remains disabled | Real-Postgres uniqueness, RLS/grant, expiry, immutability and secret-redaction tests; bad production config refuses boot | Disable flag; additive tables remain inert |
| **B — explicit linking** | Add link callback and Security UI. Require a recent user-verified passkey assertion. Never accept password/TOTP/recovery as the link step-up | Wrong user/session/state/issuer/audience/nonce/PKCE/email-collision tests all write nothing; link/unlink audited; last-route removal refused | Disable link entry; existing passwords and sessions unchanged |
| **C — linked Google login** | Permit Google login only when `(issuer, subject)` is already linked. Issue the existing Werf session, apply the same FR-014 second-factor policy, and resolve farms through normal server/RLS paths | A Google claim cannot create membership, choose a role, satisfy Werf's required second factor or switch user by email; provider outage leaves cached offline data open | Hide Google entry; password/passkey routes remain |
| **D — user-verified passkey recovery and Google onboarding** | Add first-factor passkey ceremony with required user verification. Add passwordless Google onboarding and the narrow invitation-shell claim policy. Stop offering password creation to new accounts only after both journeys pass | Existing second-factor credentials are not auto-promoted; Google-only owner can recover with a proven passkey; onboarding is one tenant transaction; live email collision never links | Disable new onboarding; already-created users retain Google/passkey login; never delete their tenant |
| **E — dual BFF transport** | Centralise browser API transport; add cookie auth plus Origin/CSRF to all state changes; migrate auth/settings, server-authoritative APIs, outbox/uploads, evidence downloads, then PowerSync token minting. Bearer auth remains accepted | Every mutation has CSRF negatives; tenancy suite passes through cookie path; expired auth holds outbox/blob; two-browser real-stack sync passes; no token appears in durable storage | Route new client back to bearer transport; cookie and bearer map to the same session/user |
| **F — remove SPA bearer contract** | New session response omits `accessToken`; remove token parameters/state and bearer injection from the web app. Keep server bearer compatibility for old installed clients | At least the 30-day offline window plus two releases has elapsed; telemetry shows no supported client needs the old contract; an old PWA can reconnect, flush and upgrade without data loss | Re-enable access-token response while bearer verifier still exists |
| **G — retire individual passwords and harden operations** | Mark migration complete per account only after verified Google/passkey recovery. Later remove password hashes through an explicit audited job. Add distributed limits/WAF, key rotation, alerting and independent test | No account loses its final login route; outage/recovery drill passes; security ledger and privacy/operator records are closed | Stop retirement job; hashes not yet removed remain valid compatibility routes |

### Required ordering inside slice E

1. Introduce one web transport adapter that always sends same-origin credentials and can supply the
   CSRF header. Screens stop owning bearer-header construction.
2. Add dual-mode server authentication. Cookie and bearer resolve the same session and produce the
   same `AuthContext`; cookie does not create a second authorization system.
3. Convert low-risk reads, then ordinary mutations, then the deferred outbox/attachment pipeline.
   A 401/403 continues to hold the item exactly as today.
4. Convert `/sync/token`. PowerSync never receives the Werf cookie and never stores its audience
   token outside the active connection.
5. Prove the full real-stack/two-browser path before changing the browser session schema.

Rotating a cookie while multiple tabs are active must not make an honest overlap look like theft.
The server keeps reuse detection, but a just-rotated predecessor receives a bounded retry response
without a second successor or family revocation; replay outside that small overlap still revokes the
family. Multi-tab and lost-response tests must fail against the current immediate-revocation race
before this behavior changes.

## 6. Compatibility and rollout gates

- **Flags are server-side and monotonic by cohort:** link, linked-login, onboarding and cookie-BFF
  are enabled separately. Disabling a flag removes an entry point; it never deletes identity,
  session, tenant or queue data.
- **Old PWA contract:** existing `/auth/login`, `/auth/refresh` and bearer verification remain until
  slice F's window closes. The new cookie-only client uses `/auth/session`; one response shape is not
  changed underneath an installed service worker.
- **Account state, not a deadline, retires passwords:** `password_hash IS NOT NULL` remains usable
  until that user has a verified alternative. A global “migration complete” flag is insufficient.
- **Provider outage:** authenticated/offline users open local data normally. Connected Google login
  may state that the provider cannot be reached; it never clears cached identity or work. Existing
  password users retain their compatibility route, and migrated users have the user-verified
  passkey recovery route required by slice D.
- **No redirect freedom:** deployment configuration contains exact callback URIs; request
  `returnTo` values are internal paths selected from an allowlist, never arbitrary URLs.
- **No silent account merge:** a Google subject already bound to one user, a live Werf account with
  the same email, and a soft-deleted user are three explicit conflicts with generic browser copy and
  detailed server audit—not branches that pick a winner.

## 7. Verification matrix

Every implementation slice keeps `pnpm verify` green and adds the relevant rows below before its
flag can be enabled.

| Boundary | Required evidence |
|---|---|
| OIDC protocol | Real callback-handler tests for state single-use, nonce, PKCE, issuer, audience, signature/key rotation, redirect URI and token time claims; provider HTTP may be a standards-shaped local test issuer, but Werf database/session code is never mocked |
| Linking | Real-Postgres cross-user, duplicate-subject, tombstone, stale-session and non-passkey-step-up negatives; immutable audit assertions |
| Authorization | Existing API/RLS tenancy tests rerun through Google-issued sessions and cookie auth; Google claims cannot supply farm/role/admin values |
| CSRF | Exact-Origin and token matrix for every mutation controller; GET/session and OIDC callback exceptions named, not wildcarded |
| Browser storage | Browser test inspects localStorage, IndexedDB, SQLite, OPFS, Cache Storage, URLs and rendered diagnostics for Google/Werf/PowerSync credentials |
| Offline safety | Expire/revoke/unlink during queued captures and attachment upload; data remains local, reconnect after login sends exactly once |
| Compatibility | Old bearer PWA and new cookie PWA operate against the same deploy; refresh overlap across two tabs does not revoke an honest family |
| Real stack | Google-linked login fixture → cookie API → outbox upload → Postgres → PowerSync token → second browser hydration, including membership revocation |
| Operations | Provider outage, signing-key rotation, client-secret rotation, OIDC transaction sweep, WAF/limiter failure and auth-audit incident query drills |

## 8. External and release gates

Implementation can begin without production credentials by using a local standards-shaped issuer.
Enabling Google outside development requires all of the following:

- owner-supplied Google Cloud client configuration and exact approved redirect origins;
- Secrets Manager custody for the client secret and any auth-encryption key, in the production
  deployment region;
- updated account privacy notice, operator/subprocessor register and documented POPIA s72 ground
  for the Google identity exchange;
- deployed TLS/HSTS/CSP/Origin behavior verified at the edge, not inferred from source;
- distributed abuse controls and auth alerting before public onboarding;
- independent security testing before pilot, as ADR-0011 and NFR-214 require.

This plan is complete when it is executable, not when Google buttons exist. The terminal proof is a
Google-only new owner with a user-verified passkey recovery route whose cookie-authenticated queued
capture survives expiry and appears on a second device—while an old password client remains able to
flush during the compatibility window.
