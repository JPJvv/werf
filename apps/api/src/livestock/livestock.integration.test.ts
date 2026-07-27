/**
 * Weight capture against a real Postgres (FR-140). The interesting cases are the ones a
 * mock cannot see: the append-only row physically lands under the farm's RLS boundary, the
 * two clocks (occurred_at vs created_at) stay distinct, and a caller who is not a capturing
 * member of the farm is refused — as a stranger indistinguishably from a non-existent farm,
 * as a wrong-role member with a role refusal that says so. We never mock the DB (CLAUDE.md).
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import type { input as ZodInput } from 'zod';
import { Test } from '@nestjs/testing';
import { JwtModule } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import {
  animalIdentifiers,
  animals,
  brandingRegisters,
  createAppDb,
  createElevatedDb,
  enterprises,
  events,
  farmUsers,
  landUnits,
  mobs,
  theftIncidentAnimals,
  theftIncidents,
  users,
  veterinaryProducts,
  type AppDb,
  type ElevatedDb,
} from '@werf/db';
import { startWerfTestDatabase, type WerfTestDatabase } from '@werf/db/testing';
import {
  ConflictError,
  NotFoundError,
  TenancyError,
  ValidationError,
  schemas,
  uuidv7,
} from '@werf/core';
import { APP_CONFIG, APP_DB, ELEVATED_DB } from '../db/db.module';
import { renderEvidencePackPdf } from './evidence-pack.pdf';
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

/** A minimal valid treatment body; overlay the fields a test cares about. */
const treatmentBody = (
  over: Partial<ZodInput<typeof schemas.recordTreatmentRequestSchema>>,
): schemas.RecordTreatmentRequest =>
  schemas.recordTreatmentRequestSchema.parse({
    id: randomUUID(),
    farmId: over.farmId,
    animalId: over.animalId,
    occurredAt: '2026-07-20T06:00:00.000Z',
    administeredOn: '2026-07-20',
    productId: over.productId,
    ...over,
  });

/** A minimal valid vaccination body. */
const vaccinationBody = (
  over: Partial<ZodInput<typeof schemas.recordVaccinationRequestSchema>>,
): schemas.RecordVaccinationRequest =>
  schemas.recordVaccinationRequestSchema.parse({
    id: randomUUID(),
    farmId: over.farmId,
    animalId: over.animalId,
    occurredAt: '2026-07-20T06:00:00.000Z',
    administeredOn: '2026-07-20',
    productId: over.productId,
    ...over,
  });

/** A minimal valid dip body. */
const dipBody = (
  over: Partial<ZodInput<typeof schemas.recordDipRequestSchema>>,
): schemas.RecordDipRequest =>
  schemas.recordDipRequestSchema.parse({
    id: randomUUID(),
    farmId: over.farmId,
    animalId: over.animalId,
    occurredAt: '2026-07-20T06:00:00.000Z',
    administeredOn: '2026-07-20',
    productId: over.productId,
    ...over,
  });

