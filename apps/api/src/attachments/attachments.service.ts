/**
 * Attachment capture: the server-side write path for a farmer's photo or document (phase-
 * checklists.md 3i). Two steps, not one — `createAttachment` issues a presigned PUT the client
 * uploads the binary to directly (never through this API, ADR-0012's REST-up topology still
 * carries the metadata only), and `finalizeAttachment` is the client saying "the PUT completed,
 * please confirm and mark it done."
 *
 * `finalizeAttachment` never trusts the client's claim: it re-derives size and checksum from the
 * object actually stored (via `ObjectStorage.headObject`) and refuses a mismatch. This is what
 * `offline-sync.md`'s "checksum-confirmed server acknowledgement" means in practice — the client's
 * own local commit already happened before this ever runs (its binary went to OPFS at capture
 * time), so this endpoint's only job is proving the SAME bytes made it to durable storage.
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { animals, attachments, farms, type AppDb } from '@werf/db';
import {
  ConflictError,
  NotFoundError,
  QuotaExceededError,
  ValidationError,
  type schemas,
} from '@werf/core';
import { APP_DB } from '../db/db.module';
import { assertCanCapture, type CaptureTx } from '../common/event-capture';
import { OBJECT_STORAGE, attachmentObjectKey, type ObjectStorage } from './object-storage';

/** 5 GB (P3.16, owner decision 2026-08-16). Not a regulated number (CLAUDE.md) — a storage-cost
 *  ceiling of ours, not a legal one. Charged against `farms.attachment_bytes_used`, a running
 *  total this service alone maintains (`AttachmentOrphanSweepService` is the only other writer,
 *  releasing a reservation an abandoned upload never used). */
export const ATTACHMENT_FARM_QUOTA_BYTES = 5 * 1024 * 1024 * 1024;

/** The subject an attachment may point at, checked to exist ON THIS FARM before the row is
 *  created — the same hole `assertOwnedReferences` closes for events (event-capture.ts): a
 *  foreign key checks the row exists, never that it belongs to the caller's farm. A switch (not a
 *  lookup table) so `ATTACHMENT_SUBJECT_TYPES` growing a new member is a compile error here, not
 *  a silent fallthrough that accepts an unchecked subject. */
async function assertSubjectOnFarm(
  tx: CaptureTx,
  farmId: string,
  subjectType: schemas.NewAttachment['subjectType'],
  subjectId: string,
): Promise<void> {
  switch (subjectType) {
    case 'animal': {
      const [row] = await tx
        .select({ id: animals.id })
        .from(animals)
        .where(
          and(eq(animals.id, subjectId), eq(animals.farmId, farmId), isNull(animals.deletedAt)),
        );
      if (!row) throw new NotFoundError('Animal not found');
      return;
    }
    default: {
      const _exhaustive: never = subjectType;
      throw new ValidationError(`Unknown attachment subject type: ${String(_exhaustive)}`);
    }
  }
}

const attachmentProjection = {
  id: attachments.id,
  farmId: attachments.farmId,
  subjectType: attachments.subjectType,
  subjectId: attachments.subjectId,
  mimeType: attachments.mimeType,
  sizeBytes: attachments.sizeBytes,
  checksum: attachments.checksum,
  objectKey: attachments.objectKey,
  status: attachments.status,
  occurredAt: attachments.occurredAt,
  createdBy: attachments.createdBy,
  updatedBy: attachments.updatedBy,
  createdAt: attachments.createdAt,
  updatedAt: attachments.updatedAt,
  deletedAt: attachments.deletedAt,
} as const;

export type CapturedAttachment = Awaited<ReturnType<AttachmentsService['createAttachment']>>;
export type FinalizedAttachment = Awaited<ReturnType<AttachmentsService['finalizeAttachment']>>;

