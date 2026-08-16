-- Column-level GRANT/REVOKE on `users` (P3.16, docs/05-operations/security.md §10.2).
--
-- Migration 0001 granted `werf_app` SELECT/INSERT/UPDATE on the whole `users` table, with no
-- column list. Nothing exploits that today: every credential-shaped path (register, login,
-- TOTP enrolment/verification, recovery codes, passkeys) runs on the elevated connection,
-- bound to the acting user by application code — two_factor.service.ts's own header comment
-- names this exact gap. But the separation was a convention, not a grant. Through the
-- `users_self_and_comembers` RLS policy (0001), which correctly scopes ROWS to yourself and
-- farm co-members, `werf_app` could still read a co-member's encrypted TOTP seed, argon2
-- password hash or recovery-code hashes, or rewrite its own `totp_last_used_step` replay
-- guard — a single future `PATCH /me` written against `AppDb.asUser` would have exposed that,
-- and the query would look completely ordinary in review because RLS looks like the whole
-- story.
--
-- The narrowed grant keeps exactly the profile-shaped columns a farm member legitimately
-- needs to see about themselves and co-members — name, contact, locale/theme preference,
-- last-seen, soft-delete state — and drops every credential column: password_hash,
-- totp_secret_encrypted, totp_enrolled_at, totp_last_used_step, recovery_codes_hashed. Those
-- five stay reachable only from `ElevatedDb`, which is exactly where every current read or
-- write of them already lives.
REVOKE SELECT, INSERT, UPDATE ON "users" FROM werf_app;--> statement-breakpoint

GRANT SELECT (
  id, email, phone, full_name, locale, theme, last_seen_at, created_at, updated_at, deleted_at
) ON "users" TO werf_app;--> statement-breakpoint

-- No production path inserts a `users` row through `werf_app` today: registration and
-- invitation both write rows that PRECEDE the membership RLS scopes by, so they run elevated
-- by necessity, not choice (packages/db/src/client.ts). `id` is left out of this grant for
-- the same reason — every current insert either omits it (the server-side
-- `uuid_generate_v7()` default) or runs elevated, and a column with a DEFAULT needs no
-- privilege when the statement omits it. Granted on the non-credential columns anyway, so a
-- future self-service profile-creation feature does not have to touch this migration.
GRANT INSERT (
  email, phone, full_name, locale, theme, created_at, updated_at
) ON "users" TO werf_app;--> statement-breakpoint

-- `deleted_at` is deliberately not UPDATE-granted: erasing an identity is an elevated,
-- admin-shaped act today (see the "erased" fixture in farms.integration.test.ts, which writes
-- the tombstone through `elevated.db` directly), not something any scoped request path does.
GRANT UPDATE (
  full_name, locale, theme, last_seen_at, updated_at
) ON "users" TO werf_app;