/**
 * Rainfall capture against a real Postgres (FR-213). The cases a mock cannot see: the migration
 * really did add 'rainfall' to the partitioned `events` type (an enum value the DB does not know
 * fails at insert, not at compile), the reading lands under the farm's RLS boundary scoped to the
 * FARM rather than a herd, the two clocks stay distinct, a re-flush does not double a month's
 * total, and a non-capturing caller is refused. We never mock the DB (CLAUDE.md).
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
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
import { NotFoundError, TenancyError, schemas } from '@werf/core';
import { APP_CONFIG, APP_DB, ELEVATED_DB } from '../db/db.module';
import { AuthService } from '../auth/auth.service';
import { SessionService } from '../auth/session.service';
import { TokenService } from '../auth/token.service';
import { TwoFactorService } from '../auth/two-factor.service';
import { PasskeyService } from '../auth/passkey.service';
import { RecoveryCodeService } from '../auth/recovery-code.service';
import { RainfallService } from './rainfall.service';

const BOOT_TIMEOUT_MS = 180_000;

const registration = (label: string): schemas.RegisterRequest => ({
  business: { name: `${label} Boerdery`, registrationNumber: null },
  farm: {
    name: `${label} Plaas`,
    province: 'Free State',
    district: null,
    // A MIXED farm on purpose: rain is the one event both enterprises read, so the farm that
    // proves it should be the one that would be broken by filing the reading under a herd.
    enterpriseTypes: ['beef_cattle', 'row_crops'],
  },
  owner: {
    fullName: `${label} Owner`,
    email: `${label.toLowerCase()}@werf.test`,
    password: 'correct horse battery staple',
    locale: 'en-ZA',
    theme: 'light',
  },
});

/** A minimal valid rainfall body; overlay the fields a test cares about. Overrides are the
 *  schema's INPUT shape (occurredAt is an ISO string here, a Date after parse). */
const rainfallBody = (
  over: Partial<ZodInput<typeof schemas.recordRainfallRequestSchema>>,
): schemas.RecordRainfallRequest =>
  schemas.recordRainfallRequestSchema.parse({
    id: randomUUID(),
    farmId: over.farmId,
    occurredAt: '2026-03-02T04:10:00.000Z',
    mm: 18.5,
    ...over,
  });

describe('rainfall capture (FR-213)', () => {
  let pg: WerfTestDatabase;
  let app: AppDb;
  let elevated: ElevatedDb;
  let auth: AuthService;
  let service: RainfallService;

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
        RainfallService,
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
    service = moduleRef.get(RainfallService);
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

  it('records a gauge reading as an append-only event scoped to the FARM, not a herd', async () => {
    const a = await tenant('Rain');

    const captured = await service.recordRainfall(
      a.userId,
      rainfallBody({ farmId: a.farmId, mm: 22, gauge: 'Homestead' }),
    );

    expect(captured.type).toBe('rainfall');
    expect(captured.payload).toEqual({ mm: 22, gauge: 'Homestead' });
    expect(captured.createdBy).toBe(a.userId);
    // The FR-113 exception: rain belongs to the farm. Filing it under the cattle enterprise would
    // hide it from this same farm's maize side.
    expect(captured.enterpriseId).toBeNull();
    expect(captured.animalId).toBeNull();
    expect(captured.mobId).toBeNull();

    // Genuinely persisted and readable back through the farm's RLS scope.
    const seen = await app.asUser(a.userId, (tx) => tx.select().from(events));
    expect(seen.map((e) => e.id)).toContain(captured.id);
  });

  it('keeps a dry gauge (0 mm) as a real reading', async () => {
    // "I looked on Tuesday and it was empty" is what separates a drought from a farmer who did
    // not look. The reading has to survive all the way to the row, not just the domain function.
    const a = await tenant('Rain');

    const captured = await service.recordRainfall(
      a.userId,
      rainfallBody({ farmId: a.farmId, mm: 0 }),
    );

    expect(captured.payload).toEqual({ mm: 0 });
  });

  it('keeps occurred_at (when the gauge was read) distinct from created_at (row written)', async () => {
    const a = await tenant('Rain');

    const captured = await service.recordRainfall(
      a.userId,
      rainfallBody({ farmId: a.farmId, occurredAt: '2026-02-24T04:00:00.000Z' }),
    );

    expect(captured.occurredAt.toISOString()).toBe('2026-02-24T04:00:00.000Z');
    expect(captured.occurredAt.getTime()).toBeLessThan(captured.createdAt.getTime());
  });

  it('is idempotent on the client id, so a re-flush does not double the month total', async () => {
    const a = await tenant('Rain');
    const body = rainfallBody({ farmId: a.farmId, mm: 31 });

    const first = await service.recordRainfall(a.userId, body);
    const again = await service.recordRainfall(a.userId, body);

    expect(again.id).toBe(first.id);
    const rows = await app.asUser(a.userId, (tx) => tx.select().from(events));
    expect(rows).toHaveLength(1);
  });

  it('refuses a stranger as "no such farm" and writes nothing', async () => {
    const a = await tenant('Rain');
    const b = await tenant('Other');

    await expect(
      service.recordRainfall(b.userId, rainfallBody({ farmId: a.farmId })),
    ).rejects.toThrow(NotFoundError);

    const rows = await elevated.db.select().from(events);
    expect(rows).toHaveLength(0);
  });

  it('refuses a real member whose role may not capture, and says so', async () => {
    const a = await tenant('Rain');
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
      service.recordRainfall(b.userId, rainfallBody({ farmId: a.farmId })),
    ).rejects.toThrow(TenancyError);

    const rows = await elevated.db.select().from(events);
    expect(rows).toHaveLength(0);
  });
});
