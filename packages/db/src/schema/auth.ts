/**
 * Server-side auth state: refresh-token sessions (ADR-0007).
 *
 * This table is the one place a live credential could be stolen in bulk, so it is
 * shaped defensively: hashes never tokens, one row per refresh token in a rotating
 * single-use chain, and a `family_id` so that replaying a already-rotated token can
 * be recognised as theft and kill the whole lineage.
 *
 * It carries NO `farm_id`, deliberately. A session belongs to a PERSON, not a farm —
 * FR-004 requires switching the active farm without re-authenticating, so a session
 * that were farm-scoped would force a re-login on every switch. `active_farm_id` is a
 * pointer the session carries, not the tenancy key. `regulatory_rates` set the
 * precedent that "every domain table carries farm_id" is a rule about DOMAIN tables.
 */

import { timestamp, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { primaryId } from './columns';
import { farms, users } from './core';

const tz = (name: string) => timestamp(name, { withTimezone: true });

/**
 * One row per issued refresh token. Rotation is single-use: redeeming a token writes
 * `rotated_at` on the old row and inserts a successor sharing its `family_id`.
 *
 * There is no `updated_at`/`deleted_at` here and that is intentional — a session is not
 * a domain record that syncs or that an auditor reconstructs. It is credential state with
 * an explicit lifecycle (`rotated_at`, `revoked_at`, `expires_at`), and expired rows are
 * safe to purge, which is the opposite of the tombstone rule's purpose.
 */
export const userSessions = pgTable(
  'user_sessions',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),

    /**
     * SHA-256 of the refresh token, hex. Not argon2id — and that is a deliberate
     * difference from `users.password_hash`. A refresh token is 256 bits of CSPRNG
     * output, so it has no guessable distribution for a slow KDF to defend; hashing
     * exists here only so a stolen database dump contains no usable token. Argon2 on
     * every refresh would buy nothing and cost a farmer battery on a bad connection.
     */
    refreshTokenHash: text('refresh_token_hash').notNull().unique(),

    /**
     * The rotation lineage. Every successor of a login shares its family. If a token
     * that has already been rotated is presented again, either the legitimate client
     * or an attacker is replaying it — we cannot tell which, so the whole family is
     * revoked and the human re-authenticates.
     */
    familyId: uuid('family_id').notNull(),

    /**
     * When the human actually proved who they were. `2FA at LOGIN, not at every refresh`
     * (ADR-0007) is enforceable only if the session remembers the login, because a
     * refresh deliberately does not re-challenge.
     */
    authenticatedAt: tz('authenticated_at').notNull().defaultNow(),

    /**
     * When the second factor was satisfied. NULL means the session is half-authenticated:
     * the password was correct but the passkey/TOTP step has not completed, and it must
     * not be honoured as a login. SMS is never what fills this in (ADR-0007).
     */
    secondFactorAt: tz('second_factor_at'),

    /**
     * The farm this session is currently looking at (FR-004). Nullable because a user is
     * a member of a farm before they pick one, and because a session outlives any one farm.
     */
    activeFarmId: uuid('active_farm_id').references(() => farms.id),

    /** 30 days by default (ADR-0007) — the offline window a farmer must survive. */
    expiresAt: tz('expires_at').notNull(),
    /** Set when this token was redeemed for its successor. Non-null ⇒ single use spent. */
    rotatedAt: tz('rotated_at'),
    /** Set when the token was killed early: logout, reuse detected, or admin revocation. */
    revokedAt: tz('revoked_at'),
    /** Why it was revoked — 'logout' | 'reuse-detected' | 'password-change' | 'revoked'. */
    revokedReason: text('revoked_reason'),

    /** "Samsung A15" — so a person can recognise and end a session they don't know. */
    deviceLabel: text('device_label'),
    lastUsedAt: tz('last_used_at'),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [index('user_sessions_user').on(t.userId), index('user_sessions_family').on(t.familyId)],
);
