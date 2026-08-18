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
  auditLog,
  chemicalProducts,
  createAppDb,
  createElevatedDb,
  events,
  farmUsers,
  landUnits,
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

/** A minimal valid fertiliser body; overlay the fields a test cares about. */
const fertiliserBody = (
  over: Partial<ZodInput<typeof schemas.recordFertiliserRequestSchema>> & {
    farmId: string;
    landUnitId: string;
  },
): schemas.RecordFertiliserRequest =>
  schemas.recordFertiliserRequestSchema.parse({
    id: uuidv7(),
    occurredAt: '2026-09-20T06:15:00.000Z',
    product: 'LAN 28%',
    method: 'broadcast',
    ...over,
  });

/** A minimal valid spray body; overlay the fields a test cares about. `productId` has no default —
 *  every test creates its own `chemical_products` row and must name it. */
const sprayBody = (
  over: Partial<ZodInput<typeof schemas.recordSprayRequestSchema>> & {
    farmId: string;
    landUnitId: string;
    productId: string;
  },
): schemas.RecordSprayRequest =>
  schemas.recordSprayRequestSchema.parse({
    id: uuidv7(),
    occurredAt: '2026-10-05T05:00:00.000Z',
    sprayedOn: '2026-10-05',
    ...over,
  });

/** A minimal valid harvest body; overlay the fields a test cares about. */
const harvestBody = (
  over: Partial<ZodInput<typeof schemas.recordHarvestRequestSchema>> & {
    farmId: string;
    landUnitId: string;
  },
): schemas.RecordHarvestRequest =>
  schemas.recordHarvestRequestSchema.parse({
    id: uuidv7(),
    occurredAt: '2026-11-01T06:00:00.000Z',
    harvestedOn: '2026-11-01',
    quantity: 12.5,
    unit: 'ton',
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

  /** Reference data is written by the elevated admin path, never by a farmer. */
  async function aChemicalProduct(over: Partial<typeof chemicalProducts.$inferInsert> = {}) {
    const [row] = await elevated.db
      .insert(chemicalProducts)
      .values({
        jurisdiction: 'ZA',
        name: 'Cyprodinex 50 WG',
        registrationNumber: 'L1234',
        activeIngredients: ['cyprodinil'],
        crop: 'grapes',
        phiDays: 7,
        effectiveFrom: '2020-01-01',
        ...over,
      })
      .returning();
    return row!;
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

  describe('fertiliser capture (FR-206)', () => {
    it('records a fertiliser application as an append-only event scoped to the BLOCK, not a herd', async () => {
      const a = await tenant('Crop');
      const landUnitId = await block(a);

      const captured = await service.recordFertiliser(
        a.userId,
        fertiliserBody({ farmId: a.farmId, landUnitId, operator: 'Sipho' }),
      );

      expect(captured.type).toBe('fertiliser');
      expect(captured.payload).toEqual({
        product: 'LAN 28%',
        method: 'broadcast',
        operator: 'Sipho',
      });
      expect(captured.landUnitId).toBe(landUnitId);
      expect(captured.createdBy).toBe(a.userId);
      expect(captured.enterpriseId).toBeNull();
      expect(captured.animalId).toBeNull();
      expect(captured.mobId).toBeNull();

      const seen = await app.asUser(a.userId, (tx) => tx.select().from(events));
      expect(seen.map((e) => e.id)).toContain(captured.id);
    });

    it('carries fertigation as a real method, with its rate, not a note bolted onto broadcast', async () => {
      const a = await tenant('Crop');
      const landUnitId = await block(a);

      const captured = await service.recordFertiliser(
        a.userId,
        fertiliserBody({
          farmId: a.farmId,
          landUnitId,
          method: 'fertigation',
          rate: { value: 12, unit: 'L/ha' },
        }),
      );

      expect(captured.payload).toMatchObject({
        method: 'fertigation',
        rate: { value: 12, unit: 'L/ha' },
      });
    });

    it('is idempotent on the client id, so a re-flush does not create a second application', async () => {
      const a = await tenant('Crop');
      const landUnitId = await block(a);
      const body = fertiliserBody({ farmId: a.farmId, landUnitId });

      const first = await service.recordFertiliser(a.userId, body);
      const again = await service.recordFertiliser(a.userId, body);

      expect(again.id).toBe(first.id);
      const rows = await app.asUser(a.userId, (tx) => tx.select().from(events));
      expect(rows).toHaveLength(1);
    });

    it('refuses a fertiliser application against a block that does not exist on this farm', async () => {
      const a = await tenant('Crop');

      await expect(
        service.recordFertiliser(
          a.userId,
          fertiliserBody({ farmId: a.farmId, landUnitId: uuidv7() }),
        ),
      ).rejects.toThrow(NotFoundError);

      const rows = await elevated.db.select().from(events);
      expect(rows).toHaveLength(0);
    });

    it("refuses a fertiliser application against ANOTHER farm's block — a cross-tenant reference", async () => {
      const a = await tenant('Crop');
      const b = await tenant('Other');
      const othersBlock = await block(b);

      await expect(
        service.recordFertiliser(
          a.userId,
          fertiliserBody({ farmId: a.farmId, landUnitId: othersBlock }),
        ),
      ).rejects.toThrow(NotFoundError);

      const rows = await elevated.db.select().from(events);
      expect(rows).toHaveLength(0);
    });
  });

  describe('spray capture (FR-204) — COMPLIANCE-GATED', () => {
    it('resolves the PHI from the registered product and stores the earliest harvest date (ADR-0005)', async () => {
      const a = await tenant('Crop');
      const landUnitId = await block(a);
      const product = await aChemicalProduct({ phiDays: 7 });

      const captured = await service.recordSpray(
        a.userId,
        sprayBody({ farmId: a.farmId, landUnitId, productId: product.id }),
      );

      expect(captured.type).toBe('spray');
      expect(captured.payload).toMatchObject({
        productId: product.id,
        activeIngredients: ['cyprodinil'],
        sprayedOn: '2026-10-05',
        phiDays: 7,
        earliestHarvestDate: '2026-10-12',
      });
      expect(captured.landUnitId).toBe(landUnitId);
      expect(captured.enterpriseId).toBeNull();
      expect(captured.animalId).toBeNull();
      expect(captured.mobId).toBeNull();
    });

    it('⭐ OMITS phiDays/earliestHarvestDate, never zero, when the product carries no PHI on record', async () => {
      const a = await tenant('Crop');
      const landUnitId = await block(a);
      const product = await aChemicalProduct({ phiDays: null });

      const captured = await service.recordSpray(
        a.userId,
        sprayBody({ farmId: a.farmId, landUnitId, productId: product.id }),
      );

      expect(Object.keys(captured.payload as object)).not.toContain('phiDays');
      expect(Object.keys(captured.payload as object)).not.toContain('earliestHarvestDate');
    });

    it('never trusts a client-sent PHI or active ingredients — the server always resolves its own', async () => {
      const a = await tenant('Crop');
      const landUnitId = await block(a);
      const product = await aChemicalProduct({ phiDays: 7, activeIngredients: ['cyprodinil'] });

      // The wire schema itself has no phiDays/activeIngredients fields to smuggle through — this
      // proves the RESOLVED figure is what lands, not a coincidence of the schema shape.
      const captured = await service.recordSpray(
        a.userId,
        sprayBody({ farmId: a.farmId, landUnitId, productId: product.id }),
      );

      expect(captured.payload).toMatchObject({ phiDays: 7, activeIngredients: ['cyprodinil'] });
    });

    it('resolves the registration IN FORCE ON THE SPRAY DAY, not today’s', async () => {
      const a = await tenant('Crop');
      const landUnitId = await block(a);
      const oldVersion = await aChemicalProduct({
        effectiveFrom: '2020-01-01',
        effectiveTo: '2026-04-01',
        phiDays: 14,
      });

      const captured = await service.recordSpray(
        a.userId,
        sprayBody({
          farmId: a.farmId,
          landUnitId,
          productId: oldVersion.id,
          sprayedOn: '2026-02-01',
        }),
      );

      expect(captured.payload).toMatchObject({ phiDays: 14 });
    });

    it('refuses a spray against a version no longer in force on the spray day — a stale cached row', async () => {
      // The device's cache may hold a superseded registration; the server is the one that decides
      // whether it was still current on the day being captured (ADR-0005, same discipline
      // `resolveVetProduct` proves for a treatment).
      const a = await tenant('Crop');
      const landUnitId = await block(a);
      const supersededVersion = await aChemicalProduct({
        effectiveFrom: '2020-01-01',
        effectiveTo: '2026-04-01',
        phiDays: 14,
      });

      await expect(
        service.recordSpray(
          a.userId,
          sprayBody({
            farmId: a.farmId,
            landUnitId,
            productId: supersededVersion.id,
            sprayedOn: '2026-10-05',
          }),
        ),
      ).rejects.toThrow(NotFoundError);
    });

    it('refuses a spray against a product not registered in this farm’s jurisdiction', async () => {
      const a = await tenant('Crop');
      const landUnitId = await block(a);
      const naProduct = await aChemicalProduct({ jurisdiction: 'NA' });

      await expect(
        service.recordSpray(
          a.userId,
          sprayBody({ farmId: a.farmId, landUnitId, productId: naProduct.id }),
        ),
      ).rejects.toThrow(NotFoundError);
    });

    it('refuses a spray against a block that does not exist on this farm', async () => {
      const a = await tenant('Crop');
      const product = await aChemicalProduct({});

      await expect(
        service.recordSpray(
          a.userId,
          sprayBody({ farmId: a.farmId, landUnitId: uuidv7(), productId: product.id }),
        ),
      ).rejects.toThrow(NotFoundError);
    });

    it('is idempotent on the client id, so a re-flush does not create a second spray', async () => {
      const a = await tenant('Crop');
      const landUnitId = await block(a);
      const product = await aChemicalProduct({});
      const body = sprayBody({ farmId: a.farmId, landUnitId, productId: product.id });

      const first = await service.recordSpray(a.userId, body);
      const again = await service.recordSpray(a.userId, body);

      expect(again.id).toBe(first.id);
      const rows = await app.asUser(a.userId, (tx) => tx.select().from(events));
      expect(rows).toHaveLength(1);
    });
  });

  describe('spray-capture PHI block (legal-compliance.md § 4.3) — the EARLY half, complementing FR-205', () => {
    it('blocks a spray whose resulting PHI would clear AFTER the block’s planned harvest date', async () => {
      const a = await tenant('Crop');
      const landUnitId = await block(a);
      await service.recordPlanting(
        a.userId,
        plantingBody({ farmId: a.farmId, landUnitId, expectedHarvestDate: '2026-03-15' }),
      );
      const product = await aChemicalProduct({ name: 'Cyprodinex 50 WG', phiDays: 21 });

      await expect(
        service.recordSpray(
          a.userId,
          sprayBody({
            farmId: a.farmId,
            landUnitId,
            productId: product.id,
            sprayedOn: '2026-03-01',
            occurredAt: '2026-03-01T08:00:00.000Z',
          }),
        ),
      ).rejects.toThrow(/Cyprodinex 50 WG.*2026-03-22.*2026-03-15/s);

      const rows = await elevated.db.select().from(events).where(eq(events.type, 'spray'));
      expect(rows).toHaveLength(0);
    });

    it('proceeds with no warning when the block has no planned harvest date on record', async () => {
      const a = await tenant('Crop');
      const landUnitId = await block(a);
      const product = await aChemicalProduct({ phiDays: 21 });

      const captured = await service.recordSpray(
        a.userId,
        sprayBody({ farmId: a.farmId, landUnitId, productId: product.id, sprayedOn: '2026-03-01' }),
      );

      expect(captured.payload).not.toHaveProperty('phiOverride');
    });

    it('proceeds when the planned harvest is safely after the PHI clears', async () => {
      const a = await tenant('Crop');
      const landUnitId = await block(a);
      await service.recordPlanting(
        a.userId,
        plantingBody({ farmId: a.farmId, landUnitId, expectedHarvestDate: '2026-04-01' }),
      );
      const product = await aChemicalProduct({ phiDays: 21 });

      const captured = await service.recordSpray(
        a.userId,
        sprayBody({
          farmId: a.farmId,
          landUnitId,
          productId: product.id,
          sprayedOn: '2026-03-01',
          occurredAt: '2026-03-01T08:00:00.000Z',
        }),
      );

      expect(captured.payload).not.toHaveProperty('phiOverride');
    });

    it('a product with no PHI on record blocks nothing, even against a same-day planned harvest', async () => {
      const a = await tenant('Crop');
      const landUnitId = await block(a);
      await service.recordPlanting(
        a.userId,
        plantingBody({ farmId: a.farmId, landUnitId, expectedHarvestDate: '2026-03-01' }),
      );
      const product = await aChemicalProduct({ phiDays: null });

      const captured = await service.recordSpray(
        a.userId,
        sprayBody({ farmId: a.farmId, landUnitId, productId: product.id, sprayedOn: '2026-03-01' }),
      );

      expect(captured.payload).not.toHaveProperty('phiOverride');
    });

    it('FR-202: blocks using an ANCESTOR block’s planting — a split inherits it, unbounded', async () => {
      const a = await tenant('Crop');
      const parentId = await block(a);
      await service.recordPlanting(
        a.userId,
        plantingBody({ farmId: a.farmId, landUnitId: parentId, expectedHarvestDate: '2026-03-15' }),
      );
      const child = await land.createLandUnit(
        a.userId,
        blockBody({ farmId: a.farmId, code: 'B12-A', parentId }),
      );
      const product = await aChemicalProduct({ name: 'Cyprodinex 50 WG', phiDays: 21 });

      await expect(
        service.recordSpray(
          a.userId,
          sprayBody({
            farmId: a.farmId,
            landUnitId: child.id,
            productId: product.id,
            sprayedOn: '2026-03-01',
            occurredAt: '2026-03-01T08:00:00.000Z',
          }),
        ),
      ).rejects.toThrow(/Cyprodinex 50 WG/);
    });

    it('an override is accepted, stores the reason and audits it — never silent', async () => {
      const a = await tenant('Crop');
      const landUnitId = await block(a);
      await service.recordPlanting(
        a.userId,
        plantingBody({ farmId: a.farmId, landUnitId, expectedHarvestDate: '2026-03-15' }),
      );
      const product = await aChemicalProduct({ phiDays: 21 });

      const captured = await service.recordSpray(
        a.userId,
        sprayBody({
          farmId: a.farmId,
          landUnitId,
          productId: product.id,
          sprayedOn: '2026-03-01',
          occurredAt: '2026-03-01T08:00:00.000Z',
          phiOverride: { reason: 'Emergency pest outbreak — advised to spray immediately' },
        }),
      );

      expect(captured.payload).toMatchObject({
        phiOverride: {
          reason: 'Emergency pest outbreak — advised to spray immediately',
          by: a.userId,
        },
      });

      const audit = await elevated.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.recordId, captured.id));
      expect(audit).toHaveLength(1);
      expect(audit[0]!.action).toBe('phi_override');
      expect(audit[0]!.userId).toBe(a.userId);
      expect(audit[0]!.rule).toMatch(/§ 4\.3/);
    });

    it('never carries an override for a spray the guard did not actually block', async () => {
      const a = await tenant('Crop');
      const landUnitId = await block(a);
      const product = await aChemicalProduct({ phiDays: 21 });

      const captured = await service.recordSpray(
        a.userId,
        sprayBody({
          farmId: a.farmId,
          landUnitId,
          productId: product.id,
          sprayedOn: '2026-03-01',
          phiOverride: { reason: 'Just in case' },
        }),
      );

      expect(captured.payload).not.toHaveProperty('phiOverride');
      const audit = await elevated.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.recordId, captured.id));
      expect(audit).toHaveLength(0);
    });

    it('is idempotent BEFORE validation: a re-flushed spray does not re-run the guard or double-audit', async () => {
      const a = await tenant('Crop');
      const landUnitId = await block(a);
      await service.recordPlanting(
        a.userId,
        plantingBody({ farmId: a.farmId, landUnitId, expectedHarvestDate: '2026-03-15' }),
      );
      const product = await aChemicalProduct({ phiDays: 21 });
      const body = sprayBody({
        farmId: a.farmId,
        landUnitId,
        productId: product.id,
        sprayedOn: '2026-03-01',
        occurredAt: '2026-03-01T08:00:00.000Z',
        phiOverride: { reason: 'Export deadline' },
      });

      const first = await service.recordSpray(a.userId, body);
      const again = await service.recordSpray(a.userId, body);

      expect(again.id).toBe(first.id);
      const rows = await app.asUser(a.userId, (tx) =>
        tx.select().from(events).where(eq(events.type, 'spray')),
      );
      expect(rows).toHaveLength(1);
      const audit = await elevated.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.recordId, first.id));
      expect(audit).toHaveLength(1);
    });
  });

  describe('spray history report (FR-211)', () => {
    it('lists sprays for the farm, newest first, with the registered product name resolved', async () => {
      const a = await tenant('Crop');
      const landUnitId = await block(a);
      const product = await aChemicalProduct({ name: 'Cyprodinex 50 WG', phiDays: 7 });
      await service.recordSpray(
        a.userId,
        sprayBody({
          farmId: a.farmId,
          landUnitId,
          productId: product.id,
          sprayedOn: '2026-10-01',
          occurredAt: '2026-10-01T05:00:00.000Z',
        }),
      );
      await service.recordSpray(
        a.userId,
        sprayBody({
          farmId: a.farmId,
          landUnitId,
          productId: product.id,
          sprayedOn: '2026-10-10',
          occurredAt: '2026-10-10T05:00:00.000Z',
        }),
      );

      const report = await service.listSprayHistory(a.userId, a.farmId, {});

      expect(report.map((r) => r.sprayedOn)).toEqual(['2026-10-10', '2026-10-01']);
      expect(report[0]!.productName).toBe('Cyprodinex 50 WG');
      expect(report[0]!.phiDays).toBe(7);
    });

    it('narrows to one block', async () => {
      const a = await tenant('Crop');
      const blockA = await block(a);
      const blockB = await land.createLandUnit(
        a.userId,
        blockBody({ farmId: a.farmId, code: 'B13' }),
      );
      const product = await aChemicalProduct({});
      await service.recordSpray(
        a.userId,
        sprayBody({ farmId: a.farmId, landUnitId: blockA, productId: product.id }),
      );
      await service.recordSpray(
        a.userId,
        sprayBody({ farmId: a.farmId, landUnitId: blockB.id, productId: product.id }),
      );

      const report = await service.listSprayHistory(a.userId, a.farmId, { landUnitId: blockA });

      expect(report).toHaveLength(1);
      expect(report[0]!.landUnitId).toBe(blockA);
    });

    it('narrows to a date range on the spray day, not the row-written day', async () => {
      const a = await tenant('Crop');
      const landUnitId = await block(a);
      const product = await aChemicalProduct({});
      await service.recordSpray(
        a.userId,
        sprayBody({
          farmId: a.farmId,
          landUnitId,
          productId: product.id,
          sprayedOn: '2026-09-01',
          occurredAt: '2026-09-01T05:00:00.000Z',
        }),
      );
      await service.recordSpray(
        a.userId,
        sprayBody({
          farmId: a.farmId,
          landUnitId,
          productId: product.id,
          sprayedOn: '2026-10-01',
          occurredAt: '2026-10-01T05:00:00.000Z',
        }),
      );

      const report = await service.listSprayHistory(a.userId, a.farmId, {
        from: '2026-09-15',
        to: '2026-10-15',
      });

      expect(report.map((r) => r.sprayedOn)).toEqual(['2026-10-01']);
    });

    it('never leaks another farm’s sprays', async () => {
      const a = await tenant('Crop');
      const b = await tenant('Other');
      const landUnitId = await block(a);
      const product = await aChemicalProduct({});
      await service.recordSpray(
        a.userId,
        sprayBody({ farmId: a.farmId, landUnitId, productId: product.id }),
      );

      await expect(service.listSprayHistory(b.userId, a.farmId, {})).rejects.toThrow(NotFoundError);
    });

    it('⭐ breaks a same-day tie by id, never leaving two same-occurredAt sprays in query-plan order', async () => {
      // Two back-dated captures land on the SAME day, so RecordSprayScreen stamps them both at the
      // identical noon instant (`sprayedInstant`) — an ordinary case, not a contrived one.
      const a = await tenant('Crop');
      const landUnitId = await block(a);
      const product = await aChemicalProduct({});
      const [lowerId, higherId] = [uuidv7(), uuidv7()].sort() as [string, string];

      // Inserted in ASCENDING id order deliberately — so a naive scan-order/insertion-order result
      // (what the pre-fix `.orderBy(desc(occurredAt))` alone actually returns) disagrees with the
      // expected DESCENDING-by-id order below, and this test cannot pass by accident.
      await service.recordSpray(
        a.userId,
        sprayBody({
          id: lowerId,
          farmId: a.farmId,
          landUnitId,
          productId: product.id,
          sprayedOn: '2026-10-05',
          occurredAt: '2026-10-05T12:00:00.000Z',
        }),
      );
      await service.recordSpray(
        a.userId,
        sprayBody({
          id: higherId,
          farmId: a.farmId,
          landUnitId,
          productId: product.id,
          sprayedOn: '2026-10-05',
          occurredAt: '2026-10-05T12:00:00.000Z',
        }),
      );

      const report = await service.listSprayHistory(a.userId, a.farmId, {});

      expect(report.map((r) => r.id)).toEqual([higherId, lowerId]);
    });
  });

  describe('harvest capture (FR-207) — COMPLIANCE-GATED (US-030)', () => {
    it('records a harvest as an append-only event scoped to the BLOCK, not a herd', async () => {
      const a = await tenant('Crop');
      const landUnitId = await block(a);

      const captured = await service.recordHarvest(
        a.userId,
        harvestBody({ farmId: a.farmId, landUnitId, grade: 'Class 1', destination: 'Pack shed A' }),
      );

      expect(captured.type).toBe('harvest');
      expect(captured.payload).toEqual({
        harvestedOn: '2026-11-01',
        quantity: 12.5,
        unit: 'ton',
        grade: 'Class 1',
        destination: 'Pack shed A',
      });
      expect(captured.landUnitId).toBe(landUnitId);
      expect(captured.createdBy).toBe(a.userId);
      expect(captured.enterpriseId).toBeNull();
      expect(captured.animalId).toBeNull();
      expect(captured.mobId).toBeNull();
    });

    it('proceeds with no warning when the block has never been sprayed', async () => {
      const a = await tenant('Crop');
      const landUnitId = await block(a);

      const captured = await service.recordHarvest(
        a.userId,
        harvestBody({ farmId: a.farmId, landUnitId }),
      );

      expect(captured.payload).not.toHaveProperty('phiOverride');
    });

    it("US-030's own gherkin: blocks a harvest inside a spray's PHI, naming the product/date/earliest date", async () => {
      const a = await tenant('Crop');
      const landUnitId = await block(a);
      const product = await aChemicalProduct({ name: 'Cyprodinex 50 WG', phiDays: 21 });
      await service.recordSpray(
        a.userId,
        sprayBody({
          farmId: a.farmId,
          landUnitId,
          productId: product.id,
          sprayedOn: '2026-03-01',
          occurredAt: '2026-03-01T08:00:00.000Z',
        }),
      );

      await expect(
        service.recordHarvest(
          a.userId,
          harvestBody({ farmId: a.farmId, landUnitId, harvestedOn: '2026-03-15' }),
        ),
      ).rejects.toThrow(/Cyprodinex 50 WG.*2026-03-01.*2026-03-22/s);

      const rows = await elevated.db.select().from(events).where(eq(events.type, 'harvest'));
      expect(rows).toHaveLength(0);
    });

    it('US-030: proceeds normally once the PHI clears', async () => {
      const a = await tenant('Crop');
      const landUnitId = await block(a);
      const product = await aChemicalProduct({ phiDays: 21 });
      await service.recordSpray(
        a.userId,
        sprayBody({
          farmId: a.farmId,
          landUnitId,
          productId: product.id,
          sprayedOn: '2026-03-01',
          occurredAt: '2026-03-01T08:00:00.000Z',
        }),
      );

      const captured = await service.recordHarvest(
        a.userId,
        harvestBody({ farmId: a.farmId, landUnitId, harvestedOn: '2026-03-23' }),
      );

      expect(captured.payload).not.toHaveProperty('phiOverride');
    });

    it('a spray with no PHI on record blocks nothing', async () => {
      const a = await tenant('Crop');
      const landUnitId = await block(a);
      const product = await aChemicalProduct({ phiDays: null });
      await service.recordSpray(
        a.userId,
        sprayBody({ farmId: a.farmId, landUnitId, productId: product.id, sprayedOn: '2026-03-01' }),
      );

      const captured = await service.recordHarvest(
        a.userId,
        harvestBody({ farmId: a.farmId, landUnitId, harvestedOn: '2026-03-02' }),
      );

      expect(captured.payload).not.toHaveProperty('phiOverride');
    });

    it('ignores a spray on an unrelated block', async () => {
      const a = await tenant('Crop');
      const sprayedBlock = await block(a);
      const harvestedBlock = await land.createLandUnit(
        a.userId,
        blockBody({ farmId: a.farmId, code: 'B13' }),
      );
      const product = await aChemicalProduct({ phiDays: 21 });
      await service.recordSpray(
        a.userId,
        sprayBody({
          farmId: a.farmId,
          landUnitId: sprayedBlock,
          productId: product.id,
          sprayedOn: '2026-03-01',
        }),
      );

      const captured = await service.recordHarvest(
        a.userId,
        harvestBody({ farmId: a.farmId, landUnitId: harvestedBlock.id, harvestedOn: '2026-03-05' }),
      );

      expect(captured.payload).not.toHaveProperty('phiOverride');
    });

    it("4d·4: blocks on an ancestor block's pre-split spray history, not just the leaf's own", async () => {
      const a = await tenant('Crop');
      const parentId = await block(a);
      const child = await land.createLandUnit(
        a.userId,
        blockBody({ farmId: a.farmId, code: 'B12-A', parentId }),
      );
      // The exact instant the child became its own capturable unit — queried rather than assumed,
      // so this test is not fragile against wall-clock skew between fixture dates and test runtime.
      const [childRow] = await elevated.db
        .select({ createdAt: landUnits.createdAt })
        .from(landUnits)
        .where(eq(landUnits.id, child.id));
      const splitAt = childRow!.createdAt;
      const sprayedOn = new Date(splitAt.getTime() - 24 * 60 * 60 * 1000);
      const product = await aChemicalProduct({ name: 'Cyprodinex 50 WG', phiDays: 21 });
      // Sprayed on the PARENT, before the split.
      await service.recordSpray(
        a.userId,
        sprayBody({
          farmId: a.farmId,
          landUnitId: parentId,
          productId: product.id,
          sprayedOn: sprayedOn.toISOString().slice(0, 10),
          occurredAt: sprayedOn.toISOString(),
        }),
      );

      await expect(
        service.recordHarvest(
          a.userId,
          harvestBody({
            farmId: a.farmId,
            landUnitId: child.id,
            harvestedOn: sprayedOn.toISOString().slice(0, 10),
          }),
        ),
      ).rejects.toThrow(/Cyprodinex 50 WG/);
    });

    it('FR-205: an override is accepted, stores the reason and audits it — never silent', async () => {
      const a = await tenant('Crop');
      const landUnitId = await block(a);
      const product = await aChemicalProduct({ name: 'Cyprodinex 50 WG', phiDays: 21 });
      await service.recordSpray(
        a.userId,
        sprayBody({
          farmId: a.farmId,
          landUnitId,
          productId: product.id,
          sprayedOn: '2026-03-01',
          occurredAt: '2026-03-01T08:00:00.000Z',
        }),
      );

      const captured = await service.recordHarvest(
        a.userId,
        harvestBody({
          farmId: a.farmId,
          landUnitId,
          harvestedOn: '2026-03-15',
          phiOverride: { reason: 'Export deadline — buyer contract on file' },
        }),
      );

      expect(captured.payload).toMatchObject({
        phiOverride: { reason: 'Export deadline — buyer contract on file', by: a.userId },
      });

      const audit = await elevated.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.recordId, captured.id));
      expect(audit).toHaveLength(1);
      expect(audit[0]!.action).toBe('phi_override');
      expect(audit[0]!.userId).toBe(a.userId);
    });

    it('never carries an override for a harvest the guard did not actually block', async () => {
      // A client that sent a reason speculatively (its own local preview disagreed with the
      // server) must not get a false "overridden" audit trail for a block that was never blocked.
      const a = await tenant('Crop');
      const landUnitId = await block(a);

      const captured = await service.recordHarvest(
        a.userId,
        harvestBody({
          farmId: a.farmId,
          landUnitId,
          phiOverride: { reason: 'Just in case' },
        }),
      );

      expect(captured.payload).not.toHaveProperty('phiOverride');
      const audit = await elevated.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.recordId, captured.id));
      expect(audit).toHaveLength(0);
    });

    it('is idempotent BEFORE validation: a re-flushed harvest does not re-run the guard or double-audit', async () => {
      const a = await tenant('Crop');
      const landUnitId = await block(a);
      const product = await aChemicalProduct({ phiDays: 21 });
      await service.recordSpray(
        a.userId,
        sprayBody({
          farmId: a.farmId,
          landUnitId,
          productId: product.id,
          sprayedOn: '2026-03-01',
          occurredAt: '2026-03-01T08:00:00.000Z',
        }),
      );
      const body = harvestBody({
        farmId: a.farmId,
        landUnitId,
        harvestedOn: '2026-03-15',
        phiOverride: { reason: 'Export deadline' },
      });

      const first = await service.recordHarvest(a.userId, body);
      const again = await service.recordHarvest(a.userId, body);

      expect(again.id).toBe(first.id);
      const rows = await app.asUser(a.userId, (tx) =>
        tx.select().from(events).where(eq(events.type, 'harvest')),
      );
      expect(rows).toHaveLength(1);
      const audit = await elevated.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.recordId, first.id));
      expect(audit).toHaveLength(1);
    });

    it('refuses a harvest against a block that does not exist on this farm', async () => {
      const a = await tenant('Crop');

      await expect(
        service.recordHarvest(a.userId, harvestBody({ farmId: a.farmId, landUnitId: uuidv7() })),
      ).rejects.toThrow(NotFoundError);

      const rows = await elevated.db.select().from(events).where(eq(events.type, 'harvest'));
      expect(rows).toHaveLength(0);
    });
  });

  describe('harvest history report (FR-207)', () => {
    it('lists harvests for the farm, newest first', async () => {
      const a = await tenant('Crop');
      const landUnitId = await block(a);
      await service.recordHarvest(
        a.userId,
        harvestBody({
          farmId: a.farmId,
          landUnitId,
          harvestedOn: '2026-11-01',
          occurredAt: '2026-11-01T06:00:00.000Z',
        }),
      );
      await service.recordHarvest(
        a.userId,
        harvestBody({
          farmId: a.farmId,
          landUnitId,
          harvestedOn: '2026-11-10',
          occurredAt: '2026-11-10T06:00:00.000Z',
        }),
      );

      const report = await service.listHarvestHistory(a.userId, a.farmId, {});

      expect(report.map((r) => r.harvestedOn)).toEqual(['2026-11-10', '2026-11-01']);
    });

    it('narrows to a date range on the harvest day', async () => {
      const a = await tenant('Crop');
      const landUnitId = await block(a);
      await service.recordHarvest(
        a.userId,
        harvestBody({
          farmId: a.farmId,
          landUnitId,
          harvestedOn: '2026-09-01',
          occurredAt: '2026-09-01T06:00:00.000Z',
        }),
      );
      await service.recordHarvest(
        a.userId,
        harvestBody({
          farmId: a.farmId,
          landUnitId,
          harvestedOn: '2026-11-01',
          occurredAt: '2026-11-01T06:00:00.000Z',
        }),
      );

      const report = await service.listHarvestHistory(a.userId, a.farmId, {
        from: '2026-10-15',
        to: '2026-11-15',
      });

      expect(report.map((r) => r.harvestedOn)).toEqual(['2026-11-01']);
    });

    it('never leaks another farm’s harvests', async () => {
      const a = await tenant('Crop');
      const b = await tenant('Other');
      const landUnitId = await block(a);
      await service.recordHarvest(a.userId, harvestBody({ farmId: a.farmId, landUnitId }));

      await expect(service.listHarvestHistory(b.userId, a.farmId, {})).rejects.toThrow(
        NotFoundError,
      );
    });
  });
});