@Injectable()
export class AttachmentsService {
  constructor(
    @Inject(APP_DB) private readonly app: AppDb,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /**
   * Creates the metadata row and issues a presigned upload for its binary. Idempotent on the
   * client-generated id: a re-flushed create returns the SAME row and a FRESH presigned URL for
   * the same deterministic key, rather than a duplicate row or a key crash — a retried create
   * after the first presign's TTL lapsed must still be able to finish the upload.
   */
  async createAttachment(userId: string, input: schemas.NewAttachment) {
    return this.app.asUser(userId, async (tx) => {
      await assertCanCapture(tx, userId, input.farmId);
      await assertSubjectOnFarm(tx, input.farmId, input.subjectType, input.subjectId);

      const objectKey = attachmentObjectKey(input.farmId, input.id);

      const [row] = await tx
        .insert(attachments)
        .values({
          id: input.id,
          farmId: input.farmId,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          checksum: input.checksum,
          objectKey,
          occurredAt: input.occurredAt,
          createdBy: userId,
        })
        .onConflictDoNothing({ target: attachments.id })
        .returning(attachmentProjection);

      // Whether THIS call is the moment a row transitions from "not counted" to "will occupy
      // real storage" — a fresh insert, or reviving one the orphan sweep reclaimed before its
      // upload ever completed (P1.2's proof-of-life path just above). An idempotent retry that
      // finds the SAME live or already-finalised row changes neither: it was already charged.
      let chargesQuota = false;

      let stored = row;
      if (stored) {
        chargesQuota = true;
      } else {
        const [existing] = await tx
          .select(attachmentProjection)
          .from(attachments)
          .where(and(eq(attachments.id, input.id), eq(attachments.farmId, input.farmId)));

        // The id collided but not under this farm — a global PK means onConflictDoNothing
        // no-ops even though tenancy still holds (this select finds nothing). Refuse loudly
        // instead of dereferencing an absent row below.
        if (!existing) {
          throw new ConflictError('Attachment id already in use');
        }

        // offline-sync.md: "idempotent by id AND checksum, not by id alone" — two different
        // checksums for the same id is a second, different capture, not a retry of the first.
        if (
          existing.checksum !== input.checksum ||
          existing.sizeBytes !== input.sizeBytes ||
          existing.mimeType !== input.mimeType ||
          existing.subjectId !== input.subjectId
        ) {
          throw new ConflictError('Attachment id already exists with different content');
        }

        stored = existing;

        // ⭐ P1.2: a LATE RETRY REVIVES the row atomically, in this same transaction, BEFORE a
        // fresh presign is ever issued. The orphan sweep (`attachment-orphan-sweep.service.ts`)
        // soft-deletes a `pending` row it believes abandoned — but that row can still be
        // genuinely mid-flight on a device that was only offline, never gone, and this create
        // call finding it here (matching content, matching id) IS that device's proof of life.
        // Without reviving here, a row that goes on to finalise successfully stays permanently
        // `deleted_at`-tombstoned — invisible to every canonical/sync read path that filters on
        // it, despite the API reporting a normal 2xx the whole way through.
        if (stored.deletedAt !== null) {
          const [revived] = await tx
            .update(attachments)
            .set({ deletedAt: null, updatedAt: sql`clock_timestamp()` })
            .where(and(eq(attachments.id, stored.id), eq(attachments.farmId, input.farmId)))
            .returning(attachmentProjection);
          stored = revived!;
          chargesQuota = true;
        }
      }

      // P3.16: the atomic quota check-and-charge. One conditional UPDATE, not a SELECT-then-
      // compare-then-INSERT — two concurrent creates on the same farm must not both read "under
      // quota" and both proceed, the same TOCTOU this file's other conditional UPDATEs already
      // close (see finalizeAttachment's own note). Runs on THIS transaction's RLS-scoped
      // connection, not elevated: `assertCanCapture` above already proved membership, and
      // `farms_tenant`'s policy accepts a write to a farm the caller belongs to.
      if (chargesQuota) {
        const [charged] = await tx
          .update(farms)
          .set({ attachmentBytesUsed: sql`${farms.attachmentBytesUsed} + ${stored.sizeBytes}` })
          .where(
            and(
              eq(farms.id, input.farmId),
              sql`${farms.attachmentBytesUsed} + ${stored.sizeBytes} <= ${ATTACHMENT_FARM_QUOTA_BYTES}`,
            ),
          )
          .returning({ id: farms.id });

        // Throwing here rolls back the WHOLE transaction — the insert/revival above included —
        // via `tx`'s own rollback, so a refused charge never leaves a "will occupy storage" row
        // uncounted. The farmer's blob stays in local OPFS regardless (3i(c)'s own guarantee);
        // this only refuses to reserve server storage for it until quota frees up.
        if (!charged) {
          throw new QuotaExceededError(
            `This farm has reached its ${ATTACHMENT_FARM_QUOTA_BYTES} byte attachment storage quota`,
          );
        }
      }

      // A row already finalised has nothing left to upload — a retried create for an id whose
      // upload already completed gets the row back, not a fresh (unusable) presigned URL.
      if (stored.status === 'finalised') {
        return {
          attachmentId: stored.id,
          uploadUrl: null,
          checksumHeaderValue: null,
          expiresAt: null,
          stored,
        };
      }

      const presigned = await this.storage.presignPut(stored.objectKey ?? objectKey, {
        contentType: stored.mimeType,
        checksumSha256Hex: stored.checksum,
      });

      return {
        attachmentId: stored.id,
        uploadUrl: presigned.uploadUrl,
        checksumHeaderValue: presigned.checksumHeaderValue,
        expiresAt: presigned.expiresAt,
        stored,
      };
    });
  }

  /**
   * Confirms the PUT completed and marks the row finalised — re-deriving size and checksum from
   * the object actually stored, never trusting the client's claim (see the module header).
   *
   * ⭐ Checks "already finalised" BEFORE touching the object store, not after: this capture's own
   * validation reads state (`headObject`) that a second finalize call cannot assume is still
   * meaningful to re-check (CLAUDE.md's promoted rule — the same shape as `findEvent`'s note in
   * `event-capture.ts`). A re-flushed finalize after the row is already done must be a no-op.
   */
  async finalizeAttachment(userId: string, input: schemas.FinalizeAttachmentRequest) {
    return this.app.asUser(userId, async (tx) => {
      await assertCanCapture(tx, userId, input.farmId);

      const [row] = await tx
        .select(attachmentProjection)
        .from(attachments)
        .where(and(eq(attachments.id, input.id), eq(attachments.farmId, input.farmId)));
      if (!row) throw new NotFoundError('Attachment not found');

      if (row.status === 'finalised') return row;

      if (row.objectKey === null) {
        throw new ConflictError('No upload has been issued for this attachment yet');
      }

      const stored = await this.storage.headObject(row.objectKey);
      if (stored === null) {
        throw new ConflictError('Nothing has been uploaded to this attachment yet');
      }
      if (stored.sizeBytes !== row.sizeBytes) {
        throw new ValidationError(
          `Uploaded object is ${stored.sizeBytes} bytes, expected ${row.sizeBytes}`,
        );
      }
      if (stored.checksumSha256Hex !== row.checksum) {
        throw new ValidationError('Uploaded object checksum does not match the captured checksum');
      }

      // ⭐ P1.2: the TOCTOU race this closes — the orphan sweep can claim (soft-delete) this exact
      // row and release its object BETWEEN the `headObject` read above and this write. Gating the
      // UPDATE on `status = 'pending' AND deleted_at IS NULL` makes the two writers mutually
      // exclusive at the database, not merely unlikely to overlap: Postgres serialises concurrent
      // UPDATEs to the same row, and whichever of this statement or the sweep's own conditional
      // UPDATE (`attachment-orphan-sweep.service.ts`) commits first is the one whose WHERE clause
      // the other re-evaluates against — so at most one of {finalised, deleted} can ever become
      // true for a given row, never both. A 0-row result here means the sweep won; it is reported
      // as a refusal so the client's own retry (a fresh `createAttachment`, which revives the row)
      // gets "a genuine second hearing" next flush round (Outbox.tsx) — never a permanent loss,
      // because the client still holds the blob locally until finalize actually succeeds (3i(c)).
      const [finalized] = await tx
        .update(attachments)
        .set({
          status: 'finalised',
          updatedBy: userId,
          // Creation defaults to the Postgres clock. Using the API-host clock here can make the
          // timestamp move backwards when those hosts differ slightly, which the real-container
          // gate caught. Keep one clock domain and guarantee this state transition is observable.
          updatedAt: sql`GREATEST(${attachments.updatedAt} + interval '1 millisecond', clock_timestamp())`,
        })
        .where(
          and(
            eq(attachments.id, input.id),
            eq(attachments.farmId, input.farmId),
            eq(attachments.status, 'pending'),
            isNull(attachments.deletedAt),
          ),
        )
        .returning(attachmentProjection);

      if (!finalized) {
        // Lost the race to the orphan sweep: the object this `headObject` just confirmed may
        // already be gone by now. Refuse rather than report success for a row this transaction
        // can no longer vouch for.
        throw new ConflictError(
          'This upload was reclaimed for cleanup before it could be finalised — retry the upload',
        );
      }
      return finalized;
    });
  }

  /**
   * P2.5: a short-lived presigned GET for one of the caller's OWN finalised attachments — the
   * secure read path this pipeline never had (3i(c) built the write side only). `assertCanCapture`
   * proves farm membership through the RLS-bound connection first, exactly as `createAttachment`
   * does; only THEN is a presigned URL issued, so a foreign or not-yet-finalised attachment is
   * refused before this ever reaches object storage.
   */
  async getDownloadUrl(
    userId: string,
    input: schemas.AttachmentDownloadRequest,
  ): Promise<schemas.AttachmentDownloadUrl> {
    return this.app.asUser(userId, async (tx) => {
      await assertCanCapture(tx, userId, input.farmId);

      const [row] = await tx
        .select(attachmentProjection)
        .from(attachments)
        .where(and(eq(attachments.id, input.id), eq(attachments.farmId, input.farmId)));
      if (!row || row.deletedAt !== null) throw new NotFoundError('Attachment not found');
      // Not yet finalised = nothing durable to read back. `headObject`/`getObject` would either
      // find nothing or find bytes this row has not yet verified — refusing here is the same
      // "do not vouch for what has not been confirmed" discipline `finalizeAttachment` itself uses.
      if (row.status !== 'finalised' || row.objectKey === null) {
        throw new ConflictError('This attachment has not finished uploading yet');
      }

      return this.storage.presignGet(row.objectKey);
    });
  }
}
