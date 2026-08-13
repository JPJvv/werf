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
import { and, eq, isNull } from 'drizzle-orm';
import { animals, attachments, type AppDb } from '@werf/db';
import { ConflictError, NotFoundError, ValidationError, type schemas } from '@werf/core';
import { APP_DB } from '../db/db.module';
import { assertCanCapture, type CaptureTx } from '../common/event-capture';
import { OBJECT_STORAGE, attachmentObjectKey, type ObjectStorage } from './object-storage';

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

      let stored = row;
      if (!stored) {
        const [existing] = await tx
          .select(attachmentProjection)
          .from(attachments)
          .where(and(eq(attachments.id, input.id), eq(attachments.farmId, input.farmId)));
        stored = existing!;
      }

      // A row already finalised has nothing left to upload — a retried create for an id whose
      // upload already completed gets the row back, not a fresh (unusable) presigned URL.
      if (stored.status === 'finalised') {
        return { attachmentId: stored.id, uploadUrl: null, checksumHeaderValue: null, stored };
      }

      const presigned = await this.storage.presignPut(stored.objectKey ?? objectKey, {
        contentType: stored.mimeType,
        checksumSha256Hex: stored.checksum,
      });

      return {
        attachmentId: stored.id,
        uploadUrl: presigned.uploadUrl,
        checksumHeaderValue: presigned.checksumHeaderValue,
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

      const [finalized] = await tx
        .update(attachments)
        .set({ status: 'finalised', updatedBy: userId })
        .where(and(eq(attachments.id, input.id), eq(attachments.farmId, input.farmId)))
        .returning(attachmentProjection);
      return finalized!;
    });
  }
}
