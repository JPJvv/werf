/**
 * Sweeps abandoned attachment uploads (phase-checklists.md 3i(b)) — a `pending` row whose presigned
 * upload window expired and was never finalised. `0022_attachments.sql`'s `attachments_pending_idx`
 * (`created_at WHERE status = 'pending'`) exists for exactly this query; nothing read it until now.
 *
 * ⛔ SAFE TO SWEEP AGGRESSIVELY, and that safety is worth stating rather than assumed: neither
 * `createAttachment` nor `finalizeAttachment` (`attachments.service.ts`) filters on `deleted_at` —
 * both look a row up by `(id, farm_id)` alone. So a device that captured a photo, went offline for
 * a week, and only now reconnects can still finish the SAME upload after this sweep has already
 * soft-deleted the row and released its object: `createAttachment` finds the (soft-deleted) row by
 * id, re-presigns a fresh PUT at the same deterministic key (`attachmentObjectKey`), and
 * `finalizeAttachment` re-derives size/checksum from whatever lands there next. The client still
 * holds the blob locally the whole time — 3i(c)'s own rule, "the blob is released only once
 * finalize returns" — so nothing this sweep does can lose a farmer's photo. What it reclaims is
 * storage a genuinely abandoned capture (a duplicate, an animal that was later refused permanently)
 * would otherwise hold onto forever with no future reader.
 *
 * The threshold is generous relative to the 15-minute presigned-URL TTL (`PRESIGNED_PUT_TTL_SECONDS`)
 * that governs any ONE upload attempt, precisely because it does not need to protect an in-flight
 * retry the way that TTL does — see the paragraph above.
 *
 * ⭐ P1.2 (2026-08-14): the CLAIM is one atomic, conditional `UPDATE ... WHERE status = 'pending'
 * AND deleted_at IS NULL ... RETURNING`, not a `SELECT` followed by a separate write. A `SELECT`
 * reads a snapshot that can go stale before the loop below acts on it — a row this query saw as
 * `pending` a moment ago can be finalised by a concurrent `finalizeAttachment` call in between.
 * The conditional UPDATE closes that window at the database: Postgres serialises two concurrent
 * writers touching the same row, and each one's WHERE clause is re-evaluated against the LATEST
 * committed state when it is unblocked — so this claim silently skips any row `finalizeAttachment`
 * won first, and `finalizeAttachment`'s own matching gate (`attachments.service.ts`) silently
 * skips any row this claim won first. At most one writer can ever succeed per row; there is no
 * interleaving that finalises a row this sweep has released the object for, or that leaves a
 * `finalised` row tombstoned.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { attachments, farms, type ElevatedDb } from '@werf/db';
import { ELEVATED_DB } from '../db/db.module';
import { OBJECT_STORAGE, type ObjectStorage } from './object-storage';

export const ATTACHMENT_ORPHAN_SWEEP_CRON = '0 0 * * * *';

/** Not a regulated number (CLAUDE.md) — a storage-hygiene parameter of ours, chosen to comfortably
 *  outlast a farmer offline for a normal working day without ever risking a row still mid-retry. */
export const ATTACHMENT_ORPHAN_THRESHOLD_HOURS = 24;

@Injectable()
export class AttachmentOrphanSweepService {
  private readonly logger = new Logger(AttachmentOrphanSweepService.name);

  constructor(
    @Inject(ELEVATED_DB) private readonly elevated: ElevatedDb,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  @Cron(ATTACHMENT_ORPHAN_SWEEP_CRON, {
    name: 'attachment-orphan-sweep',
    waitForCompletion: true,
  })
  async sweepOrphanedUploads(): Promise<number> {
    // The CLAIM: one conditional UPDATE, atomic per row against a concurrent `finalizeAttachment`
    // (see this class's header). Only rows genuinely still `pending` at the moment each row's
    // lock is acquired are tombstoned and returned — never a row a finalize call won first.
    const claimed = await this.elevated.db
      .update(attachments)
      .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(attachments.status, 'pending'),
          isNull(attachments.deletedAt),
          lt(
            attachments.createdAt,
            sql`now() - make_interval(hours => ${ATTACHMENT_ORPHAN_THRESHOLD_HOURS})`,
          ),
        ),
      )
      .returning({
        id: attachments.id,
        farmId: attachments.farmId,
        objectKey: attachments.objectKey,
        sizeBytes: attachments.sizeBytes,
      });

    // The object release happens AFTER the claim commits, deliberately: a row is already
    // tombstoned (and so cannot be finalised — the gate above is the correctness boundary) the
    // instant it is claimed, regardless of whether this loop ever runs to completion. A crash
    // here leaves a released-nothing object with a tombstoned row pointing at it — a small,
    // recoverable storage leak, not the data-integrity failure a live finalize race would be.
    // One object's delete failing must not stop the rest of the batch from being reclaimed.
    for (const row of claimed) {
      if (row.objectKey === null) continue;
      try {
        await this.storage.deleteObject(row.objectKey);
      } catch (error) {
        this.logger.warn(
          `Failed to release object for swept attachment ${row.id}: ${String(error)}`,
        );
      }
    }

    // P3.16: release each reclaimed row's QUOTA RESERVATION, not just its object. `createAttachment`
    // charges a row's bytes against `farms.attachment_bytes_used` the moment it decides an upload
    // WILL happen (a fresh insert or a revival) — a `pending` row this sweep claims never finished
    // that upload, so its reservation must come back or an abandoned capture would permanently eat
    // into a farm's quota. `GREATEST(...,0)` is a defensive floor, matching `finalizeAttachment`'s
    // own clock-skew guard shape: correct accounting never needs it, but it is cheap insurance
    // against the nonnegative CHECK constraint rather than a 500 from a bug this sweep can't see.
    // Best-effort per row, same as the object release above: one farm's decrement failing must not
    // stop the rest of the batch from being reclaimed.
    for (const row of claimed) {
      try {
        await this.elevated.db
          .update(farms)
          .set({
            attachmentBytesUsed: sql`GREATEST(${farms.attachmentBytesUsed} - ${row.sizeBytes}, 0)`,
          })
          .where(eq(farms.id, row.farmId));
      } catch (error) {
        this.logger.warn(
          `Failed to release quota for swept attachment ${row.id}: ${String(error)}`,
        );
      }
    }

    if (claimed.length > 0) {
      this.logger.log(`Swept ${claimed.length} orphaned attachment upload(s)`);
    }
    return claimed.length;
  }
}
