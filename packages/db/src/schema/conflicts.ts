/**
 * Server-only conflict evidence and its human review queue (US-040 / SRS-8 / SRS-9).
 *
 * `audit_log` is immutable: it explains which facts disagreed, which deterministic rule was
 * applied, and which fact won. It deliberately has no update/delete/soft-delete columns because
 * changing the explanation would defeat the record's purpose. Migration 0026 enforces that at
 * the grant and trigger levels.
 *
 * `conflict_reviews` is operational state. A reviewer may close an item, but never removes either
 * underlying event or its audit row. It therefore follows the ordinary UUIDv7, timestamp and
 * soft-delete rules while remaining server-only (device/auth telemetry must not sync).
 */

import { sql } from 'drizzle-orm';
import {
  bigserial,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { auditColumns, primaryId } from './columns';
import { farms, users } from './core';

const tz = (name: string) => timestamp(name, { withTimezone: true });

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    farmId: uuid('farm_id')
      .notNull()
      .references(() => farms.id),
    userId: uuid('user_id').references(() => users.id),
    sourceSessionId: uuid('source_session_id'),
    tableName: text('table_name').notNull(),
    recordId: uuid('record_id').notNull(),
    action: text('action').notNull(),
    rule: text('rule').notNull(),
    /** Stable, order-independent identity; retries cannot create a second explanation. */
    conflictKey: text('conflict_key').notNull(),
    /** Both immutable facts, including actor/device/occurred-at metadata. */
    facts: jsonb('facts').notNull(),
    /** The selected fact and projected value, or null for a duplicate that needs a human. */
    winner: jsonb('winner'),
    source: text('source').notNull().default('api'),
    occurredAt: tz('occurred_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('audit_log_conflict_key_unique').on(t.conflictKey),
    index('audit_log_farm_occurred_idx').on(t.farmId, t.occurredAt),
  ],
);

export const conflictReviews = pgTable(
  'conflict_reviews',
  {
    id: primaryId(),
    farmId: uuid('farm_id')
      .notNull()
      .references(() => farms.id),
    conflictKey: text('conflict_key').notNull(),
    kind: text('kind').notNull(),
    subjectId: uuid('subject_id').notNull(),
    field: text('field'),
    factAEventId: uuid('fact_a_event_id').notNull(),
    factBEventId: uuid('fact_b_event_id').notNull(),
    winnerEventId: uuid('winner_event_id'),
    rule: text('rule').notNull(),
    status: text('status').notNull().default('open'),
    reviewNote: text('review_note'),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: tz('reviewed_at'),
    ...auditColumns,
    createdBy: uuid('created_by').references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
  },
  (t) => [
    uniqueIndex('conflict_reviews_conflict_key_unique').on(t.conflictKey),
    index('conflict_reviews_farm_status_idx')
      .on(t.farmId, t.status)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);
