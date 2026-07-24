/**
 * Weight capture against a real Postgres (FR-140). The interesting cases are the ones a
 * mock cannot see: the append-only row physically lands under the farm's RLS boundary, the
 * two clocks (occurred_at vs created_at) stay distinct, and a caller who is not a capturing
 * member of the farm is refused — as a stranger indistinguishably from a non-existent farm,
 * as a wrong-role member with a role refusal that says so. We never mock the DB (CLAUDE.md).
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import type { input as ZodInput } from 'zod';
import { Test } from '@nestjs/testing';
import { JwtModule } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import {
  animals,
  createAppDb,
  createElevatedDb,
  events,
  farmUsers,
  mobs,
  users,
  type AppDb,
  type ElevatedDb,
} from '@werf/db';
import { startWerfTestDatabase, type WerfTestDatabase } from '@werf/db/testing';
import { NotFoundError, TenancyError, ValidationError, schemas } from '@werf/core';
import { APP_CONFIG, APP_DB, ELEVATED_DB } from '../db/db.module';
import { AuthService } from '../auth/auth.service';
import { SessionService } from '../auth/session.service';
import { TokenService } from '../auth/token.service';
import { TwoFactorService } from '../auth/two-factor.service';
import { PasskeyService } from '../auth/passkey.service';
import { RecoveryCodeService } from '../auth/recovery-code.service';
import { LivestockService } from './livestock.service';

const BOOT_TIMEOUT_MS = 180_000;

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

/** A minimal valid weight capture body; overlay the fields a test cares about. Overrides are
 *  the schema's INPUT shape (occurredAt is an ISO string here, a Date after parse). */
const weightBody = (
  over: Partial<ZodInput<typeof schemas.recordWeightRequestSchema>>,
): schemas.RecordWeightRequest =>
  schemas.recordWeightRequestSchema.parse({
    id: randomUUID(),
    farmId: over.farmId,
    occurredAt: '2026-07-20T06:00:00.000Z',
    kg: 412.5,
    method: 'scale',
    ...over,
  });

/** A minimal valid animal-create body; overlay the fields a test cares about. */
const animalBody = (
  over: Partial<ZodInput<typeof schemas.recordAnimalRequestSchema>>,
): schemas.RecordAnimalRequest =>
  schemas.recordAnimalRequestSchema.parse({
    id: randomUUID(),
    farmId: over.farmId,
    species: 'cattle',
    sex: 'female',
    ...over,
  });

/** A minimal valid death body; overlay the fields a test cares about. */
const deathBody = (
  over: Partial<ZodInput<typeof schemas.recordDeathRequestSchema>>,
): schemas.RecordDeathRequest =>
  schemas.recordDeathRequestSchema.parse({
    id: randomUUID(),
    farmId: over.farmId,
    animalId: over.animalId,
    occurredAt: '2026-07-20T06:00:00.000Z',
    cause: 'Drought',
    ...over,
  });

/** A minimal valid sale body; overlay the fields a test cares about. `priceCents` is Money. */
const saleBody = (
  over: Partial<ZodInput<typeof schemas.recordSaleRequestSchema>>,
): schemas.RecordSaleRequest =>
  schemas.recordSaleRequestSchema.parse({
    id: randomUUID(),
    farmId: over.farmId,
    animalId: over.animalId,
    occurredAt: '2026-07-20T06:00:00.000Z',
    counterparty: 'Senekal Abattoir',
    priceCents: 1_250_000,
    ...over,
  });