/** A minimal valid theft-incident body. */
const theftIncidentBody = (
  over: Partial<ZodInput<typeof schemas.newTheftIncidentSchema>>,
): schemas.NewTheftIncident =>
  schemas.newTheftIncidentSchema.parse({
    id: randomUUID(),
    farmId: over.farmId,
    discoveredAt: '2026-07-24T04:00:00.000Z',
    headCount: 2,
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

  /** A mob on the farm, for the group-weight and tally paths. `initial_head_count` is set alongside
   *  `head_count` exactly as `recordMob` does it — the baseline the tally fold starts from. */
  async function aMob(farmId: string): Promise<string> {
    const [row] = await elevated.db
      .insert(mobs)
      .values({ farmId, name: 'Flock A', species: 'sheep', headCount: 300, initialHeadCount: 300 })
      .returning();
    return row!.id;
  }

  /** A ZA veterinary product — reference data, written by the elevated admin path, never a farmer.
   *  Defaults to a meat-28-day / milk-96-hour antibiotic; overlay the withdrawal a test cares about. */
  async function aVetProduct(
    over: Partial<typeof veterinaryProducts.$inferInsert> = {},
  ): Promise<string> {
    const [row] = await elevated.db
      .insert(veterinaryProducts)
      .values({
        jurisdiction: 'ZA',
        name: 'Synthamycin LA (test)',
        activeIngredients: ['oxytetracycline'],
        species: ['cattle'],
        meatWithdrawalDays: 28,
        milkWithdrawalHours: 96,
        effectiveFrom: '2020-01-01',
        ...over,
      })
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

  // ── Mobs (FR-102) ───────────────────────────────────────────────────────────────────
  describe('species-specific attributes (FR-107)', () => {
    it('stores the attributes the species actually has', async () => {
      const a = await tenant('Alpha');

      const animal = await service.recordAnimal(
        a.userId,
        animalBody({ farmId: a.farmId, species: 'cattle', attributes: { hornStatus: 'polled' } }),
      );

      expect(animal.attributes).toEqual({ hornStatus: 'polled' });
    });

    it('⭐ refuses an attribute the species does not have, and stores no row', async () => {
      // One `animals` table for every species (ADR-0004) means the column cannot enforce this, and
      // an unvalidated JSONB column is where typos accumulate quietly for a year.
      const a = await tenant('Alpha');

      await expect(
        service.recordAnimal(
          a.userId,
          animalBody({ farmId: a.farmId, species: 'cattle', attributes: { woolClass: 'BFY' } }),
        ),
      ).rejects.toThrow(ValidationError);

      const rows = await app.asUser(a.userId, (tx) => tx.select().from(animals));
      expect(rows).toHaveLength(0);
    });

    it('accepts an animal with no attributes at all, on any species', async () => {
      const a = await tenant('Alpha');

      const animal = await service.recordAnimal(
        a.userId,
        animalBody({ farmId: a.farmId, species: 'pig' }),
      );

      expect(animal.attributes).toEqual({});
    });
  });

  describe('mob creation (FR-102)', () => {
    const mobBody = (over: Partial<schemas.NewMob> & { farmId: string }): schemas.NewMob =>
      schemas.newMobSchema.parse({
        id: randomUUID(),
        name: 'Flock A',
        species: 'sheep',
        headCount: 300,
        ...over,
      });

    /** A camp on the farm, so a mob has somewhere to be. */
    async function aCamp(farmId: string, code = 'Camp 1'): Promise<string> {
      const [row] = await elevated.db
        .insert(landUnits)
        .values({ farmId, kind: 'camp', code })
        .returning();
      return row!.id;
    }

    it('is a complete record with ZERO animal rows behind it', async () => {
      // The whole point of FR-102: a farmer with 300 sheep does not have 300 ear tags, and
      // demanding individual rows before the app is useful loses the user it was built for.
      const a = await tenant('Alpha');

      const mob = await service.recordMob(a.userId, mobBody({ farmId: a.farmId, headCount: 300 }));

      expect(mob.headCount).toBe(300);
      expect(mob.name).toBe('Flock A');
      expect(mob.createdBy).toBe(a.userId);

      const individuals = await app.asUser(a.userId, (tx) => tx.select().from(animals));
      expect(individuals).toHaveLength(0);
    });

    it('is idempotent on the client id, so a re-flush does not double the flock', async () => {
      const a = await tenant('Alpha');
      const body = mobBody({ farmId: a.farmId });

      const first = await service.recordMob(a.userId, body);
      const again = await service.recordMob(a.userId, body);

      expect(again.id).toBe(first.id);
      const rows = await app.asUser(a.userId, (tx) => tx.select().from(mobs));
      expect(rows).toHaveLength(1);
    });

    it('puts a mob in a camp on its OWN farm, and refuses a neighbour’s camp', async () => {
      // ⭐ The hole neither the foreign key nor RLS catches: `mobs.land_unit_id` references
      // land_units(id) with no farm qualifier, and Postgres runs referential checks as the system,
      // so RLS does not filter them. Without the explicit check this insert succeeds — right farm
      // on the row, real FK target, every policy satisfied — and quietly points across a tenancy
      // boundary.
      const a = await tenant('Alpha');
      const b = await tenant('Bravo');
      const alphasCamp = await aCamp(a.farmId);
      const bravosCamp = await aCamp(b.farmId);

      const ours = await service.recordMob(
        a.userId,
        mobBody({ farmId: a.farmId, landUnitId: alphasCamp }),
      );
      expect(ours.landUnitId).toBe(alphasCamp);

      await expect(
        service.recordMob(a.userId, mobBody({ farmId: a.farmId, landUnitId: bravosCamp })),
      ).rejects.toThrow(NotFoundError);

      const rows = await app.asUser(a.userId, (tx) => tx.select().from(mobs));
      expect(rows).toHaveLength(1);
    });

    it('refuses an ANIMAL that points at a neighbour’s camp or mob', async () => {
      // Same hole, on the table that has the most references. An animal on the right farm sitting
      // in someone else's camp corrupts exactly the per-camp counts grazing and theft rest on.
      const a = await tenant('Alpha');
      const b = await tenant('Bravo');
      const bravosCamp = await aCamp(b.farmId);
      const bravosMob = await service.recordMob(b.userId, mobBody({ farmId: b.farmId }));

      await expect(
        service.recordAnimal(a.userId, animalBody({ farmId: a.farmId, landUnitId: bravosCamp })),
      ).rejects.toThrow(NotFoundError);

      await expect(
        service.recordAnimal(a.userId, animalBody({ farmId: a.farmId, mobId: bravosMob.id })),
      ).rejects.toThrow(NotFoundError);

      const rows = await app.asUser(a.userId, (tx) => tx.select().from(animals));
      expect(rows).toHaveLength(0);
    });

    it('refuses an animal that points at a neighbour’s HERD or BRAND', async () => {
      // The same hole as the camp and the mob, on the two references that were left out of the
      // original fix. The brand is the sharper of the two: a branding register IS the ownership
      // claim an evidence pack rests on, so an animal wearing a neighbour's registered mark
      // corrupts the one document a Stock Theft Unit is handed.
      const a = await tenant('Alpha');
      const b = await tenant('Bravo');

      const [bravosHerd] = await elevated.db
        .insert(enterprises)
        .values({ farmId: b.farmId, name: 'Bravo Bonsmaras', type: 'beef_cattle' })
        .returning();
      const [bravosBrand] = await elevated.db
        .insert(brandingRegisters)
        .values({
          farmId: b.farmId,
          mark: 'BRV',
          markType: 'hot_brand',
          species: ['cattle'],
        })
        .returning();

      await expect(
        service.recordAnimal(
          a.userId,
          animalBody({ farmId: a.farmId, enterpriseId: bravosHerd!.id }),
        ),
      ).rejects.toThrow(NotFoundError);

      await expect(
        service.recordAnimal(a.userId, animalBody({ farmId: a.farmId, brandId: bravosBrand!.id })),
      ).rejects.toThrow(NotFoundError);

      const rows = await app.asUser(a.userId, (tx) => tx.select().from(animals));
      expect(rows).toHaveLength(0);
    });

    it('refuses a MOB filed under a neighbour’s herd', async () => {
      const a = await tenant('Alpha');
      const b = await tenant('Bravo');
      const [bravosHerd] = await elevated.db
        .insert(enterprises)
        .values({ farmId: b.farmId, name: 'Bravo sheep', type: 'sheep' })
        .returning();

      await expect(
        service.recordMob(a.userId, mobBody({ farmId: a.farmId, enterpriseId: bravosHerd!.id })),
      ).rejects.toThrow(NotFoundError);

      const rows = await app.asUser(a.userId, (tx) => tx.select().from(mobs));
      expect(rows).toHaveLength(0);
    });

    it('refuses a stranger, exactly as if the farm did not exist', async () => {
      const a = await tenant('Alpha');
      const b = await tenant('Bravo');

      await expect(service.recordMob(b.userId, mobBody({ farmId: a.farmId }))).rejects.toThrow(
        NotFoundError,
      );

      const rows = await elevated.db.select().from(mobs);
      expect(rows).toHaveLength(0);
    });
  });

  // ── A mob's head count can change, and says why (FR-102) ────────────────────────────
  describe('mob tally (FR-102)', () => {
    const tallyBody = (
      over: Partial<ZodInput<typeof schemas.recordMobTallyRequestSchema>> & {
        farmId: string;
        mobId: string;
      },
    ): schemas.RecordMobTallyRequest =>
      schemas.recordMobTallyRequestSchema.parse({
        id: randomUUID(),
        occurredAt: '2026-07-14T05:30:00.000Z',
        reason: 'death',
        count: 3,
        ...over,
      });

    /** The mob's stored count, read back through the farm's own RLS scope. */
    async function headOf(userId: string, mobId: string): Promise<number | null> {
      const [row] = await app.asUser(userId, (tx) =>
        tx.select({ headCount: mobs.headCount }).from(mobs).where(eq(mobs.id, mobId)),
      );
      return row!.headCount;
    }

    it('takes three dead ewes off a 300-head flock — the number a farmer could not change before', async () => {
      const a = await tenant('Alpha');
      const mobId = await aMob(a.farmId);

      const event = await service.recordMobTally(a.userId, tallyBody({ farmId: a.farmId, mobId }));

      expect(await headOf(a.userId, mobId)).toBe(297);
      expect(event.type).toBe('tally');
      expect(event.mobId).toBe(mobId);
      expect(event.payload).toMatchObject({ reason: 'death', delta: -3 });
    });

    it('keeps the reason in the log, so 297 can be explained a year later', async () => {
      const a = await tenant('Alpha');
      const mobId = await aMob(a.farmId);

      await service.recordMobTally(
        a.userId,
        tallyBody({ farmId: a.farmId, mobId, reason: 'birth', count: 40 }),
      );
      await service.recordMobTally(
        a.userId,
        tallyBody({
          farmId: a.farmId,
          mobId,
          reason: 'sale',
          count: 20,
          counterparty: 'Bethlehem abattoir',
          priceCents: 8_640_000,
          occurredAt: '2026-07-16T05:30:00.000Z',
        }),
      );

      expect(await headOf(a.userId, mobId)).toBe(320);
      const log = await app.asUser(a.userId, (tx) =>
        tx.select().from(events).where(eq(events.mobId, mobId)),
      );
      expect(log).toHaveLength(2);
      expect(log.map((e) => (e.payload as { reason: string }).reason).sort()).toEqual([
        'birth',
        'sale',
      ]);
    });

    it('⭐ does not take the same animals off twice when the flush retries', async () => {
      // The flush is at-least-once: a 201 lost on the way home is re-sent on the next reconnect.
      // This capture changes the count its own validation reads, so an idempotency check that
      // relied on the insert absorbing the duplicate would apply the delta a second time.
      const a = await tenant('Alpha');
      const mobId = await aMob(a.farmId);
      const body = tallyBody({ farmId: a.farmId, mobId });

      const first = await service.recordMobTally(a.userId, body);
      const again = await service.recordMobTally(a.userId, body);

      expect(again.id).toBe(first.id);
      expect(await headOf(a.userId, mobId)).toBe(297);
    });

    it('⭐ lands on the same number whichever order two phones sync in', async () => {
      // The recount happened on the 3rd and counted the lambs born on the 2nd. A second phone was
      // in a dead zone and syncs the lambing LAST. Stepping the stored count by each delta as it
      // arrives would let the older lambing overwrite the newer count; re-deriving the fold from
      // the log cannot.
      const a = await tenant('Alpha');
      const mobId = await aMob(a.farmId);

      await service.recordMobTally(
        a.userId,
        tallyBody({
          farmId: a.farmId,
          mobId,
          reason: 'recount',
          count: 291,
          occurredAt: '2026-07-03T05:30:00.000Z',
        }),
      );
      await service.recordMobTally(
        a.userId,
        tallyBody({
          farmId: a.farmId,
          mobId,
          reason: 'birth',
          count: 9,
          occurredAt: '2026-07-02T05:30:00.000Z',
        }),
      );

      expect(await headOf(a.userId, mobId)).toBe(291);
    });

    it('⭐ lands on the same number as the phone when a recount and a delta share a day', async () => {
      // The capture screen stamps every tally on a day with ONE instant, so ties are ordinary. The
      // fold is not commutative once a recount is in it, and the server read the log with no
      // ORDER BY — so the stored count depended on the query plan while the phone's depended on
      // its append order. Both sides now order by (occurred_at, id).
      const a = await tenant('Alpha');
      const mobId = await aMob(a.farmId); // 300 head

      // Both on 14 July, both at midday, exactly as the screen writes them. The deaths were
      // captured first, then the farmer walked the camp and counted.
      //
      // ⭐ The ids are UUIDv7, as the client mints them, and that is load-bearing rather than
      // incidental. Any total order makes the two sides AGREE — which is the correctness property —
      // but only a time-ordered id makes them agree on the RIGHT answer, because a v7 sorts in
      // capture order and so resolves the tie to "the recount was recorded second, therefore it is
      // the later fact". With random v4 ids both sides still match each other and land on whichever
      // of 294 / 297 the ids happen to give.
      await service.recordMobTally(
        a.userId,
        tallyBody({
          id: uuidv7(),
          farmId: a.farmId,
          mobId,
          reason: 'death',
          count: 3,
          occurredAt: '2026-07-14T12:00:00.000Z',
        }),
      );
      await service.recordMobTally(
        a.userId,
        tallyBody({
          id: uuidv7(),
          farmId: a.farmId,
          mobId,
          reason: 'recount',
          count: 297,
          occurredAt: '2026-07-14T12:00:00.000Z',
        }),
      );

      // The recount is the later capture and supersedes: 297, not 294.
      expect(await headOf(a.userId, mobId)).toBe(297);
    });

    it('⭐ accepts a BACK-DATED decrease that today’s count could not absorb', async () => {
      // Two phones. One sells the whole flock on the 20th and syncs. The other has been in a dead
      // zone since the 18th holding "five died". Validating against the CURRENT count refuses the
      // late capture with a 400 — which the outbox sets aside permanently — so an honest record of
      // five dead sheep would be lost to an accident of sync order. It is judged against the flock
      // as it stood on the day it describes.
      const a = await tenant('Alpha');
      const mobId = await aMob(a.farmId); // 300 head

      await service.recordMobTally(
        a.userId,
        tallyBody({
          farmId: a.farmId,
          mobId,
          reason: 'sale',
          count: 300,
          occurredAt: '2026-07-20T12:00:00.000Z',
        }),
      );
      expect(await headOf(a.userId, mobId)).toBe(0);

      const late = await service.recordMobTally(
        a.userId,
        tallyBody({
          farmId: a.farmId,
          mobId,
          reason: 'death',
          count: 5,
          occurredAt: '2026-07-18T12:00:00.000Z',
        }),
      );
      expect(late.type).toBe('tally');
    });

    it('applies what happened after a recount, on top of it', async () => {
      const a = await tenant('Alpha');
      const mobId = await aMob(a.farmId);

      await service.recordMobTally(
        a.userId,
        tallyBody({
          farmId: a.farmId,
          mobId,
          reason: 'recount',
          count: 291,
          occurredAt: '2026-07-03T05:30:00.000Z',
        }),
      );
      await service.recordMobTally(
        a.userId,
        tallyBody({
          farmId: a.farmId,
          mobId,
          reason: 'birth',
          count: 9,
          occurredAt: '2026-07-05T05:30:00.000Z',
        }),
      );

      expect(await headOf(a.userId, mobId)).toBe(300);
    });

    it('refuses to take more head out than the flock has, and leaves the count alone', async () => {
      const a = await tenant('Alpha');
      const mobId = await aMob(a.farmId);

      await expect(
        service.recordMobTally(a.userId, tallyBody({ farmId: a.farmId, mobId, count: 400 })),
      ).rejects.toThrow(ValidationError);

      expect(await headOf(a.userId, mobId)).toBe(300);
    });

    it('derives the sign from the reason — a client cannot post a birth that removes head', async () => {
      // `count` is what the farmer typed and is always positive; the wire carries no sign at all.
      const a = await tenant('Alpha');
      const mobId = await aMob(a.farmId);

      await expect(
        schemas.recordMobTallyRequestSchema.parseAsync({
          id: randomUUID(),
          farmId: a.farmId,
          mobId,
          occurredAt: '2026-07-14T05:30:00.000Z',
          reason: 'birth',
          count: -40,
        }),
      ).rejects.toThrow();

      expect(await headOf(a.userId, mobId)).toBe(300);
    });

    it('files the tally under the mob’s OWN herd, never the one the body claims (FR-113)', async () => {
      const a = await tenant('Alpha');
      const [herd] = await elevated.db
        .insert(enterprises)
        .values({ farmId: a.farmId, name: 'Alpha sheep', type: 'sheep' })
        .returning();
      const [otherHerd] = await elevated.db
        .insert(enterprises)
        .values({ farmId: a.farmId, name: 'Alpha cattle', type: 'beef_cattle' })
        .returning();
      const [mob] = await elevated.db
        .insert(mobs)
        .values({
          farmId: a.farmId,
          name: 'Flock A',
          species: 'sheep',
          headCount: 300,
          initialHeadCount: 300,
          enterpriseId: herd!.id,
        })
        .returning();

      const event = await service.recordMobTally(
        a.userId,
        tallyBody({ farmId: a.farmId, mobId: mob!.id, enterpriseId: otherHerd!.id }),
      );

      expect(event.enterpriseId).toBe(herd!.id);
    });

    it('⭐ validates a tally against what the PROJECTION puts before it, ties included', async () => {
      // The as-at fold cut on `occurred_at <= this one` while the projection orders on
      // `(occurred_at, id)`, so a tally sharing an instant but sorting AFTER this one was folded in
      // anyway. Ties are ordinary rather than exotic: the capture screen stamps every tally on a
      // day with the same instant.
      //
      // The cost is a wrong REFUSAL, which is the expensive kind. The flock is sold out on the
      // 14th; a second phone in a dead zone recorded five dead the same day, BEFORE the truck came.
      // Validated against a flock the sale had already emptied, an honest capture takes a 400 — and
      // FR-009 sets a 400 aside permanently, so five dead sheep are simply lost.
      const a = await tenant('Alpha');
      const [mob] = await elevated.db
        .insert(mobs)
        .values({
          farmId: a.farmId,
          name: 'Flock A',
          species: 'sheep',
          headCount: 300,
          initialHeadCount: 300,
        })
        .returning();

      // The two ids fix the order the projection runs in: the deaths sort first.
      const deaths = '0190f3a0-0000-7000-8000-00000000a001';
      const sale = '0190f3a0-0000-7000-8000-00000000a002';
      const sameInstant = '2026-07-14T05:30:00.000Z';

      await service.recordMobTally(
        a.userId,
        tallyBody({
          id: sale,
          farmId: a.farmId,
          mobId: mob!.id,
          occurredAt: sameInstant,
          reason: 'sale',
          count: 300,
          counterparty: 'Senekal Abattoir',
        }),
      );

      const late = await service.recordMobTally(
        a.userId,
        tallyBody({
          id: deaths,
          farmId: a.farmId,
          mobId: mob!.id,
          occurredAt: sameInstant,
          reason: 'death',
          count: 5,
        }),
      );

      expect(late.type).toBe('tally');
      expect(late.payload).toMatchObject({ reason: 'death', delta: -5 });
    });

    it('refuses a tally on a group that is managed as individual animals', async () => {
      const a = await tenant('Alpha');
      const [mob] = await elevated.db
        .insert(mobs)
        .values({ farmId: a.farmId, name: 'The cows', species: 'cattle' })
        .returning();

      await expect(
        service.recordMobTally(a.userId, tallyBody({ farmId: a.farmId, mobId: mob!.id })),
      ).rejects.toThrow(ValidationError);
    });

    it('cannot touch a neighbour’s flock — it reads as a mob that does not exist', async () => {
      const a = await tenant('Alpha');
      const b = await tenant('Bravo');
      const bravosMob = await aMob(b.farmId);

      await expect(
        service.recordMobTally(a.userId, tallyBody({ farmId: a.farmId, mobId: bravosMob })),
      ).rejects.toThrow(NotFoundError);

      expect(await headOf(b.userId, bravosMob)).toBe(300);
    });
  });

  // ── The rest of the lifecycle (FR-104, FR-111, FR-106 purchase, FR-605 missing) ─────
  describe('birth, weaning, purchase and missing', () => {
    it('files a birth against the DAM, naming the calf', async () => {
      // The calving belongs on the cow's timeline, not the calf's — the calf has no history yet,
      // and "which cows calved this season" is the question a farmer actually asks.
      const a = await tenant('Alpha');
      const dam = await anAnimal(a.farmId);
      const calf = await anAnimal(a.farmId);

      const birth = await service.recordBirth(a.userId, {
        id: randomUUID(),
        farmId: a.farmId,
        animalId: dam,
        occurredAt: new Date('2026-08-14T05:30:00.000Z'),
        calfId: calf,
        easeScore: 2,
        multiples: 1,
        birthWeightKg: 34,
      } as schemas.RecordBirthRequest);

      expect(birth.type).toBe('birth');
      expect(birth.animalId).toBe(dam);
      expect(birth.payload).toMatchObject({ calfId: calf, damId: dam, easeScore: 2, multiples: 1 });
    });

    it('refuses a birth naming a calf on another farm', async () => {
      const a = await tenant('Alpha');
      const b = await tenant('Bravo');
      const dam = await anAnimal(a.farmId);
      const theirCalf = await anAnimal(b.farmId);

      await expect(
        service.recordBirth(a.userId, {
          id: randomUUID(),
          farmId: a.farmId,
          animalId: dam,
          occurredAt: new Date(),
          calfId: theirCalf,
          easeScore: 1,
          multiples: 1,
        } as schemas.RecordBirthRequest),
      ).rejects.toThrow(NotFoundError);
    });

    it('records a weaning without changing the animal’s status', async () => {
      const a = await tenant('Alpha');
      const animalId = await anAnimal(a.farmId);

      const weaning = await service.recordWeaning(a.userId, {
        id: randomUUID(),
        farmId: a.farmId,
        animalId,
        occurredAt: new Date('2026-09-01T08:00:00.000Z'),
        weightKg: 210,
        ageDays: 205,
      } as schemas.RecordWeaningRequest);

      expect(weaning.type).toBe('weaning');
      expect(weaning.payload).toMatchObject({ weightKg: 210, ageDays: 205 });
      const [row] = await app.asUser(a.userId, (tx) =>
        tx.select().from(animals).where(eq(animals.id, animalId)),
      );
      expect(row!.status).toBe('alive');
    });

    it('records a purchase as money in, with no status change', async () => {
      // A purchase is the mirror of a sale for the books, but the animal arrived alive and stays
      // alive — it is not a status event at all. Money is integer cents, never a float.
      const a = await tenant('Alpha');
      const animalId = await anAnimal(a.farmId);

      const purchase = await service.recordPurchase(a.userId, {
        id: randomUUID(),
        farmId: a.farmId,
        animalId,
        occurredAt: new Date('2026-05-04T09:00:00.000Z'),
        counterparty: 'Bloem Vleismark',
        priceCents: 1_845_000,
      } as schemas.RecordPurchaseRequest);

      expect(purchase.type).toBe('purchase');
      expect(purchase.payload).toMatchObject({ priceCents: 1_845_000 });
    });

    it('marks an animal missing, anchored to where it was last seen', async () => {
      const a = await tenant('Alpha');
      const animalId = await anAnimal(a.farmId);
      const lastSeen = JSON.stringify({ type: 'Point', coordinates: [26.21, -29.12] });

      const missing = await service.recordMissing(a.userId, {
        id: randomUUID(),
        farmId: a.farmId,
        animalId,
        occurredAt: new Date('2026-06-18T16:00:00.000Z'),
        lastSeenGeojson: lastSeen,
        cause: 'Fence cut on the eastern boundary',
      } as schemas.RecordMissingRequest);

      expect(missing.type).toBe('missing');
      // The point is the whole value of the record to the Stock Theft Unit, so it must survive to
      // the row — via the events geojson trigger, exactly as a camp boundary does.
      expect(missing.locationGeojson).not.toBeNull();
      expect(JSON.parse(missing.locationGeojson!)).toMatchObject({ type: 'Point' });
    });

    it('refuses to report a SOLD animal missing', async () => {
      // 'missing' is less final than 'sold'. An animal that left in a truck is not missing, and the
      // state machine — not this endpoint — is what says so.
      const a = await tenant('Alpha');
      const animalId = await anAnimal(a.farmId);
      await elevated.db.update(animals).set({ status: 'sold' }).where(eq(animals.id, animalId));

      await expect(
        service.recordMissing(a.userId, {
          id: randomUUID(),
          farmId: a.farmId,
          animalId,
          occurredAt: new Date(),
          lastSeenGeojson: JSON.stringify({ type: 'Point', coordinates: [26.2, -29.1] }),
        } as schemas.RecordMissingRequest),
      ).rejects.toThrow(ValidationError);
    });
  });

  // ── Movement (FR-103) ───────────────────────────────────────────────────────────────
  describe('movement (FR-103)', () => {
    const moveBody = (
      over: Partial<ZodInput<typeof schemas.recordMoveRequestSchema>> & {
        farmId: string;
        animalId: string;
      },
    ): schemas.RecordMoveRequest =>
      schemas.recordMoveRequestSchema.parse({
        id: randomUUID(),
        occurredAt: '2026-04-02T06:00:00.000Z',
        ...over,
      });

    async function aCamp(farmId: string, code: string): Promise<string> {
      const [row] = await elevated.db
        .insert(landUnits)
        .values({ farmId, kind: 'camp', code })
        .returning();
      return row!.id;
    }

    it('keeps the walk as history AND updates where the animal is now', async () => {
      // Two different facts. The event is how it got there; the animal row is only where it is.
      const a = await tenant('Alpha');
      const animalId = await anAnimal(a.farmId);
      const from = await aCamp(a.farmId, 'Camp 1');
      const to = await aCamp(a.farmId, 'Camp 4');
      await elevated.db.update(animals).set({ landUnitId: from }).where(eq(animals.id, animalId));

      const moved = await service.recordMove(
        a.userId,
        moveBody({ farmId: a.farmId, animalId, toLandUnitId: to }),
      );

      expect(moved.type).toBe('move');
      // The FROM side was read from the animal, never sent — this is what makes the history true.
      expect(moved.payload).toMatchObject({
        fromLandUnitId: from,
        toLandUnitId: to,
        fromMobId: null,
        toMobId: null,
      });
      // The event's own scope column points at the DESTINATION, so a per-camp feed shows arrivals.
      expect(moved.landUnitId).toBe(to);

      const [now] = await app.asUser(a.userId, (tx) =>
        tx.select().from(animals).where(eq(animals.id, animalId)),
      );
      expect(now!.landUnitId).toBe(to);
    });

    it('leaves the mob alone when only the camp is named', async () => {
      // Omit vs null is the whole contract: "move it to Camp 4" must not also empty its mob.
      const a = await tenant('Alpha');
      const animalId = await anAnimal(a.farmId);
      const [mob] = await elevated.db
        .insert(mobs)
        .values({ farmId: a.farmId, name: 'Weaners', species: 'cattle' })
        .returning();
      await elevated.db.update(animals).set({ mobId: mob!.id }).where(eq(animals.id, animalId));
      const to = await aCamp(a.farmId, 'Camp 4');

      const moved = await service.recordMove(
        a.userId,
        moveBody({ farmId: a.farmId, animalId, toLandUnitId: to }),
      );

      expect(moved.payload).toMatchObject({ fromMobId: mob!.id, toMobId: mob!.id });
      const [now] = await app.asUser(a.userId, (tx) =>
        tx.select().from(animals).where(eq(animals.id, animalId)),
      );
      expect(now!.mobId).toBe(mob!.id);
    });

    it('takes an animal OUT of its mob when null is sent, which is a real destination', async () => {
      const a = await tenant('Alpha');
      const animalId = await anAnimal(a.farmId);
      const [mob] = await elevated.db
        .insert(mobs)
        .values({ farmId: a.farmId, name: 'Weaners', species: 'cattle' })
        .returning();
      await elevated.db.update(animals).set({ mobId: mob!.id }).where(eq(animals.id, animalId));

      await service.recordMove(a.userId, moveBody({ farmId: a.farmId, animalId, toMobId: null }));

      const [now] = await app.asUser(a.userId, (tx) =>
        tx.select().from(animals).where(eq(animals.id, animalId)),
      );
      expect(now!.mobId).toBeNull();
    });

    it('⭐ a BACK-DATED move records where the animal actually was, and does not walk it backwards', async () => {
      // Arrival order is not `occurred_at` order — a phone out of signal for a week sends a move
      // dated the 2nd long after one dated the 9th has landed. The FROM side used to be stamped
      // from `animals.mob_id`, the denormalised "where is it now", so the late arrival recorded the
      // 9th's DESTINATION as the 2nd's origin. That is baked into an append-only log the withdrawal
      // guard reconstructs mob membership from, so it is wrong for good.
      const a = await tenant('Alpha');
      const animalId = await anAnimal(a.farmId);
      const [home] = await elevated.db
        .insert(mobs)
        .values({ farmId: a.farmId, name: 'Home flock', species: 'sheep' })
        .returning();
      const [dipCamp] = await elevated.db
        .insert(mobs)
        .values({ farmId: a.farmId, name: 'Dip camp flock', species: 'sheep' })
        .returning();
      const [far] = await elevated.db
        .insert(mobs)
        .values({ farmId: a.farmId, name: 'Far camp flock', species: 'sheep' })
        .returning();
      await elevated.db.update(animals).set({ mobId: home!.id }).where(eq(animals.id, animalId));

      // Captured on the phone that had signal.
      await service.recordMove(
        a.userId,
        moveBody({
          farmId: a.farmId,
          animalId,
          occurredAt: '2026-04-09T06:00:00.000Z',
          toMobId: far!.id,
        }),
      );

      // The one that was stuck in a pocket for a week. It happened FIRST.
      const backDated = await service.recordMove(
        a.userId,
        moveBody({
          farmId: a.farmId,
          animalId,
          occurredAt: '2026-04-02T06:00:00.000Z',
          toMobId: dipCamp!.id,
        }),
      );

      // Where it came from on the 2nd was the home flock — not the far camp it is in today.
      expect(backDated.payload).toMatchObject({ fromMobId: home!.id, toMobId: dipCamp!.id });

      // And it is still in the far camp: a move that describes last week must not relocate it.
      const [now] = await app.asUser(a.userId, (tx) =>
        tx.select().from(animals).where(eq(animals.id, animalId)),
      );
      expect(now!.mobId).toBe(far!.id);
    });

    it('refuses a move that changes nothing', async () => {
      const a = await tenant('Alpha');
      const animalId = await anAnimal(a.farmId);
      const camp = await aCamp(a.farmId, 'Camp 1');
      await elevated.db.update(animals).set({ landUnitId: camp }).where(eq(animals.id, animalId));

      await expect(
        service.recordMove(a.userId, moveBody({ farmId: a.farmId, animalId, toLandUnitId: camp })),
      ).rejects.toThrow(ValidationError);
    });

    it('refuses to move an animal that has left the herd', async () => {
      const a = await tenant('Alpha');
      const animalId = await anAnimal(a.farmId);
      await elevated.db.update(animals).set({ status: 'sold' }).where(eq(animals.id, animalId));
      const to = await aCamp(a.farmId, 'Camp 4');

      await expect(
        service.recordMove(a.userId, moveBody({ farmId: a.farmId, animalId, toLandUnitId: to })),
      ).rejects.toThrow(ValidationError);
    });

    it('refuses to walk an animal into a neighbour’s camp', async () => {
      const a = await tenant('Alpha');
      const b = await tenant('Bravo');
      const animalId = await anAnimal(a.farmId);
      const theirs = await aCamp(b.farmId, 'Camp 9');

      await expect(
        service.recordMove(
          a.userId,
          moveBody({ farmId: a.farmId, animalId, toLandUnitId: theirs }),
        ),
      ).rejects.toThrow(NotFoundError);

      const [now] = await app.asUser(a.userId, (tx) =>
        tx.select().from(animals).where(eq(animals.id, animalId)),
      );
      expect(now!.landUnitId).toBeNull();
    });

    it('ties one walk across a group together with a shared batch id (FR-112)', async () => {
      // A farmer walks a mob, not an animal. The shared id is what lets the group be reviewed or
      // corrected as the single action it was.
      const a = await tenant('Alpha');
      const first = await anAnimal(a.farmId);
      const second = await anAnimal(a.farmId);
      const to = await aCamp(a.farmId, 'Camp 4');
      const batchId = randomUUID();

      const moves = await Promise.all(
        [first, second].map((animalId) =>
          service.recordMove(
            a.userId,
            moveBody({ farmId: a.farmId, animalId, toLandUnitId: to, batchId }),
          ),
        ),
      );

      expect(moves.map((m) => m.batchId)).toEqual([batchId, batchId]);
      expect(new Set(moves.map((m) => m.id)).size).toBe(2);
    });

    it('is idempotent on the client id even though the first move changed what it validates', async () => {
      // ⭐ The case that breaks the naive implementation. After the first move the animal IS in the
      // destination, so re-running the domain would correctly refuse "a move that changes nothing"
      // — and the flush, which is at-least-once by design, would retry a 400 forever with the whole
      // queue stuck behind a write that already succeeded.
      const a = await tenant('Alpha');
      const animalId = await anAnimal(a.farmId);
      const to = await aCamp(a.farmId, 'Camp 4');
      const body = moveBody({ farmId: a.farmId, animalId, toLandUnitId: to });

      const first = await service.recordMove(a.userId, body);
      const again = await service.recordMove(a.userId, body);

      expect(again.id).toBe(first.id);
      const rows = await app.asUser(a.userId, (tx) =>
        tx.select().from(events).where(eq(events.type, 'move')),
      );
      expect(rows).toHaveLength(1);
    });
  });

  // ── Identifiers (FR-109) ────────────────────────────────────────────────────────────
  describe('animal identifiers (FR-109)', () => {
    const identifierBody = (
      over: Partial<schemas.NewAnimalIdentifier> & { farmId: string; animalId: string },
    ): schemas.NewAnimalIdentifier =>
      schemas.newAnimalIdentifierSchema.parse({
        id: randomUUID(),
        type: 'visual_tag',
        value: '4021',
        ...over,
      });

    it('attaches a tag to an animal, authored by the caller', async () => {
      const a = await tenant('Alpha');
      const animalId = await anAnimal(a.farmId);

      const tag = await service.recordIdentifier(
        a.userId,
        identifierBody({ farmId: a.farmId, animalId, value: '4021', isPrimary: true }),
      );

      expect(tag.value).toBe('4021');
      expect(tag.type).toBe('visual_tag');
      expect(tag.isPrimary).toBe(true);
      expect(tag.createdBy).toBe(a.userId);
    });

    it('carries several identifiers on one animal at once', async () => {
      // An animal really does wear a visual tag AND an EID, and either may be the one read.
      const a = await tenant('Alpha');
      const animalId = await anAnimal(a.farmId);

      await service.recordIdentifier(
        a.userId,
        identifierBody({ farmId: a.farmId, animalId, type: 'visual_tag', value: '4021' }),
      );
      await service.recordIdentifier(
        a.userId,
        identifierBody({ farmId: a.farmId, animalId, type: 'eid', value: '982 000123456789' }),
      );

      const rows = await app.asUser(a.userId, (tx) => tx.select().from(animalIdentifiers));
      expect(rows).toHaveLength(2);
    });

    it('is idempotent on the client id, so a re-flush does not tag the animal twice', async () => {
      const a = await tenant('Alpha');
      const animalId = await anAnimal(a.farmId);
      const body = identifierBody({ farmId: a.farmId, animalId });

      const first = await service.recordIdentifier(a.userId, body);
      const again = await service.recordIdentifier(a.userId, body);

      expect(again.id).toBe(first.id);
      const rows = await app.asUser(a.userId, (tx) => tx.select().from(animalIdentifiers));
      expect(rows).toHaveLength(1);
    });

    it('refuses a number already live on a DIFFERENT animal, rather than moving it', async () => {
      // In a crush this is almost always a misread digit. Silently moving the tag would corrupt the
      // identity chain an evidence pack and an export audit both rest on.
      const a = await tenant('Alpha');
      const first = await anAnimal(a.farmId);
      const second = await anAnimal(a.farmId);

      await service.recordIdentifier(
        a.userId,
        identifierBody({ farmId: a.farmId, animalId: first, value: '4021' }),
      );

      await expect(
        service.recordIdentifier(
          a.userId,
          identifierBody({ farmId: a.farmId, animalId: second, value: '4021' }),
        ),
      ).rejects.toThrow(ConflictError);

      const rows = await app.asUser(a.userId, (tx) => tx.select().from(animalIdentifiers));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.animalId).toBe(first);
    });

    it('lets a retired tag be reissued once the old one is tombstoned', async () => {
      // The uniqueness index is partial on deleted_at IS NULL for exactly this: a farmer reuses a
      // tag number, and a rule that forbade it forever would be a rule about our schema, not theirs.
      const a = await tenant('Alpha');
      const first = await anAnimal(a.farmId);
      const second = await anAnimal(a.farmId);

      const old = await service.recordIdentifier(
        a.userId,
        identifierBody({ farmId: a.farmId, animalId: first, value: '4021' }),
      );
      await elevated.db
        .update(animalIdentifiers)
        .set({ deletedAt: new Date() })
        .where(eq(animalIdentifiers.id, old.id));

      const reissued = await service.recordIdentifier(
        a.userId,
        identifierBody({ farmId: a.farmId, animalId: second, value: '4021' }),
      );

      expect(reissued.animalId).toBe(second);
    });

    it('lets two farms each use tag 4021, and hides one from the other', async () => {
      const a = await tenant('Alpha');
      const b = await tenant('Bravo');

      await service.recordIdentifier(
        a.userId,
        identifierBody({ farmId: a.farmId, animalId: await anAnimal(a.farmId), value: '4021' }),
      );
      await service.recordIdentifier(
        b.userId,
        identifierBody({ farmId: b.farmId, animalId: await anAnimal(b.farmId), value: '4021' }),
      );

      const seenByA = await app.asUser(a.userId, (tx) => tx.select().from(animalIdentifiers));
      expect(seenByA).toHaveLength(1);
      expect(seenByA[0]!.farmId).toBe(a.farmId);
    });

    it('refuses to tag an animal on another farm, as if it did not exist', async () => {
      const a = await tenant('Alpha');
      const b = await tenant('Bravo');
      const alphasAnimal = await anAnimal(a.farmId);

      await expect(
        service.recordIdentifier(
          b.userId,
          identifierBody({ farmId: b.farmId, animalId: alphasAnimal }),
        ),
      ).rejects.toThrow(NotFoundError);

      const rows = await elevated.db.select().from(animalIdentifiers);
      expect(rows).toHaveLength(0);
    });
  });

  // ── Herd scoping (FR-113) ───────────────────────────────────────────────────────────
  describe('herd scoping (FR-113)', () => {
    /** A herd on the farm, and an animal filed under it. */
    async function aHerdWithAnimal(farmId: string): Promise<{ herdId: string; animalId: string }> {
      const [herd] = await elevated.db
        .insert(enterprises)
        .values({ farmId, name: 'Bonsmara cows', type: 'beef_cattle' })
        .returning();
      const [animal] = await elevated.db
        .insert(animals)
        .values({ farmId, enterpriseId: herd!.id, species: 'cattle', sex: 'female' })
        .returning();
      return { herdId: herd!.id, animalId: animal!.id };
    }

    it('stamps a weight with the herd its animal is in, without being told', async () => {
      const a = await tenant('Alpha');
      const { herdId, animalId } = await aHerdWithAnimal(a.farmId);

      // The body carries no enterprise. The server reads it off the animal — so a per-herd report
      // is correct even for a capture composed by a client that never heard of herd scoping.
      const captured = await service.recordWeight(
        a.userId,
        weightBody({ farmId: a.farmId, animalId }),
      );

      expect(captured.enterpriseId).toBe(herdId);
    });

    it('files a death and a sale under the herd too', async () => {
      const a = await tenant('Alpha');
      const first = await aHerdWithAnimal(a.farmId);
      const second = await aHerdWithAnimal(a.farmId);

      const death = await service.recordDeath(
        a.userId,
        deathBody({ farmId: a.farmId, animalId: first.animalId }),
      );
      const sale = await service.recordSale(
        a.userId,
        saleBody({ farmId: a.farmId, animalId: second.animalId }),
      );

      expect(death.enterpriseId).toBe(first.herdId);
      expect(sale.enterpriseId).toBe(second.herdId);
    });

    it('ignores an enterprise the client claims that is not the animal’s', async () => {
      const a = await tenant('Alpha');
      const { herdId, animalId } = await aHerdWithAnimal(a.farmId);
      const other = await aHerdWithAnimal(a.farmId);

      const captured = await service.recordWeight(
        a.userId,
        weightBody({ farmId: a.farmId, animalId, enterpriseId: other.herdId }),
      );

      // The animal's own herd wins. Trusting the body would let a weight be filed against the
      // wrong herd, corrupting exactly the per-herd history FR-113 exists to produce.
      expect(captured.enterpriseId).toBe(herdId);
    });

    it('refuses an event filed under a NEIGHBOUR’S herd', async () => {
      // When the subject has no herd of its own, the server falls back to the enterprise the
      // client sent — and that fallback was taken on trust. `insertEvent` now checks it, which
      // covers every capture path at once rather than one remembered call site at a time.
      const a = await tenant('Alpha');
      const b = await tenant('Bravo');
      const [herdless] = await elevated.db
        .insert(animals)
        .values({ farmId: a.farmId, species: 'cattle', sex: 'female' })
        .returning();
      const [bravosHerd] = await elevated.db
        .insert(enterprises)
        .values({ farmId: b.farmId, name: 'Bravo Bonsmaras', type: 'beef_cattle' })
        .returning();

      await expect(
        service.recordWeight(
          a.userId,
          weightBody({ farmId: a.farmId, animalId: herdless!.id, enterpriseId: bravosHerd!.id }),
        ),
      ).rejects.toThrow(NotFoundError);

      const rows = await app.asUser(a.userId, (tx) => tx.select().from(events));
      expect(rows).toHaveLength(0);
    });

    it('files a mob dip under the mob’s herd', async () => {
      const a = await tenant('Alpha');
      const [herd] = await elevated.db
        .insert(enterprises)
        .values({ farmId: a.farmId, name: 'Dorper flock', type: 'sheep' })
        .returning();
      const [mob] = await elevated.db
        .insert(mobs)
        .values({
          farmId: a.farmId,
          enterpriseId: herd!.id,
          name: 'Flock A',
          species: 'sheep',
          headCount: 300,
        })
        .returning();
      const productId = await aVetProduct({ species: ['sheep'] });

      const captured = await service.recordDip(
        a.userId,
        dipBody({ farmId: a.farmId, animalId: null, mobId: mob!.id, productId, method: 'plunge' }),
      );

      expect(captured.enterpriseId).toBe(herd!.id);
    });

    it('leaves the herd unset when the animal itself has none, and still records', async () => {
      // An animal captured before the farm's herds reached the device. The event still names the
      // animal, so it is filed — losing the capture over a missing herd would be far worse.
      const a = await tenant('Alpha');
      const animalId = await anAnimal(a.farmId);

      const captured = await service.recordWeight(
        a.userId,
        weightBody({ farmId: a.farmId, animalId }),
      );

      expect(captured.enterpriseId).toBeNull();
      expect(captured.animalId).toBe(animalId);
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

  // ── Health capture (FR-130/131/132/133) — COMPLIANCE-GATED ────────────────────────────
  describe('health capture (FR-130/131/132/133)', () => {
    it('computes and stores the meat/milk withdrawal clear dates from the product reference data', async () => {
      // The client sends a productId and a treatment day — NOT a withdrawal number. The server
      // resolves the registered periods (meat 28 days, milk 96 hours) and stores the clear dates.
      const a = await tenant('Alpha');
      const animalId = await anAnimal(a.farmId);
      const productId = await aVetProduct(); // meat 28d, milk 96h → 4 days

      const captured = await service.recordTreatment(
        a.userId,
        treatmentBody({
          farmId: a.farmId,
          animalId,
          productId,
          administeredOn: '2026-07-20',
          route: 'injection_im',
          reason: 'Foot infection',
        }),
      );

      expect(captured.type).toBe('treatment');
      expect(captured.payload).toMatchObject({
        product: 'Synthamycin LA (test)',
        route: 'injection_im',
        reason: 'Foot infection',
        meatWithholdUntil: '2026-08-17', // 2026-07-20 + 28 days
        milkWithholdUntil: '2026-07-24', // 2026-07-20 + ceil(96/24)=4 days
      });
      expect(captured.animalId).toBe(animalId);
      expect(captured.createdBy).toBe(a.userId);
    });

    it('rounds a milk withdrawal given in hours UP to whole days, never releasing milk early', async () => {
      const a = await tenant('Alpha');
      const animalId = await anAnimal(a.farmId);
      // 84 hours = 3.5 days → conservatively 4 days, not 3.
      const productId = await aVetProduct({ meatWithdrawalDays: null, milkWithdrawalHours: 84 });

      const captured = await service.recordTreatment(
        a.userId,
        treatmentBody({ farmId: a.farmId, animalId, productId, administeredOn: '2026-07-20' }),
      );

      expect(captured.payload).toMatchObject({ milkWithholdUntil: '2026-07-24' });
      expect(captured.payload).not.toHaveProperty('meatWithholdUntil');
    });

    it('stores no clear dates for a zero-withdrawal vaccine (FR-132)', async () => {
      const a = await tenant('Alpha');
      const animalId = await anAnimal(a.farmId);
      const productId = await aVetProduct({
        name: 'Mockvax (test)',
        meatWithdrawalDays: null,
        milkWithdrawalHours: null,
      });

      const captured = await service.recordVaccination(
        a.userId,
        vaccinationBody({ farmId: a.farmId, animalId, productId, programme: 'Annual clostridial' }),
      );

      expect(captured.type).toBe('vaccination');
      expect(captured.payload).toMatchObject({ programme: 'Annual clostridial' });
      expect(captured.payload).not.toHaveProperty('meatWithholdUntil');
      expect(captured.payload).not.toHaveProperty('milkWithholdUntil');
    });

    it('records a dip against a whole mob (FR-133)', async () => {
      const a = await tenant('Alpha');
      const mobId = await aMob(a.farmId);
      const productId = await aVetProduct({
        name: 'Tickaway (test)',
        meatWithdrawalDays: 3,
        milkWithdrawalHours: null,
      });

      const captured = await service.recordDip(
        a.userId,
        dipBody({ farmId: a.farmId, mobId, productId, method: 'plunge' }),
      );

      expect(captured.type).toBe('dip');
      expect(captured.mobId).toBe(mobId);
      expect(captured.animalId).toBeNull();
      expect(captured.payload).toMatchObject({ method: 'plunge', meatWithholdUntil: '2026-07-23' });
    });

    it('resolves the product by the farm’s jurisdiction; an unknown product is a 404 and writes nothing', async () => {
      const a = await tenant('Alpha');
      const animalId = await anAnimal(a.farmId);

      await expect(
        service.recordTreatment(
          a.userId,
          treatmentBody({ farmId: a.farmId, animalId, productId: randomUUID() }),
        ),
      ).rejects.toThrow(NotFoundError);

      const written = await app.asUser(a.userId, (tx) => tx.select().from(events));
      expect(written).toHaveLength(0);
    });

    it('refuses a registration not in force on the treatment day (ADR-0005), writing nothing', async () => {
      // A product whose registration was superseded before the treatment. Resolving by id alone
      // would apply a withdrawal from a version that did not apply on the day — the exact bug the
      // date-versioning exists to prevent. It must read as "not found".
      const a = await tenant('Alpha');
      const animalId = await anAnimal(a.farmId);
      const productId = await aVetProduct({
        effectiveFrom: '2019-01-01',
        effectiveTo: '2020-01-01',
      });

      await expect(
        service.recordTreatment(
          a.userId,
          treatmentBody({ farmId: a.farmId, animalId, productId, administeredOn: '2026-07-20' }),
        ),
      ).rejects.toThrow(NotFoundError);

      const written = await app.asUser(a.userId, (tx) => tx.select().from(events));
      expect(written).toHaveLength(0);
    });
  });

  // ── Sale within a withdrawal period is blocked at capture (FR-131) ─────────────────────
  describe('sale withdrawal guard (FR-131)', () => {
    it('blocks a meat sale before the stored clear date, and writes no sale', async () => {
      const a = await tenant('Alpha');
      const animalId = await anAnimal(a.farmId);
      const productId = await aVetProduct(); // meat 28d

      await service.recordTreatment(
        a.userId,
        treatmentBody({ farmId: a.farmId, animalId, productId, administeredOn: '2026-07-20' }),
      );

      // The withdrawal clears 2026-08-17; a sale the day before is inside it.
      await expect(
        service.recordSale(
          a.userId,
          saleBody({ farmId: a.farmId, animalId, occurredAt: '2026-08-16T06:00:00.000Z' }),
        ),
      ).rejects.toThrow(ValidationError);

      // Only the treatment event exists — the sale never landed.
      const written = await app.asUser(a.userId, (tx) => tx.select().from(events));
      expect(written).toHaveLength(1);
      expect(written[0]!.type).toBe('treatment');
    });

    it('blocks selling an animal out of a MOB that was dipped — the whole-flock dose counts', async () => {
      // ⭐ A plunge dip is the canonical whole-mob operation: it is captured against the mob, so
      // its withdrawal lands on an event with `animal_id = NULL`. A guard that reads only
      // animal-subject events cleared every individual in a dipped flock the next day — residues
      // in the chain, from an animal the app had affirmatively told the farmer was clear.
      const a = await tenant('Alpha');
      const [mob] = await elevated.db
        .insert(mobs)
        .values({ farmId: a.farmId, name: 'Flock A', species: 'sheep', headCount: 300 })
        .returning();
      const [member] = await elevated.db
        .insert(animals)
        .values({ farmId: a.farmId, mobId: mob!.id, species: 'sheep', sex: 'female' })
        .returning();
      const productId = await aVetProduct(); // meat 28d → clears 2026-08-17

      await service.recordDip(
        a.userId,
        dipBody({
          farmId: a.farmId,
          animalId: null,
          mobId: mob!.id,
          productId,
          method: 'plunge',
        }),
      );

      await expect(
        service.recordSale(
          a.userId,
          saleBody({
            farmId: a.farmId,
            animalId: member!.id,
            occurredAt: '2026-08-16T06:00:00.000Z',
          }),
        ),
      ).rejects.toThrow(ValidationError);

      // And it clears on the same date the individual-dose path would.
      const sold = await service.recordSale(
        a.userId,
        saleBody({
          farmId: a.farmId,
          animalId: member!.id,
          occurredAt: '2026-08-17T06:00:00.000Z',
        }),
      );
      expect(sold.type).toBe('sale');
    });

    it('⭐ still withholds an animal MOVED OUT of the mob that was dipped', async () => {
      // The canonical workflow, and the one that defeated the guard: you dip the flock and then
      // walk the stock out of the dip camp. The guard read `animals.mob_id` — the denormalised
      // "where is it now" — so the move silently cleared a withdrawal the animal was still inside.
      // Membership now comes from the append-only move log, which holds the before AND after.
      const a = await tenant('Alpha');
      const [dipped] = await elevated.db
        .insert(mobs)
        .values({ farmId: a.farmId, name: 'Dip camp flock', species: 'sheep', headCount: 300 })
        .returning();
      const [elsewhere] = await elevated.db
        .insert(mobs)
        .values({ farmId: a.farmId, name: 'Far camp flock', species: 'sheep', headCount: 40 })
        .returning();
      const [member] = await elevated.db
        .insert(animals)
        .values({ farmId: a.farmId, mobId: dipped!.id, species: 'sheep', sex: 'female' })
        .returning();
      const productId = await aVetProduct(); // meat 28d → clears 2026-08-17

      await service.recordDip(
        a.userId,
        dipBody({
          farmId: a.farmId,
          animalId: null,
          mobId: dipped!.id,
          productId,
          method: 'plunge',
        }),
      );

      // Out of the dip camp the next day, exactly as it happens on a farm.
      await service.recordMove(
        a.userId,
        schemas.recordMoveRequestSchema.parse({
          id: randomUUID(),
          farmId: a.farmId,
          animalId: member!.id,
          occurredAt: '2026-07-21T06:00:00.000Z',
          toMobId: elsewhere!.id,
        }),
      );

      await expect(
        service.recordSale(
          a.userId,
          saleBody({
            farmId: a.farmId,
            animalId: member!.id,
            occurredAt: '2026-08-16T06:00:00.000Z',
          }),
        ),
      ).rejects.toThrow(ValidationError);
    });

    it('does NOT withhold an animal moved INTO a mob that was dipped before it arrived', async () => {
      // The other direction of the same defect, and it matters as much: an animal that was never
      // dosed must not be refused. A guard that over-blocks costs a farmer a sale for no reason and
      // teaches them to work around it, which is how a safety gate stops being one.
      const a = await tenant('Alpha');
      const [dipped] = await elevated.db
        .insert(mobs)
        .values({ farmId: a.farmId, name: 'Dipped flock', species: 'sheep', headCount: 300 })
        .returning();
      const [origin] = await elevated.db
        .insert(mobs)
        .values({ farmId: a.farmId, name: 'Clean flock', species: 'sheep', headCount: 50 })
        .returning();
      const [newcomer] = await elevated.db
        .insert(animals)
        .values({ farmId: a.farmId, mobId: origin!.id, species: 'sheep', sex: 'female' })
        .returning();
      const productId = await aVetProduct();

      await service.recordDip(
        a.userId,
        dipBody({
          farmId: a.farmId,
          animalId: null,
          mobId: dipped!.id,
          productId,
          method: 'plunge',
        }),
      );

      // It joins the dipped flock the day AFTER the dip — it was never in the race.
      await service.recordMove(
        a.userId,
        schemas.recordMoveRequestSchema.parse({
          id: randomUUID(),
          farmId: a.farmId,
          animalId: newcomer!.id,
          occurredAt: '2026-07-21T06:00:00.000Z',
          toMobId: dipped!.id,
        }),
      );

      const sold = await service.recordSale(
        a.userId,
        saleBody({
          farmId: a.farmId,
          animalId: newcomer!.id,
          occurredAt: '2026-08-16T06:00:00.000Z',
        }),
      );
      expect(sold.type).toBe('sale');
    });

    it('⭐ still withholds when the dip and the move happen on the SAME DAY, dip recorded last', async () => {
      // ⭐ The ordinary workflow, and the one every test above stepped around by dipping and moving
      // on DIFFERENT days. You dip at first light, walk the stock out of the dip camp mid-morning,
      // and sit down to record the dip that evening — so the dip's instant lands AFTER the move's.
      // Membership was reconstructed from real move instants and compared against a dose instant
      // that is partly fabricated (a back-dated dose is stamped midday), so the dip fell outside
      // the interval it belonged to and the animal read CLEAR the next morning. Meat inside an
      // active withdrawal, from an animal the app affirmatively said was safe.
      //
      // Days are the precision the data has, and the move day belongs to BOTH mobs.
      const a = await tenant('Alpha');
      const [dipCamp] = await elevated.db
        .insert(mobs)
        .values({ farmId: a.farmId, name: 'Dip camp flock', species: 'sheep', headCount: 300 })
        .returning();
      const [elsewhere] = await elevated.db
        .insert(mobs)
        .values({ farmId: a.farmId, name: 'Far camp flock', species: 'sheep', headCount: 40 })
        .returning();
      const [member] = await elevated.db
        .insert(animals)
        .values({ farmId: a.farmId, mobId: dipCamp!.id, species: 'sheep', sex: 'female' })
        .returning();
      const productId = await aVetProduct(); // meat 28d → clears 2026-08-17

      // Walked out of the dip camp mid-morning.
      await service.recordMove(
        a.userId,
        schemas.recordMoveRequestSchema.parse({
          id: randomUUID(),
          farmId: a.farmId,
          animalId: member!.id,
          occurredAt: '2026-07-20T08:00:00.000Z',
          toMobId: elsewhere!.id,
        }),
      );

      // The dip is written up that evening — same day, later instant.
      await service.recordDip(
        a.userId,
        dipBody({
          farmId: a.farmId,
          animalId: null,
          mobId: dipCamp!.id,
          productId,
          occurredAt: '2026-07-20T18:00:00.000Z',
          administeredOn: '2026-07-20',
          method: 'plunge',
        }),
      );

      await expect(
        service.recordSale(
          a.userId,
          saleBody({
            farmId: a.farmId,
            animalId: member!.id,
            occurredAt: '2026-08-16T06:00:00.000Z',
          }),
        ),
      ).rejects.toThrow(ValidationError);
    });

    it('⭐ still withholds when the dip and the move carry the IDENTICAL instant', async () => {
      // Two day-grained captures back-dated to the same day are stamped with the same fabricated
      // midday instant, so an exact tie is ordinary rather than exotic. A half-open interval
      // excluded the tie from the source mob and attributed it only to the destination — the
      // animal walks out of the tie clear of a dose it received.
      const a = await tenant('Alpha');
      const [dipCamp] = await elevated.db
        .insert(mobs)
        .values({ farmId: a.farmId, name: 'Dip camp flock', species: 'sheep', headCount: 300 })
        .returning();
      const [elsewhere] = await elevated.db
        .insert(mobs)
        .values({ farmId: a.farmId, name: 'Far camp flock', species: 'sheep', headCount: 40 })
        .returning();
      const [member] = await elevated.db
        .insert(animals)
        .values({ farmId: a.farmId, mobId: dipCamp!.id, species: 'sheep', sex: 'female' })
        .returning();
      const productId = await aVetProduct();

      await service.recordMove(
        a.userId,
        schemas.recordMoveRequestSchema.parse({
          id: randomUUID(),
          farmId: a.farmId,
          animalId: member!.id,
          occurredAt: '2026-07-20T12:00:00.000Z',
          toMobId: elsewhere!.id,
        }),
      );
      await service.recordDip(
        a.userId,
        dipBody({
          farmId: a.farmId,
          animalId: null,
          mobId: dipCamp!.id,
          productId,
          occurredAt: '2026-07-20T12:00:00.000Z',
          administeredOn: '2026-07-20',
          method: 'plunge',
        }),
      );

      await expect(
        service.recordSale(
          a.userId,
          saleBody({
            farmId: a.farmId,
            animalId: member!.id,
            occurredAt: '2026-08-16T06:00:00.000Z',
          }),
        ),
      ).rejects.toThrow(ValidationError);
    });

    it('does NOT withhold an animal that left the day BEFORE the dip — inclusivity stops at the move day', async () => {
      // The bound on the fix. Claiming the move day for both mobs is deliberate over-withholding
      // for exactly one day; it must not spread. An animal that was somewhere else the whole day
      // the flock went through the dip was never dosed, and refusing its sale for 28 days would be
      // a guard inventing a residue.
      const a = await tenant('Alpha');
      const [dipCamp] = await elevated.db
        .insert(mobs)
        .values({ farmId: a.farmId, name: 'Dip camp flock', species: 'sheep', headCount: 300 })
        .returning();
      const [elsewhere] = await elevated.db
        .insert(mobs)
        .values({ farmId: a.farmId, name: 'Far camp flock', species: 'sheep', headCount: 40 })
        .returning();
      const [early] = await elevated.db
        .insert(animals)
        .values({ farmId: a.farmId, mobId: dipCamp!.id, species: 'sheep', sex: 'female' })
        .returning();
      const productId = await aVetProduct();

      await service.recordMove(
        a.userId,
        schemas.recordMoveRequestSchema.parse({
          id: randomUUID(),
          farmId: a.farmId,
          animalId: early!.id,
          occurredAt: '2026-07-19T14:00:00.000Z',
          toMobId: elsewhere!.id,
        }),
      );
      await service.recordDip(
        a.userId,
        dipBody({
          farmId: a.farmId,
          animalId: null,
          mobId: dipCamp!.id,
          productId,
          occurredAt: '2026-07-20T06:00:00.000Z',
          administeredOn: '2026-07-20',
          method: 'plunge',
        }),
      );

      const sold = await service.recordSale(
        a.userId,
        saleBody({
          farmId: a.farmId,
          animalId: early!.id,
          occurredAt: '2026-08-16T06:00:00.000Z',
        }),
      );
      expect(sold.type).toBe('sale');
    });

    it('⭐ blocks an individual SLAUGHTER inside a withdrawal, and never blocks a death', async () => {
      // The mirror image of the hole the group tally path closed. `slaughter` has been a
      // first-class tally reason since FR-102 and the individual path had only a free-text
      // `cause` — so "slaughtered for the workers' rations" was an ordinary death and nothing
      // fired. The flag exists because a guard cannot read that fact out of a typed sentence.
      //
      // And the other half matters as much: a DEATH is not a food-safety event. Refusing to record
      // one would refuse to record a fact, which is worse than recording it.
      const a = await tenant('Alpha');
      const animalId = await anAnimal(a.farmId);
      const other = await anAnimal(a.farmId);
      const productId = await aVetProduct(); // meat 28d → clears 2026-08-17

      for (const id of [animalId, other]) {
        await service.recordTreatment(
          a.userId,
          treatmentBody({
            farmId: a.farmId,
            animalId: id,
            productId,
            administeredOn: '2026-07-20',
          }),
        );
      }

      await expect(
        service.recordDeath(
          a.userId,
          schemas.recordDeathRequestSchema.parse({
            id: randomUUID(),
            farmId: a.farmId,
            animalId,
            occurredAt: '2026-08-16T06:00:00.000Z',
            cause: 'Slaughtered for rations',
            slaughtered: true,
          }),
        ),
      ).rejects.toThrow(ValidationError);

      // The same animal, on the same day, having simply died: recorded without argument.
      const died = await service.recordDeath(
        a.userId,
        schemas.recordDeathRequestSchema.parse({
          id: randomUUID(),
          farmId: a.farmId,
          animalId: other,
          occurredAt: '2026-08-16T06:00:00.000Z',
          cause: 'Tick-borne disease',
        }),
      );
      expect(died.type).toBe('death');
      expect(died.payload).not.toHaveProperty('slaughtered');

      // And the slaughter goes through once the withholding has run.
      const slaughtered = await service.recordDeath(
        a.userId,
        schemas.recordDeathRequestSchema.parse({
          id: randomUUID(),
          farmId: a.farmId,
          animalId,
          occurredAt: '2026-08-17T06:00:00.000Z',
          cause: 'Slaughtered for rations',
          slaughtered: true,
        }),
      );
      expect(slaughtered.payload).toMatchObject({ slaughtered: true });
    });

    it('⭐ blocks a group tally when ONE animal in the mob was treated individually', async () => {
      // Health events are animal-XOR-mob, so an individual treatment stores `mob_id = NULL`. The
      // group guard filtered on `events.mob_id` and therefore saw the plunge dip and missed the
      // cow the vet had come out for — and a tally to slaughter takes head out of the mob without
      // naming which head, so the treated one is exactly as likely to be on the truck as any other.
      const a = await tenant('Alpha');
      const [mob] = await elevated.db
        .insert(mobs)
        .values({
          farmId: a.farmId,
          name: 'Ossies',
          species: 'cattle',
          headCount: 40,
          initialHeadCount: 40,
        })
        .returning();
      const [treated] = await elevated.db
        .insert(animals)
        .values({ farmId: a.farmId, mobId: mob!.id, species: 'cattle', sex: 'male' })
        .returning();
      const productId = await aVetProduct(); // meat 28d → clears 2026-08-17

      await service.recordTreatment(
        a.userId,
        treatmentBody({
          farmId: a.farmId,
          animalId: treated!.id,
          productId,
          administeredOn: '2026-07-20',
        }),
      );

      await expect(
        service.recordMobTally(
          a.userId,
          schemas.recordMobTallyRequestSchema.parse({
            id: randomUUID(),
            farmId: a.farmId,
            mobId: mob!.id,
            occurredAt: '2026-08-16T06:00:00.000Z',
            reason: 'slaughter',
            count: 10,
          }),
        ),
      ).rejects.toThrow(ValidationError);

      // Clear the day the withholding runs out, so the guard is not simply refusing everything.
      const after = await service.recordMobTally(
        a.userId,
        schemas.recordMobTallyRequestSchema.parse({
          id: randomUUID(),
          farmId: a.farmId,
          mobId: mob!.id,
          occurredAt: '2026-08-17T06:00:00.000Z',
          reason: 'slaughter',
          count: 10,
        }),
      );
      expect(after.type).toBe('tally');
    });

    it('⭐ blocks a group tally for an animal that carried its withholding INTO the mob', async () => {
      // Dipped in the dip camp, walked into the ox mob, and the ox mob sold for slaughter. Neither
      // half of the old guard could see it: the dip names a different mob, and the animal was never
      // individually dosed.
      const a = await tenant('Alpha');
      const [dipCamp] = await elevated.db
        .insert(mobs)
        .values({ farmId: a.farmId, name: 'Dip camp flock', species: 'cattle' })
        .returning();
      const [oxen] = await elevated.db
        .insert(mobs)
        .values({
          farmId: a.farmId,
          name: 'Ossies',
          species: 'cattle',
          headCount: 40,
          initialHeadCount: 40,
        })
        .returning();
      const [ox] = await elevated.db
        .insert(animals)
        .values({ farmId: a.farmId, mobId: dipCamp!.id, species: 'cattle', sex: 'male' })
        .returning();
      const productId = await aVetProduct();

      await service.recordDip(
        a.userId,
        dipBody({
          farmId: a.farmId,
          animalId: null,
          mobId: dipCamp!.id,
          productId,
          method: 'plunge',
        }),
      );
      await service.recordMove(
        a.userId,
        schemas.recordMoveRequestSchema.parse({
          id: randomUUID(),
          farmId: a.farmId,
          animalId: ox!.id,
          occurredAt: '2026-07-22T06:00:00.000Z',
          toMobId: oxen!.id,
        }),
      );

      await expect(
        service.recordMobTally(
          a.userId,
          schemas.recordMobTallyRequestSchema.parse({
            id: randomUUID(),
            farmId: a.farmId,
            mobId: oxen!.id,
            occurredAt: '2026-08-16T06:00:00.000Z',
            reason: 'sale',
            count: 10,
            counterparty: 'Senekal Abattoir',
          }),
        ),
      ).rejects.toThrow(ValidationError);
    });

    it('does not withhold an animal in a DIFFERENT mob from the one dipped', async () => {
      // The other side of the same join: widening the guard must not start refusing sales the
      // farmer is entitled to make. An over-broad guard trains people to work around it.
      const a = await tenant('Alpha');
      const [dipped] = await elevated.db
        .insert(mobs)
        .values({ farmId: a.farmId, name: 'Flock A', species: 'sheep', headCount: 300 })
        .returning();
      const [untouched] = await elevated.db
        .insert(mobs)
        .values({ farmId: a.farmId, name: 'Flock B', species: 'sheep', headCount: 120 })
        .returning();
      const [bystander] = await elevated.db
        .insert(animals)
        .values({ farmId: a.farmId, mobId: untouched!.id, species: 'sheep', sex: 'female' })
        .returning();
      const productId = await aVetProduct();

      await service.recordDip(
        a.userId,
        dipBody({
          farmId: a.farmId,
          animalId: null,
          mobId: dipped!.id,
          productId,
          method: 'plunge',
        }),
      );

      const sold = await service.recordSale(
        a.userId,
        saleBody({
          farmId: a.farmId,
          animalId: bystander!.id,
          occurredAt: '2026-08-16T06:00:00.000Z',
        }),
      );
      expect(sold.type).toBe('sale');
    });

    it('⭐ blocks tallying a dipped FLOCK to slaughter — the group-only path was unguarded', async () => {
      // The smallholder case, and the one the guard could not previously reach at all. A mob run
      // by head count has no `animals` rows, so every individual check in this service was
      // structurally incapable of firing for it: dip the flock, tally forty to the abattoir the
      // next day, and nothing anywhere said no. This is the farm least likely to have a second
      // system catching it.
      const a = await tenant('Alpha');
      const [flock] = await elevated.db
        .insert(mobs)
        .values({
          farmId: a.farmId,
          name: 'Flock A',
          species: 'sheep',
          headCount: 300,
          initialHeadCount: 300,
        })
        .returning();
      const productId = await aVetProduct(); // meat 28d → clears 2026-08-17

      await service.recordDip(
        a.userId,
        dipBody({
          farmId: a.farmId,
          animalId: null,
          mobId: flock!.id,
          productId,
          method: 'plunge',
        }),
      );

      await expect(
        service.recordMobTally(
          a.userId,
          schemas.recordMobTallyRequestSchema.parse({
            id: randomUUID(),
            farmId: a.farmId,
            mobId: flock!.id,
            occurredAt: '2026-08-16T06:00:00.000Z',
            reason: 'slaughter',
            count: 40,
          }),
        ),
      ).rejects.toThrow(ValidationError);

      // A sale is the same rule — it is meat leaving the farm either way.
      await expect(
        service.recordMobTally(
          a.userId,
          schemas.recordMobTallyRequestSchema.parse({
            id: randomUUID(),
            farmId: a.farmId,
            mobId: flock!.id,
            occurredAt: '2026-08-16T06:00:00.000Z',
            reason: 'sale',
            count: 40,
          }),
        ),
      ).rejects.toThrow(ValidationError);

      // And the head count is untouched: a refused capture must not half-apply.
      const [row] = await app.asUser(a.userId, (tx) =>
        tx.select({ headCount: mobs.headCount }).from(mobs).where(eq(mobs.id, flock!.id)),
      );
      expect(row!.headCount).toBe(300);
    });

    it('never withholds a DEATH or a recount from a withheld flock', async () => {
      // The rule is about meat entering the food chain, not about recording what happened. Sheep
      // that died in a withdrawal still died, and refusing to record it would push the farmer to
      // record something false — or nothing, which is worse.
      const a = await tenant('Alpha');
      const [flock] = await elevated.db
        .insert(mobs)
        .values({
          farmId: a.farmId,
          name: 'Flock A',
          species: 'sheep',
          headCount: 300,
          initialHeadCount: 300,
        })
        .returning();
      const productId = await aVetProduct();

      await service.recordDip(
        a.userId,
        dipBody({
          farmId: a.farmId,
          animalId: null,
          mobId: flock!.id,
          productId,
          method: 'plunge',
        }),
      );

      const died = await service.recordMobTally(
        a.userId,
        schemas.recordMobTallyRequestSchema.parse({
          id: randomUUID(),
          farmId: a.farmId,
          mobId: flock!.id,
          occurredAt: '2026-08-16T06:00:00.000Z',
          reason: 'death',
          count: 5,
        }),
      );
      expect(died.type).toBe('tally');

      const counted = await service.recordMobTally(
        a.userId,
        schemas.recordMobTallyRequestSchema.parse({
          id: randomUUID(),
          farmId: a.farmId,
          mobId: flock!.id,
          occurredAt: '2026-08-16T07:00:00.000Z',
          reason: 'recount',
          count: 293,
        }),
      );
      expect(counted.type).toBe('tally');
    });

    it('allows the sale on the clear date itself', async () => {
      const a = await tenant('Alpha');
      const animalId = await anAnimal(a.farmId);
      const productId = await aVetProduct(); // meat 28d, clears 2026-08-17

      await service.recordTreatment(
        a.userId,
        treatmentBody({ farmId: a.farmId, animalId, productId, administeredOn: '2026-07-20' }),
      );

      const sold = await service.recordSale(
        a.userId,
        saleBody({ farmId: a.farmId, animalId, occurredAt: '2026-08-17T06:00:00.000Z' }),
      );

      expect(sold.type).toBe('sale');
    });

    it('leaves an untreated animal free to sell', async () => {
      const a = await tenant('Alpha');
      const animalId = await anAnimal(a.farmId);

      const sold = await service.recordSale(
        a.userId,
        saleBody({ farmId: a.farmId, animalId, occurredAt: '2026-07-20T06:00:00.000Z' }),
      );

      expect(sold.type).toBe('sale');
    });
  });

  // ── Stock-theft incident + evidence pack (FR-603/605) — COMPLIANCE-GATED ───────────────
  describe('stock-theft evidence pack (FR-603/605)', () => {
    /** An animal with a full ownership trail: a registered brand, an acquisition record, a tag —
     *  everything the evidence pack proves. Returns the ids the assertions need. */
    async function anAnimalWithTrail(farmId: string) {
      const [brand] = await elevated.db
        .insert(brandingRegisters)
        .values({
          farmId,
          mark: 'FR',
          markType: 'hot_brand',
          species: ['cattle'],
          certificateReference: 'AIS-FS-0042',
        })
        .returning();
      const [animal] = await elevated.db
        .insert(animals)
        .values({
          farmId,
          species: 'cattle',
          sex: 'female',
          brandId: brand!.id,
          acquiredAt: '2024-03-01',
          source: 'Bought at Senekal auction',
          photoKey: 'photos/heifer.jpg',
        })
        .returning();
      await elevated.db.insert(animalIdentifiers).values({
        farmId,
        animalId: animal!.id,
        type: 'visual_tag',
        value: 'FS-1024',
      });
      return { animalId: animal!.id };
    }

    /**
     * The visible text of a pdfkit document. It writes each run as a literal `(…) Tj`, so the
     * assertions below can be about what a Stock Theft Unit officer actually reads rather than
     * about the file being non-empty — which is all `%PDF-` proves.
     */
    function extractPdfText(pdf: Buffer): string {
      // pdfkit deflates its content streams, so the text is not in the bytes as-is. Inflate every
      // stream that will inflate, then pull the literal `(…) Tj` runs out of the page operators.
      const raw = pdf.toString('latin1');
      let text = '';
      for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
        const body = Buffer.from(match[1]!, 'latin1');
        let content: string;
        try {
          content = inflateSync(body).toString('latin1');
        } catch {
          content = body.toString('latin1');
        }
        // pdfkit emits each run as KERNED HEX inside a `TJ` array — `[<4d6f> 15 <76> …] TJ` — so
        // the letters are split across several `<…>` groups by the kerning pairs. Decoding every
        // hex group in the stream and concatenating puts the word back together.
        for (const show of content.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
          for (const hex of show[1]!.matchAll(/<([0-9A-Fa-f]+)>/g)) {
            text += Buffer.from(hex[1]!, 'hex').toString('latin1');
          }
          text += ' ';
        }
      }
      return text;
    }

    it('creates an incident, links its animals, and stores the last-seen GPS mirror via the trigger', async () => {
      const a = await tenant('Alpha');
      const { animalId } = await anAnimalWithTrail(a.farmId);

      const incident = await service.createTheftIncident(
        a.userId,
        theftIncidentBody({
          farmId: a.farmId,
          headCount: 1,
          caseNumber: 'CAS 123/07/2026',
          reportingStation: 'Senekal SAPS',
          observations: 'Fence cut on the northern boundary of Camp 3.',
          lastSeenAt: '2026-07-21T15:00:00.000Z',
          lastSeenLocationGeojson: '{"type":"Point","coordinates":[26.15,-29.1]}',
          animalIds: [animalId],
        }),
      );

      expect(incident.status).toBe('open');
      expect(incident.headCount).toBe(1);
      // WHO filed it, taken from the session and never the body. On a document handed to the SAPS
      // Stock Theft Unit, the reporter is part of the evidence rather than metadata.
      expect(incident.createdBy).toBe(a.userId);
      // The client-authored GeoJSON is preserved (the trigger is geometry->geojson; a client write
      // carries geojson directly, geometry stays null until Phase 3 ingest adds the reverse leg).
      expect(incident.lastSeenLocationGeojson).toContain('Point');

      const links = await app.asUser(a.userId, (tx) => tx.select().from(theftIncidentAnimals));
      expect(links.map((l) => l.animalId)).toContain(animalId);
    });

    it('refuses to link an animal from another farm, and writes no incident', async () => {
      const a = await tenant('Alpha');
      const b = await tenant('Bravo');
      const foreign = await anAnimalWithTrail(b.farmId);

      await expect(
        service.createTheftIncident(
          a.userId,
          theftIncidentBody({ farmId: a.farmId, animalIds: [foreign.animalId] }),
        ),
      ).rejects.toThrow(NotFoundError);

      const written = await app.asUser(a.userId, (tx) => tx.select().from(theftIncidents));
      expect(written).toHaveLength(0);
    });

    it('refuses a stranger creating an incident on another farm', async () => {
      const a = await tenant('Alpha');
      const b = await tenant('Bravo');

      await expect(
        service.createTheftIncident(b.userId, theftIncidentBody({ farmId: a.farmId })),
      ).rejects.toThrow(NotFoundError);
    });

    it('assembles a facts-only pack: identification, ownership chain, brand certificate, last-seen', async () => {
      const a = await tenant('Alpha');
      const { animalId } = await anAnimalWithTrail(a.farmId);
      const incident = await service.createTheftIncident(
        a.userId,
        theftIncidentBody({
          farmId: a.farmId,
          headCount: 1,
          caseNumber: 'CAS 123/07/2026',
          reportingStation: 'Senekal SAPS',
          lastSeenAt: '2026-07-21T15:00:00.000Z',
          animalIds: [animalId],
        }),
      );

      const pack = await service.buildEvidencePack(a.userId, incident.id);

      expect(pack.headCount).toBe(1);
      expect(pack.brandCertificateReference).toBe('AIS-FS-0042');
      expect(pack.caseNumber).toBe('CAS 123/07/2026');
      expect(pack.lastSeenAt?.toISOString()).toBe('2026-07-21T15:00:00.000Z');
      expect(pack.animals).toHaveLength(1);
      expect(pack.animals[0]).toMatchObject({
        animalId,
        mark: 'FR',
        acquiredAt: '2024-03-01',
        source: 'Bought at Senekal auction',
        identifiers: [{ type: 'visual_tag', value: 'FS-1024' }],
      });
      // ⛔ The pack can never carry an accusation (POPIA s26).
      expect(pack).not.toHaveProperty('suspect');
    });

    it('renders the pack to a PDF a farmer can hand the Stock Theft Unit', async () => {
      const a = await tenant('Alpha');
      const { animalId } = await anAnimalWithTrail(a.farmId);
      const incident = await service.createTheftIncident(
        a.userId,
        theftIncidentBody({ farmId: a.farmId, headCount: 1, animalIds: [animalId] }),
      );

      const pack = await service.buildEvidencePack(a.userId, incident.id);
      const pdf = await renderEvidencePackPdf(pack);

      expect(pdf.length).toBeGreaterThan(0);
      expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');

      // ⭐ And it says what it is supposed to say. Asserting only the magic bytes let the whole
      // renderer be reverted without a single test noticing — including the line that used to
      // claim "Photograph on file: Yes" for an image nobody can be shown.
      const text = extractPdfText(pdf);
      expect(text).toContain('Movement history');
      expect(text).toContain('Treatment history');
      expect(text).toContain('image not attached to this pack');
      expect(text).not.toContain('Photograph on file: Yes');
    });

    it('⭐ carries the POSSESSION TRAIL — movements, and doses given to the animal AND its mob', async () => {
      // legal-compliance.md § 3.2, and the reverse-onus defence. Identification says the animal is
      // yours; this says it was HERE, being kept and treated, right up to the loss.
      //
      // The mob dose is the half that was missing and it is the smallholder's half: a plunge dip is
      // captured against the flock and stores `animal_id = NULL`, so an animal dipped with its mob
      // every month printed "None recorded" in the document meant to show continuous husbandry.
      const a = await tenant('Alpha');
      const { animalId } = await anAnimalWithTrail(a.farmId);
      const [dipCamp] = await elevated.db
        .insert(mobs)
        .values({ farmId: a.farmId, name: 'Dip camp mob', species: 'cattle' })
        .returning();
      const [noord] = await elevated.db
        .insert(landUnits)
        .values({ farmId: a.farmId, kind: 'camp', code: 'NOORD' })
        .returning();
      const productId = await aVetProduct();

      await elevated.db.update(animals).set({ mobId: dipCamp!.id }).where(eq(animals.id, animalId));

      // Its own treatment, a whole-mob dip it was present for, and a walk to another camp.
      await service.recordTreatment(
        a.userId,
        treatmentBody({
          farmId: a.farmId,
          animalId,
          productId,
          occurredAt: '2026-07-10T06:00:00.000Z',
          administeredOn: '2026-07-10',
        }),
      );
      await service.recordDip(
        a.userId,
        dipBody({
          farmId: a.farmId,
          animalId: null,
          mobId: dipCamp!.id,
          productId,
          occurredAt: '2026-07-12T06:00:00.000Z',
          administeredOn: '2026-07-12',
          method: 'plunge',
        }),
      );
      await service.recordMove(
        a.userId,
        schemas.recordMoveRequestSchema.parse({
          id: randomUUID(),
          farmId: a.farmId,
          animalId,
          occurredAt: '2026-07-14T06:00:00.000Z',
          toLandUnitId: noord!.id,
        }),
      );

      const incident = await service.createTheftIncident(
        a.userId,
        theftIncidentBody({ farmId: a.farmId, headCount: 1, animalIds: [animalId] }),
      );
      const pack = await service.buildEvidencePack(a.userId, incident.id);
      const [entry] = pack.animals;

      // The camp is named by its CODE — a pack goes to a police station, and a uuid tells them
      // nothing.
      expect(entry!.movements).toHaveLength(1);
      expect(entry!.movements[0]).toMatchObject({ to: 'NOORD' });

      // BOTH routes, in occurrence order.
      expect(entry!.treatments.map((t) => t.kind)).toEqual(['treatment', 'dip']);
      expect(entry!.treatments.every((t) => t.product.length > 0)).toBe(true);
    });

    it('⭐ keeps a RETIRED identifier, flagged — it is the number the animal was wearing', async () => {
      // Every other read in the product excludes tombstones and is right to. This document is the
      // exception: a tag replaced after the loss is the number on the animal at a roadblock.
      const a = await tenant('Alpha');
      const { animalId } = await anAnimalWithTrail(a.farmId);
      await elevated.db.insert(animalIdentifiers).values({
        farmId: a.farmId,
        animalId,
        type: 'visual_tag',
        value: 'FS-0311',
        deletedAt: new Date('2026-07-01T00:00:00.000Z'),
      });

      const incident = await service.createTheftIncident(
        a.userId,
        theftIncidentBody({ farmId: a.farmId, headCount: 1, animalIds: [animalId] }),
      );
      const pack = await service.buildEvidencePack(a.userId, incident.id);
      const identifiers = pack.animals[0]!.identifiers;

      expect(identifiers).toContainEqual({ type: 'visual_tag', value: 'FS-1024', retired: false });
      expect(identifiers).toContainEqual({ type: 'visual_tag', value: 'FS-0311', retired: true });
    });

    it('does not name ONE certificate over an incident whose stock carries different marks', async () => {
      // Naming a single certificate over a mixed set asserts registered ownership over animals it
      // does not cover — an over-claim in the one document whose value is that each line is a fact.
      const a = await tenant('Alpha');
      const { animalId: first } = await anAnimalWithTrail(a.farmId);
      const [unmarked] = await elevated.db
        .insert(animals)
        .values({ farmId: a.farmId, species: 'cattle', sex: 'female' })
        .returning();

      const incident = await service.createTheftIncident(
        a.userId,
        theftIncidentBody({ farmId: a.farmId, headCount: 2, animalIds: [first, unmarked!.id] }),
      );
      const pack = await service.buildEvidencePack(a.userId, incident.id);

      expect(pack.brandCertificateReference).toBeNull();
      const refs = pack.animals.map((an) => an.certificateReference);
      expect(refs).toContain('AIS-FS-0042');
      expect(refs).toContain(null);
    });

    it('is a 404 for an incident on another farm', async () => {
      const a = await tenant('Alpha');
      const b = await tenant('Bravo');
      const incident = await service.createTheftIncident(
        b.userId,
        theftIncidentBody({ farmId: b.farmId }),
      );

      await expect(service.buildEvidencePack(a.userId, incident.id)).rejects.toThrow(NotFoundError);
    });
  });
});
