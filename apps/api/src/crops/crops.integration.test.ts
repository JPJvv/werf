/**
 * Planting capture against a real Postgres (FR-203). The cases a mock cannot see: the migration
 * really did add 'planting' to the partitioned `events` type, a planting lands under the farm's RLS
 * boundary scoped to the BLOCK rather than a herd (`insertEvent` refuses anything naming neither —
 * `planting` has to be a real, working `FARM_SCOPED_EVENT_TYPES` escape, not just a compiling one),
 * the block reference is genuinely checked (a planting against another farm's block, or no block at
 * all, is refused), the two clocks stay distinct, and a re-flush does not double the record. We
 * never mock the DB (CLAUDE.md).
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { input as ZodInput } from 'zod';
import { Test } from '@nestjs/testing';
import { JwtModule } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import {
  createAppDb,
  createElevatedDb,
  events,
  farmUsers,
  users,
  type AppDb,
  type ElevatedDb,
} from '@werf/db';
import { startWerfTestDatabase, type WerfTestDatabase } from '@werf/db/testing';
import { NotFoundError, TenancyError, schemas, uuidv7 } from '@werf/core';
import { APP_CONFIG, APP_DB, ELEVATED_DB } from '../db/db.module';
import { AuthService } from '../auth/auth.service';
import { SessionService } from '../auth/session.service';
import { TokenService } from '../auth/token.service';
import { TwoFactorService } from '../auth/two-factor.service';
import { PasskeyService } from '../auth/passkey.service';
import { RecoveryCodeService } from '../auth/recovery-code.service';
import { LandService } from '../land/land.service';
import { CropsService } from './crops.service';

const BOOT_TIMEOUT_MS = 180_000;

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
    enterpriseTypes: ['row_crops'],
  },
  owner: {
    fullName: `${label} Owner`,
    email: `${label.toLowerCase()}@werf.test`,
    password: 'correct horse battery staple',
    locale: 'en-ZA',
    theme: 'light',
  },
});

/** A minimal valid block. */
const blockBody = (over: Partial<schemas.NewLandUnit> & { farmId: string }): schemas.NewLandUnit =>
  schemas.newLandUnitSchema.parse({
    id: uuidv7(),
    kind: 'block',
    code: 'B12',
    ...over,
  });

/** A minimal valid planting body; overlay the fields a test cares about. Overrides are the schema's
 *  INPUT shape (occurredAt is an ISO string here, a Date after parse). */
const plantingBody = (
  over: Partial<ZodInput<typeof schemas.recordPlantingRequestSchema>> & {
    farmId: string;
    landUnitId: string;
  },
): schemas.RecordPlantingRequest =>
  schemas.recordPlantingRequestSchema.parse({
    id: uuidv7(),
    occurredAt: '2026-09-14T04:30:00.000Z',
    crop: 'Maize',
    ...over,
  });

