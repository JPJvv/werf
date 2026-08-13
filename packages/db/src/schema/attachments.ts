/**
 * Attachment metadata (Phase 3 slice 3i, offline-sync.md § 3.1) — one shared table for animal
 * photos today and later crop/grievance documents, discriminated by `subject_type` rather than a
 * table per entity kind. `subject_id` is deliberately NOT a foreign key: it points across
 * multiple possible parent tables depending on `subject_type` (only `animals` today), and
 * Postgres has no polymorphic FK. The API validates the referenced row exists and is on the same
 * farm before issuing an upload — the same shape `assertOwnedReferences` already checks for
 * `land_unit_id`/`enterprise_id` elsewhere.
 *
 * `object_key` and `status` are SERVER-OWNED (offline-sync.md: "Clients never choose bucket
 * paths"). A client's `newAttachmentSchema` body cannot carry either — `AttachmentsService`
 * derives the key and sets status, exactly as `recordMob` derives `initial_head_count` rather
 * than trusting the body's own copy.
 */

import { bigint, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { attachmentStatusEnum, attachmentSubjectTypeEnum } from './enums';
import { auditColumns, primaryId } from './columns';
import { farms, users } from './core';

export const attachments = pgTable('attachments', {
  id: primaryId(),
  farmId: uuid('farm_id')
    .notNull()
    .references(() => farms.id),
  subjectType: attachmentSubjectTypeEnum('subject_type').notNull(),
  /** Not a foreign key — see this file's header. */
  subjectId: uuid('subject_id').notNull(),
  mimeType: text('mime_type').notNull(),
  /** `bigint` (mapped to a JS string by drizzle-orm/pg-core unless `mode: 'number'`): a photo or
   *  scanned document can exceed the signed 32-bit `integer` range other tables use for smaller
   *  counts, and there is no reason to share their ceiling. */
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  /** Lowercase sha256 hex — see `checksumSchema` in @werf/core. Upload is idempotent by id AND
   *  checksum, so this is a correctness column, not a display one. */
  checksum: text('checksum').notNull(),
  /** Null until the API has issued a presigned upload for this row (server-derived, never a
   *  client-supplied path). */
  objectKey: text('object_key'),
  status: attachmentStatusEnum('status').notNull().default('pending'),
  /** When the photo was taken / the document produced — captured offline, days before this row
   *  reaches the server. */
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  updatedBy: uuid('updated_by').references(() => users.id),
  ...auditColumns,
});
