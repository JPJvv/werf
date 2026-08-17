/**
 * Immutable, server-only authentication evidence.
 *
 * Authentication events do not fit the conflict-only `audit_log`: a failed login can happen
 * before a user or farm is known, and a session belongs to a person rather than one tenant.
 * This separate log keeps those facts honest instead of inventing a farm/record id. It has no
 * update/delete/soft-delete columns because rewriting security history defeats its purpose.
 */

import { bigserial, index, inet, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { farms, users } from './core';

const tz = (name: string) => timestamp(name, { withTimezone: true });

export const authAuditLog = pgTable(
  'auth_audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    event: text('event').notNull(),
    outcome: text('outcome').notNull(),
    /** The authenticated person who performed the action, when one is known. */
    actorUserId: uuid('actor_user_id').references(() => users.id),
    /** The account affected by the event; for a login this is the account being opened. */
    subjectUserId: uuid('subject_user_id').references(() => users.id),
    /** Nullable because unknown-account login failures and account-wide events have no farm. */
    farmId: uuid('farm_id').references(() => farms.id),
    /** Deliberately not an FK: expired credential rows may be purged before their evidence. */
    sessionId: uuid('session_id'),
    /** Stable across refresh rotation; also not an FK because credential rows are purgeable. */
    sessionFamilyId: uuid('session_family_id'),
    sourceIp: inet('source_ip'),
    userAgent: text('user_agent'),
    /** Controlled, non-secret context only. Never request bodies, email addresses, or tokens. */
    metadata: jsonb('metadata').notNull().default({}),
    occurredAt: tz('occurred_at').notNull().defaultNow(),
  },
  (t) => [
    index('auth_audit_log_actor_occurred_idx').on(t.actorUserId, t.occurredAt),
    index('auth_audit_log_subject_occurred_idx').on(t.subjectUserId, t.occurredAt),
    index('auth_audit_log_farm_occurred_idx').on(t.farmId, t.occurredAt),
    index('auth_audit_log_event_occurred_idx').on(t.event, t.occurredAt),
  ],
);
