# ADR-0011 - Google-first authentication through a backend-for-frontend

**Status:** Accepted | **Date:** 2026-08-09 | **Decider:** Product owner

## Context

Werf needs low-friction modern login without placing a reusable session credential in browser
storage. It must also keep working offline after authentication, preserve unsent work when
credentials expire, enforce farm roles on the server, and never use SMS as a security factor.

ADR-0007 correctly chose passkeys/TOTP over SMS for second factors, but the implemented first
factor was password-first and the browser cached both access and rotating refresh tokens. Google
should now be the normal account entry, with Werf controlling its own session and authorization.

## Decision

### Primary sign-in

- Google OpenID Connect is the primary login for account users.
- NestJS performs authorization code flow with PKCE. It validates discovery metadata, issuer,
  audience, signature, state, nonce, redirect URI and token timing server-side.
- OAuth/provider access and refresh tokens never enter browser JavaScript and are encrypted in the
  server credential store if retained at all.
- A Google identity proves control of that identity. It does not grant a farm, membership, role or
  admin authority. Linking and every authorization check are server decisions.

### Browser session boundary

- The browser receives an opaque, host-only `__Host-werf-session` cookie in production with
  `HttpOnly`, `Secure`, `SameSite=Strict` and `Path=/`. Auth responses are `no-store`.
- The production target is a backend-for-frontend (BFF): browser API requests rely on the cookie;
  the BFF holds credentials and calls internal services. State-changing routes validate origin and
  CSRF context in addition to SameSite cookies.
- During migration only, a 15-minute Werf API access token may be returned to the SPA and retained
  in memory. It is never placed in localStorage, IndexedDB, SQLite, a service-worker cache or URL.
- The offline cache contains a non-secret identity/farm projection so local data remains usable
  without a network. It is not proof of current authorization. Pending writes are held, never
  erased, when the session expires.
- PowerSync credentials are short-lived, audience-limited and minted through the authenticated
  backend. The sync runtime holds them only for the connection that needs them.

### Factors, recovery and passwords

- Passkeys remain the phishing-resistant alternative login, step-up factor and recovery path.
- TOTP and single-use recovery codes remain transitional universal fallbacks. SMS is neither a
  credential nor a second factor.
- No new password-only registration is added. Existing password accounts remain usable until an
  explicit Google/passkey link is completed; migration must not strand a farm or discard work.
- If a password remains during migration: Argon2id; at least 15 characters for password-only use;
  allow at least 64; compromised-password blocklist; password-manager/paste support; no arbitrary
  composition or rotation rules; throttled attempts.

### Authorization and abuse controls

- Global server authentication is default-deny. Farm membership, role and platform-admin policy
  are resolved server-side and backed by RLS. Client checks only improve the interface.
- Admin, credential linking, factor enrolment/reset and other sensitive actions require recent
  phishing-resistant step-up and immutable audit events.
- Abuse protection is layered: application throttles, a shared distributed counter, account-aware
  exponential delay, edge/WAF bot controls, generic responses and alerting. IP limits alone are
  insufficient and must not permanently lock a real account.

## Consequences

- Long-lived credentials are no longer an XSS-readable localStorage prize.
- Normal sign-in has no Werf password to phish or reuse, while passkeys provide a stronger option.
- Offline access to synchronised data remains possible without treating cached identity as online
  authority.
- The API must implement Google callback/link/unlink, CSRF/origin controls, recovery, auditing and
  operational key rotation.
- Google availability cannot block an authenticated farmer from opening local data; first login
  and identity linking necessarily require a connection.

## Migration

1. Completed baseline: move the rotating credential to the hardened cookie, strip secrets from
   durable browser storage, and add application throttles.
2. Add Google OIDC callback and explicit linking for authenticated existing users. Never link on
   email equality alone without a verified, policy-approved flow.
3. Make Google primary in onboarding while retaining password migration and passkey recovery.
4. Move domain API calls behind cookie-authenticated BFF routes with CSRF/origin protection, then
   remove the in-memory access token from the SPA contract.
5. Add distributed limits/WAF, audit/alerting, key rotation and independent security testing.

## Relationship to ADR-0007

This ADR supersedes ADR-0007 only for primary login and browser session transport. ADR-0007's
passkey, TOTP, recovery, no-SMS and no-worker-biometric decisions remain active.

## Implementation plan

The independently deployable sequence, compatibility window, rollback gates and test matrix live in
[Google OIDC and cookie-BFF migration plan](../../04-delivery/google-bff-migration-plan.md). That
document executes this decision; it does not replace or weaken it.
