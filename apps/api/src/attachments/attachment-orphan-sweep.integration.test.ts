/**
 * Behavioural proof for the attachment orphan sweep (phase-checklists.md 3i(b)), against real
 * Postgres AND real MinIO — the same "never mock the database, and the same reasoning extends to
 * object storage" discipline `attachments.integration.test.ts` states in its own header.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID, randomBytes as nodeRandomBytes } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { JwtModule } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { CreateBucketCommand, HeadObjectCommand, NotFound, S3Client } from '@aws-sdk/client-s3';
import {
  animals,
  attachments,
  createAppDb,
  createElevatedDb,
  users,
  type AppDb,
  type ElevatedDb,
} from '@werf/db';
import { startWerfTestDatabase, type WerfTestDatabase } from '@werf/db/testing';
import { schemas } from '@werf/core';
import { APP_CONFIG, APP_DB, ELEVATED_DB } from '../db/db.module';
import { AuthService } from '../auth/auth.service';
import { SessionService } from '../auth/session.service';
import { TokenService } from '../auth/token.service';
import { TwoFactorService } from '../auth/two-factor.service';
import { PasskeyService } from '../auth/passkey.service';
import { RecoveryCodeService } from '../auth/recovery-code.service';
import { AttachmentsService } from './attachments.service';
import {
  AttachmentOrphanSweepService,
  ATTACHMENT_ORPHAN_THRESHOLD_HOURS,
} from './attachment-orphan-sweep.service';
import { OBJECT_STORAGE, S3ObjectStorage, sha256Hex } from './object-storage';

const BOOT_TIMEOUT_MS = 180_000;
const BUCKET = 'attachments-sweep-test';
const MINIO_USER = 'werf-test';
const MINIO_PASSWORD = 'werf-test-secret';

const registration = (label: string): schemas.RegisterRequest => ({
  business: { name: `${label} Boerdery`, registrationNumber: null },
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

describe('attachment orphan sweep (phase-checklists.md 3i(b))', () => {
  let pg: WerfTestDatabase;
  let app: AppDb;
  let elevated: ElevatedDb;
  let auth: AuthService;
  let service: AttachmentsService;
  let sweep: AttachmentOrphanSweepService;
  let minio: StartedTestContainer;
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
    const minioEndpoint = `http://${minio.getHost()}:${minio.getMappedPort(9000)}`;

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
        AttachmentOrphanSweepService,
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
    sweep = moduleRef.get(AttachmentOrphanSweepService);
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

  async function tenant(label: string) {
    const session = await auth.register(registration(label));
    const [owner] = await elevated.db
      .select()
      .from(users)
      .where(eq(users.email, registration(label).owner.email));
    return { userId: owner!.id, farmId: session.activeFarmId! };
  }

  async function anAnimal(farmId: string): Promise<string> {
    const [row] = await elevated.db
      .insert(animals)
      .values({ farmId, species: 'cattle', sex: 'female' })
      .returning();
    return row!.id;
  }

  function attachmentBody(
    farmId: string,
    subjectId: string,
    bytes: Buffer,
    over: Partial<schemas.NewAttachment> = {},
  ): schemas.NewAttachment {
    return schemas.newAttachmentSchema.parse({
      id: randomUUID(),
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

  /** Backdates a row's `created_at` past the sweep threshold — the sweep predicate's own boundary,
   *  not a hand-picked "long ago" that would also pass a much stricter threshold. */
  async function backdate(id: string): Promise<void> {
    const past = new Date(Date.now() - (ATTACHMENT_ORPHAN_THRESHOLD_HOURS + 1) * 60 * 60 * 1000);
    await elevated.db.update(attachments).set({ createdAt: past }).where(eq(attachments.id, id));
  }

  async function objectExists(key: string): Promise<boolean> {
    try {
      await rawS3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
      return true;
    } catch (err) {
      if (err instanceof NotFound) return false;
      throw err;
    }
  }

  it('⭐ soft-deletes a stale pending row with no upload, and leaves nothing for a HeadObject to find', async () => {
    const { userId, farmId } = await tenant('NeverUploaded');
    const animalId = await anAnimal(farmId);
    const body = attachmentBody(farmId, animalId, Buffer.from('never uploaded, then abandoned'));
    const created = await service.createAttachment(userId, body);
    await backdate(body.id);

    await expect(sweep.sweepOrphanedUploads()).resolves.toBe(1);

    const [row] = await elevated.db.select().from(attachments).where(eq(attachments.id, body.id));
    expect(row?.deletedAt).toBeInstanceOf(Date);
    expect(await objectExists(created.stored.objectKey!)).toBe(false);
  });

  it('⭐ deletes the REAL uploaded object for a stale pending row (PUT happened, finalize never did)', async () => {
    const { userId, farmId } = await tenant('PutNoFinalize');
    const animalId = await anAnimal(farmId);
    const bytes = Buffer.from('uploaded, then the app never came back to finalize it');
    const body = attachmentBody(farmId, animalId, bytes);
    const created = await service.createAttachment(userId, body);
    const putRes = await putRealBytes(created.uploadUrl!, created.checksumHeaderValue!, bytes);
    expect(putRes.status).toBe(200);
    expect(await objectExists(created.stored.objectKey!)).toBe(true);
    await backdate(body.id);

    await expect(sweep.sweepOrphanedUploads()).resolves.toBe(1);

    expect(await objectExists(created.stored.objectKey!)).toBe(false);
    const [row] = await elevated.db.select().from(attachments).where(eq(attachments.id, body.id));
    expect(row?.deletedAt).toBeInstanceOf(Date);
  });

  it('leaves a RECENT pending row untouched', async () => {
    const { userId, farmId } = await tenant('Recent');
    const animalId = await anAnimal(farmId);
    const body = attachmentBody(farmId, animalId, Buffer.from('captured moments ago'));
    await service.createAttachment(userId, body);
    // No backdate — this row is exactly as fresh as the moment it was created.

    await expect(sweep.sweepOrphanedUploads()).resolves.toBe(0);

    const [row] = await elevated.db.select().from(attachments).where(eq(attachments.id, body.id));
    expect(row?.deletedAt).toBeNull();
  });

  it('leaves an old FINALISED row untouched — only `pending` is an orphan', async () => {
    const { userId, farmId } = await tenant('OldFinalised');
    const animalId = await anAnimal(farmId);
    const bytes = Buffer.from('a completed capture, just an old one');
    const body = attachmentBody(farmId, animalId, bytes);
    const created = await service.createAttachment(userId, body);
    await putRealBytes(created.uploadUrl!, created.checksumHeaderValue!, bytes);
    await service.finalizeAttachment(userId, { id: body.id, farmId });
    await backdate(body.id);

    await expect(sweep.sweepOrphanedUploads()).resolves.toBe(0);

    const [row] = await elevated.db.select().from(attachments).where(eq(attachments.id, body.id));
    expect(row?.deletedAt).toBeNull();
    expect(row?.status).toBe('finalised');
    expect(await objectExists(created.stored.objectKey!)).toBe(true);
  });

  it('⭐ a device that reconnects AFTER the sweep can still finish the exact same capture', async () => {
    // The safety claim this module's own header makes: soft-deleting the row and releasing the
    // object does not strand a device that genuinely comes back late (a long dead zone, not
    // abandonment) — offline-sync.md's "the write queue is never bounded and never evicted" holds
    // for the CLIENT side regardless of what a server-side hygiene sweep does to its own metadata.
    const { userId, farmId } = await tenant('LateRetry');
    const animalId = await anAnimal(farmId);
    const bytes = Buffer.from('captured offline, retried a week later');
    const body = attachmentBody(farmId, animalId, bytes);
    await service.createAttachment(userId, body);
    await backdate(body.id);
    await sweep.sweepOrphanedUploads();

    // The device is still holding the blob locally (3i(c)'s own rule) and retries the whole send:
    // create (fresh presign) → PUT → finalize.
    const retried = await service.createAttachment(userId, body);
    expect(retried.uploadUrl).not.toBeNull();
    const putRes = await putRealBytes(retried.uploadUrl!, retried.checksumHeaderValue!, bytes);
    expect(putRes.status).toBe(200);
    const finalized = await service.finalizeAttachment(userId, { id: body.id, farmId });
    expect(finalized.status).toBe('finalised');
    expect(finalized.checksum).toBe(sha256Hex(bytes));
  });

  it('is idempotent — re-running the sweep with nothing new to find does nothing', async () => {
    const { userId, farmId } = await tenant('SweepTwice');
    const animalId = await anAnimal(farmId);
    const body = attachmentBody(farmId, animalId, Buffer.from('swept once already'));
    await service.createAttachment(userId, body);
    await backdate(body.id);

    await expect(sweep.sweepOrphanedUploads()).resolves.toBe(1);
    await expect(sweep.sweepOrphanedUploads()).resolves.toBe(0);
  });
});
