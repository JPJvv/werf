/**
 * The attachment binary storage PORT (phase-checklists.md 3i) and its one adapter — S3-compatible,
 * MinIO in dev/test and real S3 in `af-south-1` in production (ADR-0002). Narrower than
 * `mail/mailer.ts`'s port: mail has a legitimate degraded mode (log the message, keep the
 * membership row); a presigned URL with nowhere to presign against has no equivalent no-op, so
 * there is exactly one adapter and `AttachmentsModule` refuses to boot without it configured.
 *
 * ⛔ EMPIRICALLY CONFIRMED, 2026-08-13, against `minio/minio:latest` (testcontainers, not docs):
 * presigning a `PutObjectCommand` WITH `ChecksumSHA256` set binds `x-amz-checksum-sha256` into
 * the SigV4 signature. A client that PUTs bytes not matching that declared header gets a 400
 * (`XAmzContentChecksumMismatch`) from MinIO's own independent hash of the body — this is
 * PUT-time storage-level enforcement, not something `finalize` has to redo by downloading and
 * re-hashing the object itself. `HeadObject` with `ChecksumMode: 'ENABLED'` reads the same value
 * back. This is why `finalize` below only re-derives size and checksum from the STORED object
 * (never trusts the client's claim) rather than streaming the body through a hash — the PUT
 * already refused any body that didn't match what was signed.
 */

import { createHash } from 'node:crypto';
import {
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AppConfig } from '../config/config';

/** The dependency-injection token for the port. */
export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

/** A presigned PUT is short-lived — long enough for a farm-signal upload to start, not a
 *  standing credential. Not a regulated number (CLAUDE.md); a security parameter of ours. */
export const PRESIGNED_PUT_TTL_SECONDS = 15 * 60;

export interface PresignedUpload {
  readonly uploadUrl: string;
  /** Base64, per S3's `x-amz-checksum-sha256` header contract — NOT the hex the domain stores. */
  readonly checksumHeaderValue: string;
  /** When `uploadUrl` stops working — computed here, next to the TTL it is derived from, so the
   *  service layer never restates `PRESIGNED_PUT_TTL_SECONDS` as a second literal. */
  readonly expiresAt: Date;
}

export interface StoredObject {
  readonly sizeBytes: number;
  /** Hex, matching `@werf/core/schemas`' `checksumSchema` — converted from S3's base64 here so
   *  nothing above this adapter needs to know S3's own header encoding. */
  readonly checksumSha256Hex: string;
}

export interface ObjectStorage {
  /** A presigned PUT bound to exactly this key and this checksum — see the header note on why a
   *  mismatched body is refused at PUT time, not discovered later. */
  presignPut(
    key: string,
    opts: { contentType: string; checksumSha256Hex: string },
  ): Promise<PresignedUpload>;
  /** The stored object's actual size and checksum, or null if nothing has landed at this key yet. */
  headObject(key: string): Promise<StoredObject | null>;
}

/** Config shape `AttachmentsModule` extracts from `AppConfig.objectStorage` — see its own doc for
 *  why the field is nullable there and required by the time it reaches this adapter. */
export type ObjectStorageConfig = NonNullable<AppConfig['objectStorage']>;

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ObjectStorageConfig) {
    this.bucket = config.bucket;
    const clientConfig: S3ClientConfig = {
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    };
    if (config.endpoint !== undefined) clientConfig.endpoint = config.endpoint;
    this.client = new S3Client(clientConfig);
  }

  async presignPut(
    key: string,
    opts: { contentType: string; checksumSha256Hex: string },
  ): Promise<PresignedUpload> {
    const checksumHeaderValue = Buffer.from(opts.checksumSha256Hex, 'hex').toString('base64');
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: opts.contentType,
      ChecksumSHA256: checksumHeaderValue,
      ChecksumAlgorithm: 'SHA256',
    });
    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: PRESIGNED_PUT_TTL_SECONDS,
    });
    const expiresAt = new Date(Date.now() + PRESIGNED_PUT_TTL_SECONDS * 1000);
    return { uploadUrl, checksumHeaderValue, expiresAt };
  }

  async headObject(key: string): Promise<StoredObject | null> {
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key, ChecksumMode: 'ENABLED' }),
      );
      // ChecksumSHA256 is undefined for an object nothing asked MinIO/S3 to checksum — every
      // upload THIS service issues a presign for requests one (ChecksumAlgorithm: 'SHA256' in
      // `presignPut`), so treating an absent checksum the same as no object is safe here: it can
      // only mean nothing has gone through this service's own upload path yet.
      if (head.ContentLength === undefined || head.ChecksumSHA256 === undefined) return null;
      return {
        sizeBytes: head.ContentLength,
        checksumSha256Hex: Buffer.from(head.ChecksumSHA256, 'base64').toString('hex'),
      };
    } catch (err) {
      if (err instanceof NotFound) return null;
      throw err;
    }
  }
}

/** The object key an attachment's binary lives at — server-derived, never client-supplied, and
 *  deterministic from the row so a re-requested presign (a retried create) reuses the same key
 *  instead of orphaning a new one each time. */
export function attachmentObjectKey(farmId: string, attachmentId: string): string {
  return `farm/${farmId}/attachments/${attachmentId}`;
}

/** The domain's checksum over real bytes — the same computation `newAttachmentSchema.checksum`
 *  documents a client running at capture time. Exported so a test builds a body's `checksum` from
 *  the SAME bytes it later PUTs, rather than a hand-typed hex string that could silently drift
 *  from what `createHash` actually produces. */
export function sha256Hex(bytes: Buffer | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
