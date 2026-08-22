/**
 * Inventory capture, Phase 4e's own module (FR-501) — the server end of the offline flush for a
 * farm's own catalogue of stock (chemicals, fertiliser, feed, medicine): the item, its lots, and
 * the movement log that derives each lot's quantity on hand.
 *
 * The write discipline is the shared one (`common/event-capture`): everything runs through
 * `AppDb.asUser`, so RLS — not this file — is the tenancy boundary. Item and lot creation mirror
 * `LivestockService.recordMob`: a plain idempotent insert, no domain function, because neither
 * carries derived state. A movement mirrors `LivestockService.recordMobTally`: idempotency checked
 * BEFORE validation (a movement changes the state its own validation reads), the quantity folded
 * "as at" the event for the SAME reason a back-dated tally is — an offline device syncing late must
 * be judged against the log as it stood on the day, not against today's total — and the lot's
 * denormalised `quantity_on_hand` re-derived from the WHOLE log after every insert, never stepped.
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { events, farmUsers, inventoryItems, inventoryLots, type AppDb } from '@werf/db';
import { NotFoundError, TenancyError, type schemas } from '@werf/core';
import { recordInventoryMovement, projectQuantityOnHand } from '@werf/domain';
import { APP_DB } from '../db/db.module';
import {
  assertCanCapture,
  assertOwnedReferences,
  findEvent,
  insertEvent,
  type CaptureTx,
  type CapturedEvent,
} from '../common/event-capture';

/** numeric(p,s) columns are strings in the driver; the wire contract is a number. */
function numericText(value: number): string {
  return String(value);
}

@Injectable()
export class InventoryService {
  constructor(@Inject(APP_DB) private readonly app: AppDb) {}

  /**
   * Creates an inventory item (FR-501) — the farm's own catalogue entry for a chemical, fertiliser,
   * feed or medicine. Idempotent on the client-generated id, like `recordMob`.
   */
  async recordItem(userId: string, input: schemas.NewInventoryItem) {
    return this.app.asUser(userId, async (tx) => {
      await assertCanCapture(tx, userId, input.farmId);
      await assertOwnedReferences(tx, input.farmId, { enterpriseId: input.enterpriseId });

      const [row] = await tx
        .insert(inventoryItems)
        .values({
          id: input.id,
          farmId: input.farmId,
          enterpriseId: input.enterpriseId,
          category: input.category,
          name: input.name,
          unit: input.unit,
          registrationNumber: input.registrationNumber,
          activeIngredients: input.activeIngredients,
          phiDays: input.phiDays,
          reentryHours: input.reentryHours,
          meatWithdrawalDays: input.meatWithdrawalDays,
          milkWithdrawalHours: input.milkWithdrawalHours,
          createdBy: userId,
        })
        .onConflictDoNothing({ target: inventoryItems.id })
        .returning();

      if (row) return row;

      const [existing] = await tx
        .select()
        .from(inventoryItems)
        .where(and(eq(inventoryItems.id, input.id), eq(inventoryItems.farmId, input.farmId)));
      return existing!;
    });
  }

