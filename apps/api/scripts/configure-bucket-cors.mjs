// Attachment bucket CORS (P1.4, 2026-08-14) — the S3-side half of "a real browser can complete a
// presigned PUT". Presigning a URL (`ObjectStorage.presignPut`) only proves the SIGNATURE is
// valid; it says nothing about whether the BUCKET will accept a cross-origin request at all.
// Without this, every existing attachment integration test still passes — they PUT via Node's
// `fetch`, and CORS is a browser-enforced mechanism `fetch` under Node never applies — while a
// real browser PUT would be blocked before it ever reached S3, either at the browser's own
// preflight or on the response for lacking `Access-Control-Allow-Origin`. See
// `apps/web/e2e/deployed-connectivity.spec.ts` for the real-browser proof this unblocks.
//
// ⛔ PRODUCTION (real S3) ONLY. `PutBucketCors` — the standard S3 API this script calls — returns
// `501 NotImplemented` against `minio/minio:latest`, empirically confirmed 2026-08-14 with BOTH
// this SDK and MinIO's own `mc cors set`: a genuine gap in this edition, not a client quirk. The
// LOCAL dev/test equivalent is `docker-compose.yml`'s `MINIO_API_CORS_ALLOW_ORIGIN` env var on the
// `minio` service — MinIO's community edition configures CORS server-wide, not per bucket. Both
// were verified directly against the real running container: an allowed origin's OPTIONS
// preflight returns matching `Access-Control-Allow-*` headers, a disallowed origin's returns none.
// Idempotent: re-running this script simply replaces the bucket's CORS configuration with this one.

import { S3Client, PutBucketCorsCommand } from '@aws-sdk/client-s3';

const bucket = process.env['OBJECT_STORAGE_BUCKET'];
if (!bucket) {
  console.error('✗ configure-bucket-cors: OBJECT_STORAGE_BUCKET is not set.');
  process.exit(1);
}

// Comma-separated, matching every other multi-value env convention in this repo, and the same
// default shape `docker-compose.yml`'s `MINIO_API_CORS_ALLOW_ORIGIN` uses for local dev — a real
// deploy sets this to the production PWA origin(s) (deployment-guide.md §7 — `app.werf.co.za`).
const origins = (
  process.env['OBJECT_STORAGE_CORS_ORIGINS'] ?? 'http://localhost:4173,http://localhost:5173'
)
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

const client = new S3Client({
  region: process.env['OBJECT_STORAGE_REGION'] ?? 'af-south-1',
  forcePathStyle: process.env['OBJECT_STORAGE_FORCE_PATH_STYLE'] === 'true',
  endpoint: process.env['OBJECT_STORAGE_ENDPOINT'],
  credentials: {
    accessKeyId: process.env['OBJECT_STORAGE_ACCESS_KEY_ID'] ?? '',
    secretAccessKey: process.env['OBJECT_STORAGE_SECRET_ACCESS_KEY'] ?? '',
  },
});

await client.send(
  new PutBucketCorsCommand({
    Bucket: bucket,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: origins,
          // PUT for the upload itself; HEAD is not actually issued by the browser (only this
          // API's own server-side `headObject` reads it) but is allowed for the same reason a
          // presigned GET/HEAD might be added later without a second bucket-CORS change.
          AllowedMethods: ['PUT', 'HEAD'],
          // Every header `uploadAttachmentBlob` (apps/web/src/attachments/attachmentApi.ts) sets
          // on the real PUT, plus the SDK checksum-algorithm header S3/MinIO expects alongside it
          // when a checksum was bound into the presigned signature (object-storage.ts).
          AllowedHeaders: ['Content-Type', 'x-amz-checksum-sha256', 'x-amz-sdk-checksum-algorithm'],
          MaxAgeSeconds: 3600,
        },
      ],
    },
  }),
);

console.log(`✓ CORS configured on bucket "${bucket}" for origin(s): ${origins.join(', ')}`);