describe('planting capture (FR-203)', () => {
  let pg: WerfTestDatabase;
  let app: AppDb;
  let elevated: ElevatedDb;
  let auth: AuthService;
  let land: LandService;
  let service: CropsService;

  beforeAll(async () => {
    pg = await startWerfTestDatabase();
    app = createAppDb({ url: pg.appUrl });
    elevated = createElevatedDb({ url: pg.elevatedUrl });

    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      providers: [
        AuthService,
        SessionService,
        TokenService,
        TwoFactorService,
        PasskeyService,
        RecoveryCodeService,
        LandService,
        CropsService,
        {
          provide: APP_CONFIG,
          useValue: {
            port: 3000,
            databaseUrl: pg.appUrl,
            databaseElevatedUrl: pg.elevatedUrl,
            jwtSecret: 'test-signing-key-that-is-long-enough-32',
            piiEncryptionKey: randomBytes(32).toString('base64'),
          },
        },
        { provide: APP_DB, useValue: app },
        { provide: ELEVATED_DB, useValue: elevated },
      ],
    }).compile();

    auth = moduleRef.get(AuthService);
    land = moduleRef.get(LandService);
    service = moduleRef.get(CropsService);
  }, BOOT_TIMEOUT_MS);

  afterEach(async () => {
    await pg.reset();
  });

  afterAll(async () => {
    await app?.close();
    await elevated?.close();
    await pg?.stop();
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

  /** A real block this tenant's owner has already created, ready to plant in. */
  async function block(a: { userId: string; farmId: string }) {
    const created = await land.createLandUnit(a.userId, blockBody({ farmId: a.farmId }));
    return created.id;
  }

  it('records a planting as an append-only event scoped to the BLOCK, not a herd', async () => {
    const a = await tenant('Crop');
    const landUnitId = await block(a);

    const captured = await service.recordPlanting(
      a.userId,
      plantingBody({ farmId: a.farmId, landUnitId, cultivar: 'PAN 6479' }),
    );

    expect(captured.type).toBe('planting');
    expect(captured.payload).toEqual({ crop: 'Maize', cultivar: 'PAN 6479' });
    expect(captured.landUnitId).toBe(landUnitId);
    expect(captured.createdBy).toBe(a.userId);
    // The FR-113 exception: a planting names the block it is IN, never a herd.
    expect(captured.enterpriseId).toBeNull();
    expect(captured.animalId).toBeNull();
    expect(captured.mobId).toBeNull();

    // Genuinely persisted and readable back through the farm's RLS scope.
    const seen = await app.asUser(a.userId, (tx) => tx.select().from(events));
    expect(seen.map((e) => e.id)).toContain(captured.id);
  });

  it('keeps occurred_at (the planted date) distinct from created_at (row written)', async () => {
    const a = await tenant('Crop');
    const landUnitId = await block(a);

    const captured = await service.recordPlanting(
      a.userId,
      plantingBody({
        farmId: a.farmId,
        landUnitId,
        occurredAt: '2026-08-01T04:00:00.000Z',
      }),
    );

    expect(captured.occurredAt.toISOString()).toBe('2026-08-01T04:00:00.000Z');
    expect(captured.occurredAt.getTime()).toBeLessThan(captured.createdAt.getTime());
  });

  it('is idempotent on the client id, so a re-flush does not create a second planting', async () => {
    const a = await tenant('Crop');
    const landUnitId = await block(a);
    const body = plantingBody({ farmId: a.farmId, landUnitId });

    const first = await service.recordPlanting(a.userId, body);
    const again = await service.recordPlanting(a.userId, body);

    expect(again.id).toBe(first.id);
    const rows = await app.asUser(a.userId, (tx) => tx.select().from(events));
    expect(rows).toHaveLength(1);
  });

  it('refuses a planting against a block that does not exist on this farm', async () => {
    const a = await tenant('Crop');

    await expect(
      service.recordPlanting(a.userId, plantingBody({ farmId: a.farmId, landUnitId: uuidv7() })),
    ).rejects.toThrow(NotFoundError);

    const rows = await elevated.db.select().from(events);
    expect(rows).toHaveLength(0);
  });

  it("refuses a planting against ANOTHER farm's block — a cross-tenant reference, not a real one", async () => {
    const a = await tenant('Crop');
    const b = await tenant('Other');
    const othersBlock = await block(b);

    await expect(
      service.recordPlanting(a.userId, plantingBody({ farmId: a.farmId, landUnitId: othersBlock })),
    ).rejects.toThrow(NotFoundError);

    const rows = await elevated.db.select().from(events);
    expect(rows).toHaveLength(0);
  });

  it('refuses a stranger as "no such farm" and writes nothing', async () => {
    const a = await tenant('Crop');
    const b = await tenant('Other');
    const landUnitId = await block(a);

    await expect(
      service.recordPlanting(b.userId, plantingBody({ farmId: a.farmId, landUnitId })),
    ).rejects.toThrow(NotFoundError);

    const rows = await elevated.db.select().from(events);
    expect(rows).toHaveLength(0);
  });

  it('refuses a real member whose role may not capture, and says so', async () => {
    const a = await tenant('Crop');
    const landUnitId = await block(a);
    const b = await tenant('Viewer');
    // A genuine, accepted membership — but read-only. This must be a role refusal, not a 404.
    await elevated.db.insert(farmUsers).values({
      farmId: a.farmId,
      userId: b.userId,
      role: 'viewer',
      invitedAt: new Date(),
      acceptedAt: new Date(),
    });

    await expect(
      service.recordPlanting(b.userId, plantingBody({ farmId: a.farmId, landUnitId })),
    ).rejects.toThrow(TenancyError);

    const rows = await elevated.db.select().from(events);
    expect(rows).toHaveLength(0);
  });
});