describe('weight capture (FR-140)', () => {
  let pg: WerfTestDatabase;
  let app: AppDb;
  let elevated: ElevatedDb;
  let auth: AuthService;
  let service: LivestockService;

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
        LivestockService,
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
    service = moduleRef.get(LivestockService);
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

  /** A single animal on the farm, so an animal-scoped weight has a real subject to point at. */
  async function anAnimal(farmId: string): Promise<string> {
    const [row] = await elevated.db
      .insert(animals)
      .values({ farmId, species: 'cattle', sex: 'female' })
      .returning();
    return row!.id;
  }

  /** A mob on the farm, for the group-weight path. */
  async function aMob(farmId: string): Promise<string> {
    const [row] = await elevated.db
      .insert(mobs)
      .values({ farmId, name: 'Flock A', species: 'sheep', headCount: 300 })
      .returning();
    return row!.id;
  }

  it('records an animal weight as an append-only event on the farm', async () => {
    const a = await tenant('Alpha');
    const animalId = await anAnimal(a.farmId);

    const captured = await service.recordWeight(
      a.userId,
      weightBody({ farmId: a.farmId, animalId, kg: 418, method: 'scale' }),
    );

    expect(captured.type).toBe('weight');
    expect(captured.payload).toEqual({ kg: 418, method: 'scale' });
    expect(captured.animalId).toBe(animalId);
    expect(captured.createdBy).toBe(a.userId);

    // It is genuinely persisted and readable back through the farm's RLS scope.
    const seen = await app.asUser(a.userId, (tx) => tx.select().from(events));
    expect(seen.map((e) => e.id)).toContain(captured.id);
  });

  it('keeps occurred_at (farm time) distinct from created_at (row written)', async () => {
    // Weighed in a dead zone a week ago; the row is written now. A report reads occurred_at.
    const a = await tenant('Alpha');
    const animalId = await anAnimal(a.farmId);

    const captured = await service.recordWeight(
      a.userId,
      weightBody({ farmId: a.farmId, animalId, occurredAt: '2026-07-13T05:30:00.000Z' }),
    );

    expect(captured.occurredAt.toISOString()).toBe('2026-07-13T05:30:00.000Z');
    expect(captured.occurredAt.getTime()).toBeLessThan(captured.createdAt.getTime());
  });

  it('records a mob/flock weight taken across a group with no individual rows', async () => {
    const a = await tenant('Alpha');
    const mobId = await aMob(a.farmId);

    const captured = await service.recordWeight(
      a.userId,
      weightBody({ farmId: a.farmId, mobId, kg: 55.2, method: 'scale' }),
    );

    expect(captured.mobId).toBe(mobId);
    expect(captured.animalId).toBeNull();
    expect(captured.payload).toEqual({ kg: 55.2, method: 'scale' });
  });

  it('refuses a capture that names neither an animal nor a mob', async () => {
    const a = await tenant('Alpha');

    await expect(service.recordWeight(a.userId, weightBody({ farmId: a.farmId }))).rejects.toThrow(
      ValidationError,
    );

    const written = await app.asUser(a.userId, (tx) => tx.select().from(events));
    expect(written).toHaveLength(0);
  });

  it('refuses a capture that names both an animal and a mob', async () => {
    const a = await tenant('Alpha');
    const animalId = await anAnimal(a.farmId);
    const mobId = await aMob(a.farmId);

    await expect(
      service.recordWeight(a.userId, weightBody({ farmId: a.farmId, animalId, mobId })),
    ).rejects.toThrow(ValidationError);
  });

  it('refuses a stranger, exactly as if the farm did not exist — and writes nothing', async () => {
    const a = await tenant('Alpha');
    const b = await tenant('Bravo');
    const animalId = await anAnimal(a.farmId);

    // Bravo's owner naming Alpha's farm must not learn it exists, and must not plant a row in it.
    await expect(
      service.recordWeight(b.userId, weightBody({ farmId: a.farmId, animalId })),
    ).rejects.toThrow(NotFoundError);

    const onAlpha = await app.asUser(a.userId, (tx) => tx.select().from(events));
    expect(onAlpha).toHaveLength(0);
  });

  it('refuses a member whose role does not permit capture', async () => {
    const a = await tenant('Alpha');
    const animalId = await anAnimal(a.farmId);

    // A viewer is genuinely on the farm — so this is a ROLE refusal, not a tenancy one, and
    // it must say so rather than pretending the farm does not exist.
    const [viewer] = await elevated.db
      .insert(users)
      .values({ email: 'viewer@werf.test', fullName: 'Read Only' })
      .returning();
    await elevated.db.insert(farmUsers).values({
      farmId: a.farmId,
      userId: viewer!.id,
      role: 'viewer',
      invitedAt: new Date(),
      acceptedAt: new Date(),
    });

    await expect(
      service.recordWeight(viewer!.id, weightBody({ farmId: a.farmId, animalId })),
    ).rejects.toThrow(TenancyError);
  });

  // ── Animal creation (FR-101) — the FK root the flush sends first ──────────────────────
  describe('animal creation (FR-101)', () => {
    it('creates a herd row on the farm, readable back through RLS, authored by the caller', async () => {
      const a = await tenant('Alpha');

      const created = await service.recordAnimal(
        a.userId,
        animalBody({ farmId: a.farmId, species: 'cattle', sex: 'male', breed: 'Bonsmara' }),
      );

      expect(created.species).toBe('cattle');
      expect(created.breed).toBe('Bonsmara');
      expect(created.status).toBe('alive');
      expect(created.createdBy).toBe(a.userId);

      const seen = await app.asUser(a.userId, (tx) => tx.select().from(animals));
      expect(seen.map((row) => row.id)).toContain(created.id);
    });

    it('is idempotent: re-sending the same id returns the stored row, never a duplicate', async () => {
      // A flush is at-least-once — a POST whose 201 was lost is retried on the next reconnect.
      const a = await tenant('Alpha');
      const body = animalBody({ farmId: a.farmId, breed: 'Nguni' });

      const first = await service.recordAnimal(a.userId, body);
      const second = await service.recordAnimal(a.userId, body);

      expect(second.id).toBe(first.id);
      expect(second.breed).toBe('Nguni');
      const rows = await app.asUser(a.userId, (tx) => tx.select().from(animals));
      expect(rows).toHaveLength(1);
    });

    it('refuses a stranger, exactly as if the farm did not exist — and writes nothing', async () => {
      const a = await tenant('Alpha');
      const b = await tenant('Bravo');

      await expect(
        service.recordAnimal(b.userId, animalBody({ farmId: a.farmId })),
      ).rejects.toThrow(NotFoundError);

      const onAlpha = await app.asUser(a.userId, (tx) => tx.select().from(animals));
      expect(onAlpha).toHaveLength(0);
    });

    it('refuses a member whose role does not permit capture', async () => {
      const a = await tenant('Alpha');
      const [viewer] = await elevated.db
        .insert(users)
        .values({ email: 'viewer-animal@werf.test', fullName: 'Read Only' })
        .returning();
      await elevated.db.insert(farmUsers).values({
        farmId: a.farmId,
        userId: viewer!.id,
        role: 'viewer',
        invitedAt: new Date(),
        acceptedAt: new Date(),
      });

      await expect(
        service.recordAnimal(viewer!.id, animalBody({ farmId: a.farmId })),
      ).rejects.toThrow(TenancyError);
    });
  });

  // ── Death (FR-105) ──────────────────────────────────────────────────────────────────
  describe('death capture (FR-105)', () => {
    it('records a death as an append-only event against a live animal', async () => {
      const a = await tenant('Alpha');
      const animalId = await anAnimal(a.farmId);

      const captured = await service.recordDeath(
        a.userId,
        deathBody({ farmId: a.farmId, animalId, cause: 'Snakebite' }),
      );

      expect(captured.type).toBe('death');
      expect(captured.payload).toEqual({ cause: 'Snakebite' });
      expect(captured.animalId).toBe(animalId);
      expect(captured.createdBy).toBe(a.userId);
    });

    it('is idempotent: a re-flushed death does not duplicate the event', async () => {
      const a = await tenant('Alpha');
      const animalId = await anAnimal(a.farmId);
      const body = deathBody({ farmId: a.farmId, animalId });

      const first = await service.recordDeath(a.userId, body);
      const second = await service.recordDeath(a.userId, body);

      expect(second.id).toBe(first.id);
      const events_ = await app.asUser(a.userId, (tx) => tx.select().from(events));
      expect(events_).toHaveLength(1);
    });

    it('refuses a death against an animal the farm cannot see — and writes nothing', async () => {
      // The animal is on another farm (or does not exist): the RLS-scoped status lookup finds
      // nothing, so this is a 404, indistinguishable from a non-existent animal. The event that
      // would have FK-referenced it never lands.
      const a = await tenant('Alpha');

      await expect(
        service.recordDeath(a.userId, deathBody({ farmId: a.farmId, animalId: randomUUID() })),
      ).rejects.toThrow(NotFoundError);

      const written = await app.asUser(a.userId, (tx) => tx.select().from(events));
      expect(written).toHaveLength(0);
    });
  });

  // ── Sale (FR-106) ───────────────────────────────────────────────────────────────────
  describe('sale capture (FR-106)', () => {
    it('records a sale as an append-only event, with Money as integer cents', async () => {
      const a = await tenant('Alpha');
      const animalId = await anAnimal(a.farmId);

      const captured = await service.recordSale(
        a.userId,
        saleBody({
          farmId: a.farmId,
          animalId,
          counterparty: 'Vrystaat Vleis',
          priceCents: 1_875_00,
        }),
      );

      expect(captured.type).toBe('sale');
      expect(captured.payload).toEqual({ counterparty: 'Vrystaat Vleis', priceCents: 187_500 });
      expect(captured.animalId).toBe(animalId);
    });

    it('carries an optional sale weight onto the event when captured', async () => {
      const a = await tenant('Alpha');
      const animalId = await anAnimal(a.farmId);

      const captured = await service.recordSale(
        a.userId,
        saleBody({ farmId: a.farmId, animalId, weightKg: 465.5 }),
      );

      expect(captured.payload).toMatchObject({ weightKg: 465.5 });
    });
  });
});
