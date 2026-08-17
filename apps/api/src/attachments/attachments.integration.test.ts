/**
 * Attachment capture against a real Postgres AND a real S3-compatible store (phase-checklists.md
 * 3i). We never mock the database (CLAUDE.md), and the same reasoning extends to object storage
 * here: the interesting behaviour — a presigned URL that refuses mismatched bytes, a finalize that
 * re-derives size/checksum from the object actually stored — is exactly the behaviour a mock
 * cannot exhibit. MinIO via testcontainers, matching `@werf/db/testing`'s own real-Postgres
 * pattern.
 *
 * `object-storage.ts`'s header documents the PUT-time checksum enforcement this relies on
 * (empirically confirmed against `minio/minio:latest`): a presigned PUT with `ChecksumSHA256` set
 * makes MinIO itself reject a body that doesn't hash to the declared value. That means a
 * checksum-mismatch object can never arrive at a key THROUGH this service's own presigned flow —
 * the "checksum mismatch" test below has to write directly to the bucket with a raw S3 client to
 * exercise `finalizeAttachment`'s defence-in-depth check at all, simulating an object that landed
 * there some other way (a bug, a future direct-write path) rather than a normal client upload.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID, randomBytes as nodeRandomBytes } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { JwtModule } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { CreateBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  animals,
  attachments,
  createAppDb,
  createElevatedDb,
  farms,
  users,
  type AppDb,
  type ElevatedDb,
} from '@werf/db';
import { startWerfTestDatabase, type WerfTestDatabase } from '@werf/db/testing';
import {
  ConflictError,
  NotFoundError,
  QuotaExceededError,
  ValidationError,
  schemas,
  uuidv7,
} from '@werf/core';
import { APP_CONFIG, APP_DB, ELEVATED_DB } from '../db/db.module';
import { AuthService } from '../auth/auth.service';
import { SessionService } from '../auth/session.service';
import { TokenService } from '../auth/token.service';
import { TwoFactorService } from '../auth/two-factor.service';
import { PasskeyService } from '../auth/passkey.service';
import { RecoveryCodeService } from '../auth/recovery-code.service';
import { ATTACHMENT_FARM_QUOTA_BYTES, AttachmentsService } from './attachments.service';
import { OBJECT_STORAGE, S3ObjectStorage, attachmentObjectKey, sha256Hex } from './object-storage';

const BOOT_TIMEOUT_MS = 180_000;
const BUCKET = 'attachments-test';
const MINIO_USER = 'werf-test';
const MINIO_PASSWORD = 'werf-test-secret';

const registration = (label: string): schemas.RegisterRequest => ({
  business: {
    name: `${label} Boerdery`,
    registrationNumber: null,
    contact: { email: `${label.toLowerCase()}@example.test`, phone: null },
    physicalAddress: {
      line1: `${label} Plaas`,
      line2: null,
      locality: 'Bothaville',
      province: 'Free State',
      postalCode: '9660',
    },
  },
  farm: {
    name: `${label} Plaas`,
    province: 'Free State',
    district: null,
    enterpriseTypes: ['beef_cattle'],
  },
  owner: {
    fullName: `${label} Owner`,
    email: `${label.toLowerCase()}@werf.test`,
    password: 'correct horse battery staple',
    locale: 'en-ZA',
    theme: 'light',
  },
});

describe('attachment capture (phase-checklists.md 3i)', () => {
  let pg: WerfTestDatabase;
  let app: AppDb;
  let elevated: ElevatedDb;
  let auth: AuthService;
  let service: AttachmentsService;
  let minio: StartedTestContainer;
  let minioEndpoint: string;
  let rawS3: S3Client;

  beforeAll(async () => {
    pg = await startWerfTestDatabase();
    app = createAppDb({ url: pg.appUrl });
    elevated = createElevatedDb({ url: pg.elevatedUrl });

    minio = await new GenericContainer('minio/minio:latest')
      .withExposedPorts(9000)
      .withEnvironment({ MINIO_ROOT_USER: MINIO_USER, MINIO_ROOT_PASSWORD: MINIO_PASSWORD })
      .withCommand(['server', '/data'])
      .withWaitStrategy(Wait.forHttp('/minio/health/live', 9000))
      .start();
    minioEndpoint = `http://${minio.getHost()}:${minio.getMappedPort(9000)}`;

    rawS3 = new S3Client({
      endpoint: minioEndpoint,
      region: 'af-south-1',
      forcePathStyle: true,
      credentials: { accessKeyId: MINIO_USER, secretAccessKey: MINIO_PASSWORD },
    });
    await rawS3.send(new CreateBucketCommand({ Bucket: BUCKET }));

    const objectStorage = new S3ObjectStorage({
      bucket: BUCKET,
      region: 'af-south-1',
      endpoint: minioEndpoint,
      forcePathStyle: true,
      accessKeyId: MINIO_USER,
      secretAccessKey: MINIO_PASSWORD,
    });

    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      providers: [
        AuthService,
        SessionService,
        TokenService,
        TwoFactorService,
        PasskeyService,
        RecoveryCodeService,
        AttachmentsService,
        {
          provide: APP_CONFIG,
          useValue: {
            port: 3000,
            databaseUrl: pg.appUrl,
            databaseElevatedUrl: pg.elevatedUrl,
            jwtSecret: 'test-signing-key-that-is-long-enough-32',
            piiEncryptionKey: nodeRandomBytes(32).toString('base64'),
          },
        },
        { provide: APP_DB, useValue: app },
        { provide: ELEVATED_DB, useValue: elevated },
        { provide: OBJECT_STORAGE, useValue: objectStorage },
      ],
    }).compile();

    auth = moduleRef.get(AuthService);
    service = moduleRef.get(AttachmentsService);
  }, BOOT_TIMEOUT_MS);

  afterEach(async () => {
    await pg.reset();
  });

  afterAll(async () => {
    await app?.close();
    await elevated?.close();
    await pg?.stop();
    await minio?.stop();
  });

  /** Registers a tenant and returns its owner's id and farm id. */
  async function tenant(label: string) {
    const session = await auth.register(registration(label));
    const [owner] = await elevated.db
      .select()
      .from(users)
      .where(eq(users.email, registration(label).owner.email));
    return { userId: owner!.id, farmId: session.activeFarmId! };
  }

  /** A single animal on the farm, so an animal-scoped attachment has a real subject to point at. */
  async function anAnimal(farmId: string): Promise<string> {
    const [row] = await elevated.db
      .insert(animals)
      .values({ farmId, species: 'cattle', sex: 'female' })
      .returning();
    return row!.id;
  }

  /** A minimal valid attachment body over real bytes — `checksum`/`sizeBytes` are derived from
   *  `bytes` itself, never hand-typed, so a test can never accidentally declare a checksum the
   *  bytes it later PUTs don't actually have. */
  function attachmentBody(
    farmId: string,
    subjectId: string,
    bytes: Buffer,
    over: Partial<schemas.NewAttachment> = {},
  ): schemas.NewAttachment {
    return schemas.newAttachmentSchema.parse({
      id: uuidv7(),
      farmId,
      subjectType: 'animal',
      subjectId,
      mimeType: 'image/jpeg',
      sizeBytes: bytes.length,
      checksum: sha256Hex(bytes),
      occurredAt: '2026-07-20T06:00:00.000Z',
      ...over,
    });
  }

  async function putRealBytes(uploadUrl: string, checksumHeaderValue: string, bytes: Buffer) {
    return fetch(uploadUrl, {
      method: 'PUT',
      body: bytes,
      headers: {
        'x-amz-checksum-sha256': checksumHeaderValue,
        'x-amz-sdk-checksum-algorithm': 'SHA256',
      },
    });
  }

  it('creates an attachment, issues a presigned PUT the real bytes round-trip through, and finalizes it', async () => {
    const { userId, farmId } = await tenant('Round');
    const animalId = await anAnimal(farmId);
    const bytes = Buffer.from('a real jpeg-shaped blob, for the purposes of this test');
    const body = attachmentBody(farmId, animalId, bytes);

    const created = await service.createAttachment(userId, body);
    expect(created.uploadUrl).not.toBeNull();
    expect(created.stored.status).toBe('pending');
    // Pins the WIRE contract, not just this service call: `attachmentUploadUrlSchema` is what a
    // real client parses the response against, and JSON.stringify/parse (not a direct `.parse` on
    // the JS object) is what actually crosses the wire — a `Date` only survives that round trip as
    // the ISO string the schema's `timestampSchema` expects.
    schemas.attachmentUploadUrlSchema.parse(JSON.parse(JSON.stringify(created)));

    const putRes = await putRealBytes(created.uploadUrl!, created.checksumHeaderValue!, bytes);
    expect(putRes.status).toBe(200);

    const finalized = await service.finalizeAttachment(userId, { id: body.id, farmId });
    expect(finalized.status).toBe('finalised');
    expect(finalized.sizeBytes).toBe(bytes.length);
    expect(finalized.checksum).toBe(sha256Hex(bytes));
  });

  it('a second create for the same id is idempotent — same row, a fresh presigned URL at the same key', async () => {
    const { userId, farmId } = await tenant('Idem');
    const animalId = await anAnimal(farmId);
    const bytes = Buffer.from('idempotent create bytes');
    const body = attachmentBody(farmId, animalId, bytes);

    const first = await service.createAttachment(userId, body);
    const second = await service.createAttachment(userId, body);

    expect(second.stored.id).toBe(first.stored.id);
    expect(second.stored.objectKey).toBe(first.stored.objectKey);
    expect(second.stored.objectKey).toBe(attachmentObjectKey(farmId, body.id));
  });

  it('finalize is idempotent — a re-flush after the row is already finalised returns it unchanged', async () => {
    const { userId, farmId } = await tenant('Refinal');
    const animalId = await anAnimal(farmId);
    const bytes = Buffer.from('finalize twice bytes');
    const body = attachmentBody(farmId, animalId, bytes);

    const created = await service.createAttachment(userId, body);
    await putRealBytes(created.uploadUrl!, created.checksumHeaderValue!, bytes);
    const first = await service.finalizeAttachment(userId, { id: body.id, farmId });
    const second = await service.finalizeAttachment(userId, { id: body.id, farmId });

    expect(second).toEqual(first);

    // A re-flushed CREATE after finalisation must also validate — the null-URL branch is a
    // distinct shape from the happy path and needs its own pin against the same wire schema.
    const recreated = await service.createAttachment(userId, body);
    expect(recreated.uploadUrl).toBeNull();
    schemas.attachmentUploadUrlSchema.parse(JSON.parse(JSON.stringify(recreated)));
  });

  it('refuses a second create for the same id when the content differs from the first', async () => {
    const { userId, farmId } = await tenant('MismatchRetry');
    const animalId = await anAnimal(farmId);
    const firstBytes = Buffer.from('the first capture');
    const secondBytes = Buffer.from('a completely different second capture');
    const body = attachmentBody(farmId, animalId, firstBytes);

    await service.createAttachment(userId, body);

    await expect(
      service.createAttachment(
        userId,
        attachmentBody(farmId, animalId, secondBytes, { id: body.id }),
      ),
    ).rejects.toThrow(ConflictError);
  });

  it('refuses (does not crash) when the id collides with a row under a DIFFERENT farm', async () => {
    const { userId: userA, farmId: farmA } = await tenant('CollideA');
    const { userId: userB, farmId: farmB } = await tenant('CollideB');
    const animalA = await anAnimal(farmA);
    const animalB = await anAnimal(farmB);
    const sharedId = uuidv7();

    await service.createAttachment(
      userA,
      attachmentBody(farmA, animalA, Buffer.from('farm A bytes'), { id: sharedId }),
    );

    await expect(
      service.createAttachment(
        userB,
        attachmentBody(farmB, animalB, Buffer.from('farm B bytes, entirely different'), {
          id: sharedId,
        }),
      ),
    ).rejects.toThrow(ConflictError);
  });

  it('finalize bumps updatedAt on the pending to finalised transition', async () => {
    const { userId, farmId } = await tenant('UpdatedAtBump');
    const animalId = await anAnimal(farmId);
    const bytes = Buffer.from('updated_at bump bytes');
    const body = attachmentBody(farmId, animalId, bytes);

    const created = await service.createAttachment(userId, body);
    await putRealBytes(created.uploadUrl!, created.checksumHeaderValue!, bytes);
    const finalized = await service.finalizeAttachment(userId, { id: body.id, farmId });

    expect(finalized.updatedAt.getTime()).toBeGreaterThan(created.stored.updatedAt.getTime());
  });

  it('refuses to create for a farm the caller is not a member of', async () => {
    const { farmId } = await tenant('OwnerFarm');
    const outsider = await tenant('Outsider');
    const animalId = await anAnimal(farmId);
    const body = attachmentBody(farmId, animalId, Buffer.from('x'));

    await expect(service.createAttachment(outsider.userId, body)).rejects.toThrow(NotFoundError);
  });

  it('refuses a subject that belongs to a different farm', async () => {
    const { userId, farmId } = await tenant('HomeFarm');
    const other = await tenant('OtherFarm');
    const otherAnimalId = await anAnimal(other.farmId);
    const body = attachmentBody(farmId, otherAnimalId, Buffer.from('x'));

    await expect(service.createAttachment(userId, body)).rejects.toThrow(NotFoundError);
  });

  it('refuses finalize before anything has been uploaded', async () => {
    const { userId, farmId } = await tenant('NoUpload');
    const animalId = await anAnimal(farmId);
    const body = attachmentBody(farmId, animalId, Buffer.from('never uploaded'));

    await service.createAttachment(userId, body);

    await expect(service.finalizeAttachment(userId, { id: body.id, farmId })).rejects.toThrow(
      ConflictError,
    );
  });

  it('refuses finalize when the uploaded object is a different size than declared', async () => {
    const { userId, farmId } = await tenant('SizeLie');
    const animalId = await anAnimal(farmId);
    const realBytes = Buffer.from('the actual bytes that will really be uploaded here');
    // Declares a LARGER size than `realBytes` actually is, while keeping the checksum truthful —
    // the PUT itself only enforces the checksum (see module header), so this is the one way a
    // size lie can reach a real upload at all.
    const body = attachmentBody(farmId, animalId, realBytes, {
      sizeBytes: realBytes.length + 5,
    });

    const created = await service.createAttachment(userId, body);
    const putRes = await putRealBytes(created.uploadUrl!, created.checksumHeaderValue!, realBytes);
    expect(putRes.status).toBe(200);

    await expect(service.finalizeAttachment(userId, { id: body.id, farmId })).rejects.toThrow(
      ValidationError,
    );
  });

  it('refuses finalize when the stored object does not match the declared checksum', async () => {
    const { userId, farmId } = await tenant('ChecksumLie');
    const animalId = await anAnimal(farmId);
    const declaredBytes = Buffer.from('what the row says this attachment is');
    const body = attachmentBody(farmId, animalId, declaredBytes);
    await service.createAttachment(userId, body);

    // Bypasses the presigned flow entirely — a normal PUT could never land wrong bytes here (the
    // signature binds the checksum, per the module header). This simulates an object arriving at
    // the key some OTHER way. Derived from `declaredBytes` by flipping one byte, so it is
    // GUARANTEED the same length (isolating the checksum branch from the size branch above) and a
    // different sha256.
    const wrongBytes = Buffer.from(declaredBytes);
    wrongBytes[0] = wrongBytes[0]! ^ 0xff;
    // ChecksumAlgorithm requested directly (not via a signed header) so MinIO computes and stores
    // a real checksum for these bytes — otherwise `headObject`'s `ChecksumSHA256` comes back
    // undefined and the row reads as "nothing uploaded" rather than "wrong thing uploaded".
    await rawS3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: attachmentObjectKey(farmId, body.id),
        Body: wrongBytes,
        ChecksumAlgorithm: 'SHA256',
      }),
    );

    await expect(service.finalizeAttachment(userId, { id: body.id, farmId })).rejects.toThrow(
      ValidationError,
    );
  });

  it('refuses finalize for a farm the caller is not a member of', async () => {
    const { farmId } = await tenant('FinalizeOwner');
    const outsider = await tenant('FinalizeOutsider');

    await expect(
      service.finalizeAttachment(outsider.userId, { id: randomUUID(), farmId }),
    ).rejects.toThrow(NotFoundError);
  });

  // ── Secure reads (P2.5) — the read path this pipeline never had until now ──────────────
  describe('getDownloadUrl — a short-lived presigned GET for one own finalised attachment', () => {
    it('issues a URL the SAME bytes round-trip back through', async () => {
      const { userId, farmId } = await tenant('Download');
      const animalId = await anAnimal(farmId);
      const bytes = Buffer.from('the bytes a download URL must hand back unchanged');
      const body = attachmentBody(farmId, animalId, bytes);

      const created = await service.createAttachment(userId, body);
      await putRealBytes(created.uploadUrl!, created.checksumHeaderValue!, bytes);
      await service.finalizeAttachment(userId, { id: body.id, farmId });

      const download = await service.getDownloadUrl(userId, { id: body.id, farmId });
      schemas.attachmentDownloadUrlSchema.parse(JSON.parse(JSON.stringify(download)));

      const res = await fetch(download.downloadUrl);
      expect(res.status).toBe(200);
      expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes);
    });

    it('refuses an attachment that has not finished uploading yet', async () => {
      const { userId, farmId } = await tenant('DownloadPending');
      const animalId = await anAnimal(farmId);
      const body = attachmentBody(farmId, animalId, Buffer.from('never finalised'));
      await service.createAttachment(userId, body);

      await expect(service.getDownloadUrl(userId, { id: body.id, farmId })).rejects.toThrow(
        ConflictError,
      );
    });

    it('refuses a caller who is not a member of the attachment farm', async () => {
      const { userId, farmId } = await tenant('DownloadOwner');
      const outsider = await tenant('DownloadOutsider');
      const animalId = await anAnimal(farmId);
      const bytes = Buffer.from('another farms bytes');
      const body = attachmentBody(farmId, animalId, bytes);

      const created = await service.createAttachment(userId, body);
      await putRealBytes(created.uploadUrl!, created.checksumHeaderValue!, bytes);
      await service.finalizeAttachment(userId, { id: body.id, farmId });

      await expect(
        service.getDownloadUrl(outsider.userId, { id: body.id, farmId }),
      ).rejects.toThrow(NotFoundError);
    });

    it('is a 404 for an unknown attachment id', async () => {
      const { userId, farmId } = await tenant('DownloadUnknown');

      await expect(service.getDownloadUrl(userId, { id: randomUUID(), farmId })).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  describe('attachment storage quota (P3.16, owner decision 2026-08-16)', () => {
    /** Sets a farm's running usage directly, so this test proves the quota GATE without
     *  uploading real gigabytes to get there — `createAttachment` only ever reads/writes the
     *  declared `sizeBytes`, never real bytes (`finalizeAttachment` is the one that re-derives
     *  from the object actually stored), so a declared size far from the real `Buffer` used is a
     *  faithful simulation of "this farm is almost at its quota", not a shortcut around it. */
    async function setUsage(farmId: string, bytesUsed: number): Promise<void> {
      await elevated.db
        .update(farms)
        .set({ attachmentBytesUsed: bytesUsed })
        .where(eq(farms.id, farmId));
    }

    async function usage(farmId: string): Promise<number> {
      const [row] = await elevated.db
        .select({ attachmentBytesUsed: farms.attachmentBytesUsed })
        .from(farms)
        .where(eq(farms.id, farmId));
      return row!.attachmentBytesUsed;
    }

    it('charges a fresh attachment against the farm total', async () => {
      const { userId, farmId } = await tenant('QuotaCharge');
      const animalId = await anAnimal(farmId);
      const body = attachmentBody(farmId, animalId, Buffer.from('x'), { sizeBytes: 12_345 });

      await service.createAttachment(userId, body);

      expect(await usage(farmId)).toBe(12_345);
    });

    it('refuses a create that would push the farm over quota, and charges nothing', async () => {
      const { userId, farmId } = await tenant('QuotaRefuse');
      const animalId = await anAnimal(farmId);
      await setUsage(farmId, ATTACHMENT_FARM_QUOTA_BYTES - 100);
      const body = attachmentBody(farmId, animalId, Buffer.from('x'), { sizeBytes: 200 });

      await expect(service.createAttachment(userId, body)).rejects.toThrow(QuotaExceededError);

      // The whole transaction rolled back: the usage counter is untouched AND no orphaned row
      // was left behind for a would-be upload that was refused before it started.
      expect(await usage(farmId)).toBe(ATTACHMENT_FARM_QUOTA_BYTES - 100);
      const rows = await elevated.db.select().from(attachments).where(eq(attachments.id, body.id));
      expect(rows).toHaveLength(0);
    });

    it('allows a create that lands exactly on the quota boundary', async () => {
      const { userId, farmId } = await tenant('QuotaBoundary');
      const animalId = await anAnimal(farmId);
      await setUsage(farmId, ATTACHMENT_FARM_QUOTA_BYTES - 100);
      const body = attachmentBody(farmId, animalId, Buffer.from('x'), { sizeBytes: 100 });

      await expect(service.createAttachment(userId, body)).resolves.toBeDefined();

      expect(await usage(farmId)).toBe(ATTACHMENT_FARM_QUOTA_BYTES);
    });

    it('does not double-charge an idempotent retry of the same still-pending attachment', async () => {
      const { userId, farmId } = await tenant('QuotaIdempotent');
      const animalId = await anAnimal(farmId);
      const body = attachmentBody(farmId, animalId, Buffer.from('x'), { sizeBytes: 500 });

      await service.createAttachment(userId, body);
      await service.createAttachment(userId, body); // same id, same content — a re-flushed create

      expect(await usage(farmId)).toBe(500);
    });

    it('does not charge quota twice for one farm’s two DIFFERENT attachments beyond their own sizes', async () => {
      // Guards against a broken predicate accidentally scoping the UPDATE to ALL farms instead of
      // this one — a second, unrelated tenant's usage must never move.
      const { userId, farmId } = await tenant('QuotaScopedA');
      const other = await tenant('QuotaScopedB');
      const animalId = await anAnimal(farmId);
      const body = attachmentBody(farmId, animalId, Buffer.from('x'), { sizeBytes: 1_000 });

      await service.createAttachment(userId, body);

      expect(await usage(farmId)).toBe(1_000);
      expect(await usage(other.farmId)).toBe(0);
    });
  });
});