  /**
   * Sets or clears an item's FR-503 low-stock WARNING threshold (4e·5) — an owner/manager-set
   * preference, so there is no compliance gate on this write, the identical posture
   * `FarmsService.updateRestPeriodDays` (FR-152, 4e·2) takes for a farm-wide agronomic number one
   * level up. Owner OR manager, unlike `updateRestPeriodDays`'s owner-only: this is routine stock
   * management a manager is trusted to run day to day, not a farm-wide policy choice.
   *
   * Reachable for ANY existing item, not only a newly-created one — `newInventoryItemSchema`
   * deliberately carries no `reorderPoint` field, so every item (old or new) gets a threshold
   * through this ONE write path rather than a creation-time field that only new rows could ever
   * reach.
   */
  async updateReorderPoint(
    userId: string,
    itemId: string,
    input: schemas.UpdateInventoryItemReorderPointRequest,
  ) {
    return this.app.asUser(userId, async (tx) => {
      const [membership] = await tx
        .select({ role: farmUsers.role })
        .from(farmUsers)
        .where(
          and(
            eq(farmUsers.farmId, input.farmId),
            eq(farmUsers.userId, userId),
            isNull(farmUsers.deletedAt),
          ),
        );
      if (!membership) throw new NotFoundError('Farm not found');
      if (membership.role !== 'owner' && membership.role !== 'manager') {
        throw new TenancyError(`Role ${membership.role} may not set a reorder point`);
      }

      const [updated] = await tx
        .update(inventoryItems)
        .set({
          reorderPoint: input.reorderPoint === null ? null : numericText(input.reorderPoint),
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(and(eq(inventoryItems.id, itemId), eq(inventoryItems.farmId, input.farmId)))
        .returning();

      if (!updated) throw new NotFoundError('Inventory item not found');
      return updated;
    });
  }

  /**
   * Creates a lot (FR-501) — a physical batch of an item, empty until a `received` movement is
   * recorded against it (see the module note: a lot has no starting-quantity field). Its item must
   * be on this farm.
   */
  async recordLot(userId: string, input: schemas.NewInventoryLot) {
    return this.app.asUser(userId, async (tx) => {
      await assertCanCapture(tx, userId, input.farmId);
      await assertOwnedReferences(tx, input.farmId, { inventoryItemId: input.inventoryItemId });

      const [row] = await tx
        .insert(inventoryLots)
        .values({
          id: input.id,
          farmId: input.farmId,
          inventoryItemId: input.inventoryItemId,
          batch: input.batch,
          expiryDate: input.expiryDate,
          location: input.location,
          createdBy: userId,
        })
        .onConflictDoNothing({ target: inventoryLots.id })
        .returning();

      if (row) return row;

      const [existing] = await tx
        .select()
        .from(inventoryLots)
        .where(and(eq(inventoryLots.id, input.id), eq(inventoryLots.farmId, input.farmId)));
      return existing!;
    });
  }

  /**
   * Records a stock movement (FR-501) — received, consumed, or a physical count. ⛔ Unlike a mob
   * tally, a `consumed` movement larger than the recorded quantity is never refused — see
   * `recordInventoryMovement` (@werf/domain) for why: the spray happened whether or not the shed
   * card was accurate, and refusing here would lose the record of a real farm event over a
   * bookkeeping figure.
   */
  async recordMovement(
    userId: string,
    input: schemas.RecordInventoryMovementRequest,
  ): Promise<CapturedEvent> {
    return this.app.asUser(userId, async (tx) => {
      await assertCanCapture(tx, userId, input.farmId);

      // Idempotent BEFORE validation, mirroring `recordMobTally`'s own `findEvent` guard: a
      // movement changes the state (`quantity_on_hand`) its own validation reads, so a re-flushed
      // retry must not fold the delta a second time.
      const already = await findEvent(tx, input.farmId, input.id);
      if (already) return already;

      const [lot] = await tx
        .select({ id: inventoryLots.id })
        .from(inventoryLots)
        .where(
          and(
            eq(inventoryLots.id, input.inventoryLotId),
            eq(inventoryLots.farmId, input.farmId),
            isNull(inventoryLots.deletedAt),
          ),
        );
      // Another farm's lot is invisible through the RLS-bound connection and reads as "not found".
      if (!lot) throw new NotFoundError('Inventory lot not found');

      // ⭐ Folded "as at" this event, not against today's total — the identical reasoning
      // `deriveHeadCount`'s own `asAt` parameter documents: a back-dated movement from a phone that
      // was out of signal for a week must be judged against the log as it stood that day.
      const quantityAsAt = await deriveQuantityOnHand(tx, input.farmId, input.inventoryLotId, {
        occurredAt: input.occurredAt,
        id: input.id,
      });

      const { event } = recordInventoryMovement({
        id: input.id,
        farmId: input.farmId,
        inventoryLotId: input.inventoryLotId,
        occurredAt: input.occurredAt,
        reason: input.reason,
        quantity: input.quantity,
        currentQuantity: quantityAsAt,
        unitCostCents: input.unitCostCents,
        enterpriseId: input.enterpriseId,
        notes: input.notes,
        createdBy: userId,
      });

      const stored = await insertEvent(tx, event);

      // The AUTHORITATIVE write folds the WHOLE log, not this one delta stepped onto the old value
      // — the identical reasoning `recordMobTally`'s final `deriveHeadCount` call documents: stepping
      // is order-dependent and this product syncs out of order by design.
      const quantityOnHand = await deriveQuantityOnHand(tx, input.farmId, input.inventoryLotId);
      await tx
        .update(inventoryLots)
        .set({ quantityOnHand: numericText(quantityOnHand), updatedBy: userId })
        .where(
          and(eq(inventoryLots.id, input.inventoryLotId), eq(inventoryLots.farmId, input.farmId)),
        );

      return stored;
    });
  }
}

/**
 * A lot's quantity on hand, folded from its `inventory_movement` log (FR-501) — the identical
 * shape `deriveHeadCount` (`livestock.service.ts`) has to the tally log, one domain over. See that
 * function's own `asAt` parameter doc for why the cut is on the WHOLE `(occurredAt, id)` pair.
 */
async function deriveQuantityOnHand(
  tx: CaptureTx,
  farmId: string,
  inventoryLotId: string,
  asAt?: { readonly occurredAt: Date; readonly id: string },
): Promise<number> {
  const rows = await tx
    .select({ id: events.id, occurredAt: events.occurredAt, payload: events.payload })
    .from(events)
    .where(
      and(
        eq(events.farmId, farmId),
        eq(events.inventoryLotId, inventoryLotId),
        eq(events.type, 'inventory_movement'),
        isNull(events.deletedAt),
        ...(asAt === undefined
          ? []
          : [
              or(
                lt(events.occurredAt, asAt.occurredAt),
                and(eq(events.occurredAt, asAt.occurredAt), lt(events.id, asAt.id)),
              )!,
            ]),
      ),
    )
    // A TOTAL order, and load-bearing rather than tidy — see `projectQuantityOnHand`'s own note.
    .orderBy(events.occurredAt, events.id);

  return projectQuantityOnHand(
    rows.map(({ id, occurredAt, payload }) => {
      const p = payload as {
        reason: schemas.InventoryMovementReason;
        delta?: number;
        countedQuantity?: number;
      };
      return {
        id,
        inventoryLotId,
        occurredAt: occurredAt.toISOString(),
        reason: p.reason,
        delta: p.delta,
        countedQuantity: p.countedQuantity,
      };
    }),
  );
}
