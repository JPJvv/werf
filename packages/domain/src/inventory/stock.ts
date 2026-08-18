/**
 * Inventory stock movement (Phase 4e, FR-501) — the capture that lets a lot's quantity on hand
 * change, and the projection that derives it. The identical shape as `mob-tally.ts`, one domain
 * over: `inventory_lots.quantity_on_hand` is a PROJECTION of the append-only `inventory_movement`
 * log, never a directly-edited column, for the same reason a mob's head count is — two people
 * recording stock use on two phones in a dead zone must COMPOSE, and a stock count is an ABSOLUTE
 * THAT RESETS, never an edited field.
 *
 * ⛔ The one place this deliberately does NOT clone `recordMobTally`: a `consumed` movement that
 * would take the quantity below zero is never refused. A tally refuses an over-large decrease
 * because the count being wrong IS the news for a live animal; a stock figure being wrong is not
 * a reason to block the capture of a real farm event — the spray happened whether or not the shed
 * card was accurate. The movement is recorded, the quantity floors at zero, and the capture
 * reports the shortfall so a caller can prompt a recount instead of losing the record.
 *
 * Pure (.claude/rules/domain.md): no I/O, no clock. The event id (a client UUIDv7) and
 * `occurredAt` are injected, as is `currentQuantity` — the lot's quantity this movement applies
 * to, read from its row by the caller.
 */

import { ValidationError, schemas } from '@werf/core';

/** The result of a movement capture: the event to append, and the quantity it projects to. */
export interface InventoryMovementCapture {
  readonly event: schemas.NewEvent;
  /** The lot's quantity after this movement — what the caller writes to the denormalised row. */
  readonly quantityOnHand: number;
  /** True when a `consumed` movement exceeded the recorded stock. Recorded, never refused — see
   *  the module note. A caller may use this to prompt a recount. */
  readonly shortfall: boolean;
}

export interface InventoryMovementInput {
  /** Client-generated UUIDv7 for the event row (injected — a v7 embeds a clock this package can't read). */
  readonly id: string;
  readonly farmId: string;
  readonly inventoryLotId: string;
  /** When the stock moved on the farm. Not when it was captured. */
  readonly occurredAt: Date;
  readonly reason: schemas.InventoryMovementReason;
  /**
   * How much, as the farmer typed it — always non-negative. "Received 40kg" is `40`, never `-40`;
   * the sign follows from the reason and is applied here, in one place. For `counted` this is how
   * much there IS, and zero is a legitimate answer: an emptied shelf is a real observation.
   */
  readonly quantity: number;
  /** The lot's quantity before this movement, read from its row by the caller. */
  readonly currentQuantity: number;
  /** Integer cents (Money), never a float. What the delivery cost — only `received` carries one. */
  readonly unitCostCents?: number | undefined;
  readonly enterpriseId?: string | null | undefined;
  readonly notes?: string | null | undefined;
  readonly locationGeojson?: string | null | undefined;
  readonly createdBy?: string | null | undefined;
}

// Only two non-`counted` reasons exist (`received`/`consumed`), so the sign follows from
// membership in INCREASES alone — a `DECREASES` set would be exactly its complement, checked twice.
const INCREASES: readonly string[] = schemas.INVENTORY_MOVEMENT_INCREASES;

/**
 * Build the movement event and the quantity it projects to.
 *
 * Throws a typed `ValidationError` for a malformed capture (a negative or non-finite quantity, a
 * zero-change movement, a cost on a non-receipt). It does NOT throw for a `consumed` movement
 * larger than the quantity on file — see the module note.
 */
export function recordInventoryMovement(input: InventoryMovementInput): InventoryMovementCapture {
  if (!Number.isFinite(input.quantity) || input.quantity < 0) {
    throw new ValidationError('A quantity must be a non-negative number');
  }
  if (input.reason !== 'received' && input.unitCostCents !== undefined) {
    throw new ValidationError('Only a receipt carries a cost');
  }

  const payload: Record<string, unknown> = { reason: input.reason };
  let quantityOnHand: number;
  let shortfall = false;

  if (input.reason === 'counted') {
    payload.countedQuantity = input.quantity;
    quantityOnHand = input.quantity;
  } else {
    if (input.quantity === 0) {
      throw new ValidationError(
        'A movement must change the quantity on hand — nothing changed by zero',
      );
    }
    const increases = INCREASES.includes(input.reason);
    const delta = increases ? input.quantity : -input.quantity;
    const raw = input.currentQuantity + delta;
    if (raw < 0) shortfall = true;
    quantityOnHand = Math.max(0, raw);
    payload.delta = delta;
  }

  if (input.unitCostCents !== undefined) payload.unitCostCents = input.unitCostCents;

  if (!schemas.inventoryMovementPayloadSchema.safeParse(payload).success) {
    throw new ValidationError('Invalid inventory movement payload');
  }

  return {
    quantityOnHand,
    shortfall,
    event: {
      id: input.id,
      farmId: input.farmId,
      type: 'inventory_movement',
      occurredAt: input.occurredAt,
      payload,
      // Stock belongs to the shed, not a herd (FR-113's documented farm-scoped exception).
      enterpriseId: input.enterpriseId ?? null,
      syncedAt: null,
      animalId: null,
      mobId: null,
      landUnitId: null,
      employeeId: null,
      batchId: null,
      inventoryLotId: input.inventoryLotId,
      locationGeojson: input.locationGeojson ?? null,
      notes: input.notes ?? null,
      createdBy: input.createdBy ?? null,
    },
  };
}

/** One captured movement, as the projection reads it. */
export interface InventoryMovementRecord {
  /** Present for ORDERING, not identity — see `projectQuantityOnHand`'s own note. */
  readonly id: string;
  readonly inventoryLotId: string;
  /** ISO instant. Sorted as a string, which is correct for ISO-8601 in a fixed zone. */
  readonly occurredAt: string;
  readonly reason: schemas.InventoryMovementReason;
  readonly delta?: number | undefined;
  readonly countedQuantity?: number | undefined;
}

/** Byte order, the same order Postgres gives a timestamptz or a uuid. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Fold a lot's movements onto its quantity on hand (Phase 4e, FR-501).
 *
 * A lot has no baseline to start from — unlike a mob, which is created WITH a head count, a lot
 * is created empty and only ever gains quantity through a `received` movement, so the fold always
 * starts at zero.
 *
 * ⭐ The order is TOTAL — `(occurredAt, id)`, never `occurredAt` alone, for the identical reason
 * `projectHeadCount` sorts this way: a day-grained capture stamps every movement on a day with the
 * same instant, so ties are ordinary, and a fold containing a `counted` reset does not commute.
 * The caller must supply the same total order on both the server and the device, or the two sides
 * can derive different quantities from the same log.
 */
export function projectQuantityOnHand(movements: readonly InventoryMovementRecord[]): number {
  const ordered = [...movements].sort((a, b) => cmp(a.occurredAt, b.occurredAt) || cmp(a.id, b.id));
  let quantity = 0;
  for (const movement of ordered) {
    if (movement.reason === 'counted') {
      if (typeof movement.countedQuantity === 'number') quantity = movement.countedQuantity;
      continue;
    }
    if (typeof movement.delta === 'number') quantity += movement.delta;
  }
  return Math.max(0, quantity);
}
