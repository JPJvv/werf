/**
 * Inventory capture against a real Postgres (Phase 4e, FR-501). The cases a mock cannot see: the
 * migration really did add 'inventory_movement' to the partitioned `events` type and an
 * `inventory_lot_id` column to it, a movement lands under the farm's RLS boundary scoped to the
 * LOT rather than a herd (`insertEvent` refuses anything naming neither), the lot/item references
 * are genuinely checked (a movement against another farm's lot, or a lot naming another farm's
 * item, is refused), a `consumed` movement larger than the recorded quantity is RECORDED rather
 * than refused, and a re-flush does not double-apply a delta. We never mock the DB (CLAUDE.md).
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
  enterprises,
  events,
  farmUsers,
  inventoryItems,
  inventoryLots,
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
import { InventoryService } from './inventory.service';

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

const itemBody = (
  over: Partial<ZodInput<typeof schemas.newInventoryItemSchema>> & { farmId: string },
): schemas.NewInventoryItem =>
  schemas.newInventoryItemSchema.parse({
    id: uuidv7(),
    category: 'fertiliser',
    name: 'Urea 46%',
    unit: 'kg',
    ...over,
  });

const lotBody = (
  over: Partial<ZodInput<typeof schemas.newInventoryLotSchema>> & {
    farmId: string;
    inventoryItemId: string;
  },
): schemas.NewInventoryLot =>
  schemas.newInventoryLotSchema.parse({
    id: uuidv7(),
    batch: 'B-2026-01',
    location: 'Main store',
    ...over,
  });

const movementBody = (
  over: Partial<ZodInput<typeof schemas.recordInventoryMovementRequestSchema>> & {
    farmId: string;
    inventoryLotId: string;
  },
): schemas.RecordInventoryMovementRequest =>
  schemas.recordInventoryMovementRequestSchema.parse({
    id: uuidv7(),
    occurredAt: '2026-09-14T04:30:00.000Z',
    reason: 'received',
    quantity: 40,
    ...over,
  });

describe('inventory capture (Phase 4e, FR-501)', () => {
  let pg: WerfTestDatabase;
  let app: AppDb;
  let elevated: ElevatedDb;
  let auth: AuthService;
  let service: InventoryService;

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
        InventoryService,
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
    service = moduleRef.get(InventoryService);
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

  /** A real item this tenant's owner has already created. */
  async function item(a: { userId: string; farmId: string }) {
    const created = await service.recordItem(a.userId, itemBody({ farmId: a.farmId }));
    return created.id;
  }

  /** A real, empty lot of that item. */
  async function lot(a: { userId: string; farmId: string }, inventoryItemId: string) {
    const created = await service.recordLot(
      a.userId,
      lotBody({ farmId: a.farmId, inventoryItemId }),
    );
    return created.id;
  }

  describe('items', () => {
    it('creates an item, farm-scoped', async () => {
      const a = await tenant('Store');

      const created = await service.recordItem(a.userId, itemBody({ farmId: a.farmId }));

      expect(created.category).toBe('fertiliser');
      expect(created.name).toBe('Urea 46%');
      expect(created.farmId).toBe(a.farmId);
    });

    it('is idempotent on the client id, so a re-flush does not create a second item', async () => {
      const a = await tenant('Store');
      const body = itemBody({ farmId: a.farmId });

      const first = await service.recordItem(a.userId, body);
      const again = await service.recordItem(a.userId, body);

      expect(again.id).toBe(first.id);
    });

    it('refuses an item naming an enterprise on another farm', async () => {
      const a = await tenant('Store');
      const b = await tenant('Neighbour');
      // A real enterprise exists on b's farm from registration; a's device cannot see it.
      const [neighbourEnterprise] = await elevated.db
        .select({ id: enterprises.id })
        .from(enterprises)
        .where(eq(enterprises.farmId, b.farmId))
        .limit(1);

      await expect(
        service.recordItem(
          a.userId,
          itemBody({ farmId: a.farmId, enterpriseId: neighbourEnterprise!.id }),
        ),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('low-stock reorder point (FR-503, 4e·5)', () => {
    it('sets the threshold', async () => {
      const a = await tenant('Store');
      const inventoryItemId = await item(a);

      const updated = await service.updateReorderPoint(a.userId, inventoryItemId, {
        farmId: a.farmId,
        reorderPoint: 20,
      });

      expect(Number(updated.reorderPoint)).toBe(20);
      const [row] = await elevated.db
        .select()
        .from(inventoryItems)
        .where(eq(inventoryItems.id, inventoryItemId));
      expect(Number(row!.reorderPoint)).toBe(20);
    });

    it('clears the threshold back to null — a real choice, not a value the schema forbids', async () => {
      const a = await tenant('Store');
      const inventoryItemId = await item(a);
      await service.updateReorderPoint(a.userId, inventoryItemId, {
        farmId: a.farmId,
        reorderPoint: 20,
      });

      const cleared = await service.updateReorderPoint(a.userId, inventoryItemId, {
        farmId: a.farmId,
        reorderPoint: null,
      });

      expect(cleared.reorderPoint).toBeNull();
    });

    it('reaches an item created before this session as easily as a brand new one', async () => {
      // No creation-time field for this exists on purpose — every item, old or new, goes through
      // this one write path (`inventory.service.ts`'s own module note).
      const a = await tenant('Store');
      const inventoryItemId = await item(a);

      const updated = await service.updateReorderPoint(a.userId, inventoryItemId, {
        farmId: a.farmId,
        reorderPoint: 5,
      });

      expect(Number(updated.reorderPoint)).toBe(5);
    });

    it('refuses a stranger, exactly as if the farm did not exist', async () => {
      const a = await tenant('Store');
      const b = await tenant('Neighbour');
      const inventoryItemId = await item(a);

      await expect(
        service.updateReorderPoint(b.userId, inventoryItemId, {
          farmId: a.farmId,
          reorderPoint: 20,
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it('allows a manager, unlike the owner-only rest-period-days precedent', async () => {
      const a = await tenant('Store');
      const inventoryItemId = await item(a);
      const b = await tenant('Manager');
      await elevated.db.insert(farmUsers).values({
        farmId: a.farmId,
        userId: b.userId,
        role: 'manager',
        invitedAt: new Date(),
        acceptedAt: new Date(),
      });

      const updated = await service.updateReorderPoint(b.userId, inventoryItemId, {
        farmId: a.farmId,
        reorderPoint: 15,
      });

      expect(Number(updated.reorderPoint)).toBe(15);
    });

    it('refuses a worker — routine stock management, but not this owner/manager preference', async () => {
      const a = await tenant('Store');
      const inventoryItemId = await item(a);
      const b = await tenant('Worker');
      await elevated.db.insert(farmUsers).values({
        farmId: a.farmId,
        userId: b.userId,
        role: 'worker',
        invitedAt: new Date(),
        acceptedAt: new Date(),
      });

      await expect(
        service.updateReorderPoint(b.userId, inventoryItemId, {
          farmId: a.farmId,
          reorderPoint: 15,
        }),
      ).rejects.toThrow(TenancyError);
    });

    it('refuses an item on another farm, as a not-found rather than leaking its existence', async () => {
      const a = await tenant('Store');
      const b = await tenant('Neighbour');
      const neighbourItemId = await item(b);

      await expect(
        service.updateReorderPoint(a.userId, neighbourItemId, {
          farmId: a.farmId,
          reorderPoint: 20,
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('lots', () => {
    it('creates a lot at zero — a lot starts empty and is received into', async () => {
      const a = await tenant('Store');
      const inventoryItemId = await item(a);

      const created = await service.recordLot(
        a.userId,
        lotBody({ farmId: a.farmId, inventoryItemId }),
      );

      expect(Number(created.quantityOnHand)).toBe(0);
      expect(created.batch).toBe('B-2026-01');
    });

    it("refuses a lot naming another farm's item", async () => {
      const a = await tenant('Store');
      const b = await tenant('Neighbour');
      const neighbourItemId = await item(b);

      await expect(
        service.recordLot(
          a.userId,
          lotBody({ farmId: a.farmId, inventoryItemId: neighbourItemId }),
        ),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('movements', () => {
    it('receives stock into an empty lot and updates quantity_on_hand', async () => {
      const a = await tenant('Store');
      const inventoryItemId = await item(a);
      const inventoryLotId = await lot(a, inventoryItemId);

      const captured = await service.recordMovement(
        a.userId,
        movementBody({ farmId: a.farmId, inventoryLotId, reason: 'received', quantity: 40 }),
      );

      expect(captured.type).toBe('inventory_movement');
      expect(captured.payload).toEqual({ reason: 'received', delta: 40 });
      expect(captured.inventoryLotId).toBe(inventoryLotId);
      // Herd-exempt (FR-113): a stock movement is filed under the lot, never a herd.
      expect(captured.enterpriseId).toBeNull();
      expect(captured.mobId).toBeNull();
      expect(captured.animalId).toBeNull();

      const [row] = await app.asUser(a.userId, (tx) =>
        tx.select().from(inventoryLots).where(eq(inventoryLots.id, inventoryLotId)),
      );
      expect(Number(row!.quantityOnHand)).toBe(40);
    });

    it('takes consumed stock off the quantity on hand', async () => {
      const a = await tenant('Store');
      const inventoryItemId = await item(a);
      const inventoryLotId = await lot(a, inventoryItemId);
      await service.recordMovement(
        a.userId,
        movementBody({ farmId: a.farmId, inventoryLotId, reason: 'received', quantity: 40 }),
      );

      await service.recordMovement(
        a.userId,
        movementBody({ farmId: a.farmId, inventoryLotId, reason: 'consumed', quantity: 12 }),
      );

      const [row] = await app.asUser(a.userId, (tx) =>
        tx.select().from(inventoryLots).where(eq(inventoryLots.id, inventoryLotId)),
      );
      expect(Number(row!.quantityOnHand)).toBe(28);
    });

    it('⛔ RECORDS a consume larger than the recorded quantity — never refuses it', async () => {
      // The spray happened whether or not the shed card was accurate. Refusing here would lose the
      // record of a real farm event over a bookkeeping figure — the inverse of offline-first.
      const a = await tenant('Store');
      const inventoryItemId = await item(a);
      const inventoryLotId = await lot(a, inventoryItemId);
      await service.recordMovement(
        a.userId,
        movementBody({ farmId: a.farmId, inventoryLotId, reason: 'received', quantity: 10 }),
      );

      const captured = await service.recordMovement(
        a.userId,
        movementBody({ farmId: a.farmId, inventoryLotId, reason: 'consumed', quantity: 15 }),
      );

      expect(captured.payload).toEqual({ reason: 'consumed', delta: -15 });
      const [row] = await app.asUser(a.userId, (tx) =>
        tx.select().from(inventoryLots).where(eq(inventoryLots.id, inventoryLotId)),
      );
      expect(Number(row!.quantityOnHand)).toBe(0);
    });

    it('a physical count resets the quantity, ignoring what was on file', async () => {
      const a = await tenant('Store');
      const inventoryItemId = await item(a);
      const inventoryLotId = await lot(a, inventoryItemId);
      await service.recordMovement(
        a.userId,
        movementBody({ farmId: a.farmId, inventoryLotId, reason: 'received', quantity: 40 }),
      );

      await service.recordMovement(
        a.userId,
        movementBody({ farmId: a.farmId, inventoryLotId, reason: 'counted', quantity: 31 }),
      );

      const [row] = await app.asUser(a.userId, (tx) =>
        tx.select().from(inventoryLots).where(eq(inventoryLots.id, inventoryLotId)),
      );
      expect(Number(row!.quantityOnHand)).toBe(31);
    });

    it('is idempotent on the client id, so a re-flush does not double-apply the delta', async () => {
      const a = await tenant('Store');
      const inventoryItemId = await item(a);
      const inventoryLotId = await lot(a, inventoryItemId);
      const body = movementBody({
        farmId: a.farmId,
        inventoryLotId,
        reason: 'received',
        quantity: 40,
      });

      const first = await service.recordMovement(a.userId, body);
      const again = await service.recordMovement(a.userId, body);

      expect(again.id).toBe(first.id);
      const [row] = await app.asUser(a.userId, (tx) =>
        tx.select().from(inventoryLots).where(eq(inventoryLots.id, inventoryLotId)),
      );
      expect(Number(row!.quantityOnHand)).toBe(40);
      const rows = await app.asUser(a.userId, (tx) =>
        tx.select().from(events).where(eq(events.inventoryLotId, inventoryLotId)),
      );
      expect(rows).toHaveLength(1);
    });

    it("refuses a movement against another farm's lot", async () => {
      const a = await tenant('Store');
      const b = await tenant('Neighbour');
      const neighbourItemId = await item(b);
      const neighbourLotId = await lot(b, neighbourItemId);

      await expect(
        service.recordMovement(
          a.userId,
          movementBody({ farmId: a.farmId, inventoryLotId: neighbourLotId }),
        ),
      ).rejects.toThrow(NotFoundError);
    });

    it('keeps occurred_at (when the stock moved) distinct from created_at (row written)', async () => {
      const a = await tenant('Store');
      const inventoryItemId = await item(a);
      const inventoryLotId = await lot(a, inventoryItemId);

      const captured = await service.recordMovement(
        a.userId,
        movementBody({
          farmId: a.farmId,
          inventoryLotId,
          occurredAt: '2026-08-01T04:00:00.000Z',
        }),
      );

      expect(captured.occurredAt.toISOString()).toBe('2026-08-01T04:00:00.000Z');
      expect(captured.occurredAt.getTime()).toBeLessThan(captured.createdAt.getTime());
    });

    it("a worker on another farm cannot see this farm's lots (RLS)", async () => {
      const a = await tenant('Store');
      const b = await tenant('Neighbour');
      const inventoryItemId = await item(a);
      const inventoryLotId = await lot(a, inventoryItemId);

      const seenByB = await app.asUser(b.userId, (tx) =>
        tx.select().from(inventoryLots).where(eq(inventoryLots.id, inventoryLotId)),
      );
      expect(seenByB).toHaveLength(0);
    });
  });
});
