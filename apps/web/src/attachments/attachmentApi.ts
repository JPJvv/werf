/**
 * The three legs of an attachment send (phase-checklists.md 3i(c)): create → PUT → finalize, run
 * from inside ONE call so `Outbox.tsx` can treat an attachment as a single `FlushItem` — the whole
 * sequence is end-to-end idempotent by construction (3i(b)), and there is no safe place to split it
 * into three queue entries that could land in the wrong order or get stuck half-done as two.
 *
 * ⛔ NO STEP HERE EVER CACHES A PRESIGNED URL. `createAttachment` is called FRESH on every send
 * attempt, never once and reused — offline-sync.md §3.1: "Clients never choose bucket paths and
 * never store presigned URLs." A URL obtained an hour ago (the previous failed round) would have
 * expired; re-calling `createAttachment` costs nothing extra (the server re-derives the same
 * object key and, for a still-pending row, re-presigns) and is the only version of this that
 * cannot go stale.
 */

import { schemas } from '@werf/core';
import type { BlobStore } from '@werf/sync';
import { NetworkUnavailableError } from '../auth/api';
import { postCapture, postCaptureAndRead } from '../sync/captureApi';
import type { StoredAttachment } from './LocalAttachments';

/** Leg 1: register the attachment (idempotent on `id` — a retry with identical bytes/subject
 *  finds the same row and re-presigns; a retry with DIFFERENT bytes/subject for the same id is a
 *  genuine conflict and throws `AuthApiError` with a 409). Parsed through
 *  `attachmentUploadUrlSchema` rather than trusted as `unknown` — the same JSON-round-trip
 *  discipline that caught 3i(b)'s real wire-contract bug (STATUS.md §3). */
async function createAttachment(
  attachment: StoredAttachment,
  accessToken: string,
): Promise<schemas.AttachmentUploadUrl> {
  const raw = await postCaptureAndRead<unknown>(
    '/attachments',
    {
      id: attachment.id,
      farmId: attachment.farmId,
      subjectType: attachment.subjectType,
      subjectId: attachment.subjectId,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      checksum: attachment.checksum,
      occurredAt: attachment.occurredAt,
    },
    accessToken,
  );
  return schemas.attachmentUploadUrlSchema.parse(raw);
}

/**
 * Leg 2: the bytes themselves, direct to S3/MinIO — never through `apps/api`, so this cannot
 * reuse `postCapture`'s JSON error-body parsing (S3 does not speak this app's error shape).
 *
 * Every failure here — a network drop mid-upload, an expired presign (should not happen: leg 1
 * just re-issued one), a checksum mismatch S3 itself refuses at PUT time — is treated as
 * TRANSIENT, never a permanent refusal. `createAttachment` being idempotent means the whole send
 * simply retries from leg 1 next round with a fresh URL; there is no queue-safe way to distinguish
 * "this will never succeed" from "this needs a new signature" without parsing S3's XML error body,
 * which this app has no other reason to understand. A genuine, permanent PUT failure (a checksum
 * this device computed wrong, say) would retry forever rather than surface as "not sent" — an
 * accepted trade against the alternative of guessing wrong and permanently discarding a photo a
 * network hiccup merely interrupted.
 */
async function uploadAttachmentBlob(
  uploadUrl: string,
  checksumHeaderValue: string,
  mimeType: string,
  blob: Blob,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': mimeType,
        'x-amz-checksum-sha256': checksumHeaderValue,
      },
      body: blob,
    });
  } catch {
    throw new NetworkUnavailableError();
  }
  if (!response.ok) throw new NetworkUnavailableError();
}

/** Leg 3: ask the server to verify the object it actually received and finalise the row.
 *  Idempotent — a re-finalise of an already-`finalised` row short-circuits server-side before
 *  touching the object store again (`attachments.service.ts`). Reuses `postCapture` as-is: nothing
 *  downstream reads the response body, and the same three-way error taxonomy (network/401/refusal)
 *  applies unchanged. */
async function finalizeAttachment(id: string, farmId: string, accessToken: string): Promise<void> {
  await postCapture('/attachments/finalize', { id, farmId }, accessToken);
}

/**
 * The whole send, as ONE `FlushItem.send` — create → (PUT, when there is still something to
 * upload) → finalize → release the local blob.
 *
 * ⭐ THE BLOB IS RELEASED ONLY ONCE `finalize` RETURNS, never on the PUT's own success
 * (phase-checklists.md 3i(c) design note (c)). A PUT can succeed while the app is killed before
 * `finalize` runs — the next attempt needs the bytes still in `BlobStore` to retry that leg, so
 * `blobStore.delete` is the LAST statement in this function, reached only after every earlier
 * await has resolved without throwing.
 */
export async function sendAttachment(
  attachment: StoredAttachment,
  blobStore: BlobStore,
  accessToken: string,
): Promise<void> {
  const upload = await createAttachment(attachment, accessToken);
  // `uploadUrl` is null ONLY when a re-flushed create finds the row already finalised server-side
  // — nothing left to upload. Skip straight to the (idempotent, now-a-no-op) finalize below.
  if (upload.uploadUrl !== null) {
    const blob = await blobStore.get(attachment.id);
    // A missing LOCAL blob while the SERVER still says "not finalised" cannot happen under this
    // device's own discipline (the blob is released only after a finalize this device observed
    // succeed) — it would mean the bytes are genuinely gone. Falling through to finalize anyway
    // lets the server's own idempotent check resolve it: if the object was never actually PUT,
    // `finalizeAttachment`'s `HeadObject` re-derivation refuses it (a 4xx), which is the correct,
    // permanent answer for a photo this device can no longer produce — not an infinite retry.
    if (blob !== null) {
      if (upload.checksumHeaderValue === null) {
        // The wire contract guarantees these travel together (schemas.attachmentUploadUrlSchema's
        // own docstring) — a non-null `uploadUrl` with a null checksum header is a contract
        // violation, not a state this device can act on. Thrown, not swallowed: `isRefusal`
        // treats a plain error as transient, so this retries rather than silently mis-uploading.
        throw new Error('attachmentUploadUrlSchema: uploadUrl present with no checksum header');
      }
      await uploadAttachmentBlob(
        upload.uploadUrl,
        upload.checksumHeaderValue,
        attachment.mimeType,
        blob,
      );
    }
  }
  await finalizeAttachment(attachment.id, attachment.farmId, accessToken);
  await blobStore.delete(attachment.id);
}
