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
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { attachments, type ElevatedDb } from '@werf/db';
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
    const stale = await this.elevated.db
      .select({ id: attachments.id, objectKey: attachments.objectKey })
      .from(attachments)
      .where(
        and(
          isNull(attachments.deletedAt),
          eq(attachments.status, 'pending'),
          lt(
            attachments.createdAt,
            sql`now() - make_interval(hours => ${ATTACHMENT_ORPHAN_THRESHOLD_HOURS})`,
          ),
        ),
      );

    for (const row of stale) {
      // Released BEFORE the row is tombstoned, not after: if the process dies between the two,
      // the next sweep simply finds the row again (still `pending`, still stale) and retries the
      // delete — an object with nothing pointing at it is the safe state to fail into, not a
      // tombstoned row whose object leaked.
      if (row.objectKey !== null) await this.storage.deleteObject(row.objectKey);
      await this.elevated.db
        .update(attachments)
        .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
        .where(and(eq(attachments.id, row.id), isNull(attachments.deletedAt)));
    }

    if (stale.length > 0) {
      this.logger.log(`Swept ${stale.length} orphaned attachment upload(s)`);
    }
    return stale.length;
  }
}
