/**
 * Feed-out capture (FR-153): how much of a tracked feed lot went to a mob or a camp. The ACT is
 * this event; the STOCK CONSEQUENCE is a SEPARATE `inventory_movement` a caller records
 * independently (`recordInventoryMovement`, `../inventory/stock.ts`) — the identical
 * two-independent-commits shape 4e·4 already established for spray/fertiliser, applied here one
 * domain over. Neither invents the other's fact.
 *
 * There is no farmer-typed cost anywhere in this capture. "Cost to enterprise" is a DERIVED read —
 * the linked lot's own weighted-average `received` cost (`estimatedUnitCostCents`, `stock.ts`)
 * times the quantity fed — never a stored figure two devices could disagree about.
 *
 * Pure (.claude/rules/domain.md): no I/O, no clock. The event id (a client UUIDv7) and `occurredAt`
 * are injected. `landUnitId`/`enterpriseId` are ALSO injected rather than resolved here — when a
 * mob is named, its camp and enterprise are looked up from the mob's own row by the caller
 * (`livestock.service.ts`), never trusted from a request; a camp-only feed-out has no mob to
 * derive from, so the caller passes what the farmer picked directly.
 */

import { ValidationError, schemas } from '@werf/core';

/** A feed-out, ready to become an event. "Per camp/group" (FR-153) means at least one of
 *  `landUnitId`/`mobId` is required — refused below, not defaulted away. */
export interface FeedInput {
  /** Client-generated UUIDv7 for the event row (injected — a v7 embeds a clock this package can't read). */
  readonly id: string;
  readonly farmId: string;
  /** When the feed was put out, on the farm (injected). */
  readonly occurredAt: Date;
  readonly landUnitId?: string | null;
  readonly mobId?: string | null;
  readonly enterpriseId?: string | null;
  /** The feed lot this drew from — REQUIRED, unlike a spray's optional reference: "deduct from
   *  feed inventory" is the reason this event type exists (see the module note). */
  readonly inventoryLotId: string;
  /** How much, in the lot's own item's unit. */
  readonly quantity: number;
  readonly notes?: string | null;
  readonly createdBy?: string | null;
}

/**
 * Build a `feed` event from a capture. Refuses a feed-out that names neither a camp nor a mob, or
 * carries a non-positive quantity, before it can enter the append-only log.
 */
export function recordFeedOut(input: FeedInput): schemas.NewEvent {
  const landUnitId = input.landUnitId ?? null;
  const mobId = input.mobId ?? null;
  if (landUnitId === null && mobId === null) {
    throw new ValidationError('Feed must be recorded against a camp or a group');
  }

  const payload = { quantity: input.quantity };
  if (!schemas.feedPayloadSchema.safeParse(payload).success) {
    throw new ValidationError('A feed-out needs a positive quantity');
  }

  return {
    id: input.id,
    farmId: input.farmId,
    type: 'feed',
    occurredAt: input.occurredAt,
    payload,
    enterpriseId: input.enterpriseId ?? null,
    animalId: null,
    mobId,
    landUnitId,
    syncedAt: null,
    employeeId: null,
    batchId: null,
    inventoryLotId: input.inventoryLotId,
    locationGeojson: null,
    notes: input.notes ?? null,
    createdBy: input.createdBy ?? null,
  };
}
