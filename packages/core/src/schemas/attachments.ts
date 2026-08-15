/**
 * Attachment metadata (phase-checklists.md 3i, offline-sync.md § 3.1). The metadata row is an
 * ordinary farm-scoped, client-UUIDv7, soft-deleted sync row — this schema is that row's wire
 * contract, not the binary itself. The binary crosses the wire through a presigned PUT the API
 * issues separately (`newAttachmentSchema` carries no bytes and no URL).
 *
 * `objectKey` and `status` are server-owned: a client never chooses a bucket path
 * (offline-sync.md) and never marks its own upload finalised — only the API's checksum/size
 * verification against the actually-stored object may do that.
 */

import { z } from 'zod';
import {
  attachmentStatusSchema,
  attachmentSubjectTypeSchema,
  auditTimestampsSchema,
  timestampSchema,
  uuidSchema,
  uuidV7Schema,
} from './primitives';

/** sha256, lowercase hex — the checksum a client computes over the blob AT CAPTURE, before any
 *  network is involved, and the API re-derives from the object it actually received. Upload is
 *  idempotent by attachment id and checksum (offline-sync.md), so this is load-bearing, not
 *  advisory: two different checksums for the same id is two different captures, not a retry. */
export const checksumSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'expected a lowercase sha256 hex digest');

export const attachmentSchema = z.object({
  id: uuidSchema,
  farmId: uuidSchema,
  subjectType: attachmentSubjectTypeSchema,
  subjectId: uuidSchema,
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  checksum: checksumSchema,
  /** Server-derived object key. Null until the API has issued a presigned upload for this row. */
  objectKey: z.string().min(1).nullable(),
  status: attachmentStatusSchema,
  /** When the photo was taken / the document produced — days before this reaches the server from
   *  a dead zone, same as every other capture. */
  occurredAt: timestampSchema,
  ...auditTimestampsSchema,
});
export type Attachment = z.infer<typeof attachmentSchema>;

/**
 * What a device composes offline, the moment a photo is taken: the binary already committed to
 * OPFS (offline-sync.md — "the binary is written to OPFS before capture reports success"), and
 * this is the metadata half of that same commit. No `objectKey`, no `status` — both start
 * server-side at `pending`/`null` regardless of what a client sent, for the same reason
 * `recordMob` never reads a client's `initialHeadCount` (livestock.service.ts): a value only the
 * server may set is not read from the body even when the body happens to carry one.
 */
export const newAttachmentSchema = attachmentSchema
  .pick({
    id: true,
    farmId: true,
    subjectType: true,
    subjectId: true,
    mimeType: true,
    sizeBytes: true,
    checksum: true,
    occurredAt: true,
  })
  .extend({
    /** Client-generated UUIDv7 for the attachment row (P2.9) — not merely a well-formed UUID. */
    id: uuidV7Schema,
  });
export type NewAttachment = z.infer<typeof newAttachmentSchema>;

/** The response to a create-attachment request: where to PUT the bytes, and for how long that URL
 *  is valid. The object key itself never crosses to the client as something it could reuse to
 *  construct its own path — it is embedded in `uploadUrl`, opaque.
 *
 *  `checksumHeaderValue` is the same sha256 the client already computed at capture (in
 *  `newAttachmentSchema.checksum`), re-encoded to the base64 S3's `x-amz-checksum-sha256` header
 *  expects. Handed back rather than re-derived client-side so a hex/base64 encoding bug can only
 *  ever exist in one place (`object-storage.ts`), not in two implementations that must agree.
 *
 *  `uploadUrl`/`checksumHeaderValue`/`expiresAt` are null together ONLY when a re-flushed create
 *  finds the row already finalised (`AttachmentsService.createAttachment`) — there is nothing left
 *  to upload, so issuing a fresh, unusable presigned URL would be pointless. A client checks
 *  `uploadUrl !== null` before attempting the PUT, not `status`, which this response does not carry
 *  at all. */
export const attachmentUploadUrlSchema = z.object({
  attachmentId: uuidSchema,
  uploadUrl: z.string().url().nullable(),
  checksumHeaderValue: z.string().min(1).nullable(),
  expiresAt: timestampSchema.nullable(),
});
export type AttachmentUploadUrl = z.infer<typeof attachmentUploadUrlSchema>;

/** What a device sends once the PUT has completed, to ask the server to verify and finalise. The
 *  server re-derives size/checksum from the object it actually holds — this body is a POINTER to
 *  which row to check, never trusted as the check's answer. */
export const finalizeAttachmentRequestSchema = z.object({
  id: uuidSchema,
  farmId: uuidSchema,
});
export type FinalizeAttachmentRequest = z.infer<typeof finalizeAttachmentRequestSchema>;

/** What a device sends to read back one of ITS OWN finalised attachments (P2.5). Same shape as
 *  `finalizeAttachmentRequestSchema` — a pointer, not a claim — because the server re-checks
 *  farm membership and `status = 'finalised'` before ever issuing a download URL. */
export const attachmentDownloadRequestSchema = z.object({
  id: uuidSchema,
  farmId: uuidSchema,
});
export type AttachmentDownloadRequest = z.infer<typeof attachmentDownloadRequestSchema>;

/** A short-lived presigned GET for one finalised attachment's bytes. */
export const attachmentDownloadUrlSchema = z.object({
  downloadUrl: z.string().url(),
  expiresAt: timestampSchema,
});
export type AttachmentDownloadUrl = z.infer<typeof attachmentDownloadUrlSchema>;
