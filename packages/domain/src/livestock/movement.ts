/**
 * Movement capture (FR-103): move an animal between camps (land_units) and/or mobs. The movement
 * is kept as an append-only `move` event — the before AND after of both dimensions — and the
 * animal's DENORMALISED current location (`land_unit_id`, `mob_id`) is updated to match. The event
 * is the history; the animal row is only ever the latest position (database-schema.md § 4).
 *
 * Pure (.claude/rules/domain.md): no I/O, no clock. The event id (a client UUIDv7) and `occurredAt`
 * are injected. A move never changes the animal's STATUS, so it returns the location change to apply
 * rather than a status change — but it still refuses to move an animal that is not in the herd.
 */

import { type AnimalStatus, ValidationError, schemas } from '@werf/core';

/** The denormalised location change to apply to the `animals` row after a move. */
export interface AnimalLocationChange {
  readonly animalId: string;
  readonly landUnitId: string | null;
  readonly mobId: string | null;
}

/** The result of a move: the event to append, and the location change to write to the animal. */
export interface MoveCapture {
  readonly event: schemas.NewEvent;
  readonly animalChange: AnimalLocationChange;
}

/**
 * A move capture. The FROM side is the animal's current denormalised location; the TO side is
 * where it is going. A dimension is left UNCHANGED by OMITTING its `to*` field — distinct from
 * passing `null`, which is a real target (unassigned from a mob, taken off a mapped camp).
 */
export interface MoveInput {
  /** Client-generated UUIDv7 for the event row (injected — a v7 embeds a clock this package can't read). */
  readonly id: string;
  readonly farmId: string;
  readonly animalId: string;
  /** When the animal was moved on the farm (injected). Not `created_at`, set server-side on write. */
  readonly occurredAt: Date;
  /** The animal's status right now — a move is refused unless it is alive (still in the herd). */
  readonly currentStatus: AnimalStatus;
  /** The camp the animal is currently in (its denormalised `land_unit_id`). */
  readonly fromLandUnitId?: string | null;
  /** The mob the animal is currently in (its denormalised `mob_id`). */
  readonly fromMobId?: string | null;
  /** Destination camp. Omit to leave the camp unchanged; `null` to take it off a mapped camp. */
  readonly toLandUnitId?: string | null;
  /** Destination mob. Omit to leave the mob unchanged; `null` to unassign it from its mob. */
  readonly toMobId?: string | null;
  readonly enterpriseId?: string | null;
  /** Set when this move is one of a group walked in one action (FR-112). */
  readonly batchId?: string | null;
  readonly locationGeojson?: string | null;
  readonly notes?: string | null;
  readonly createdBy?: string | null;
}

export function recordMove(input: MoveInput): MoveCapture {
  // A move is not a status transition, but an animal that has left the herd cannot be moved.
  if (input.currentStatus !== 'alive') {
    throw new ValidationError(
      `Cannot move a '${input.currentStatus}' animal — it is no longer in the herd`,
    );
  }

  const fromLandUnitId = input.fromLandUnitId ?? null;
  const fromMobId = input.fromMobId ?? null;
  // Omitting a `to*` field leaves that dimension where it was; passing `null` clears it.
  const toLandUnitId = input.toLandUnitId === undefined ? fromLandUnitId : input.toLandUnitId;
  const toMobId = input.toMobId === undefined ? fromMobId : input.toMobId;

  if (toLandUnitId === fromLandUnitId && toMobId === fromMobId) {
    throw new ValidationError('A move must change the camp or the mob');
  }

  const payload = { fromLandUnitId, toLandUnitId, fromMobId, toMobId };
  if (!schemas.movePayloadSchema.safeParse(payload).success) {
    throw new ValidationError('Invalid move payload');
  }

  const event: schemas.NewEvent = {
    id: input.id,
    farmId: input.farmId,
    type: 'move',
    occurredAt: input.occurredAt,
    payload,
    enterpriseId: input.enterpriseId ?? null,
    syncedAt: null,
    animalId: input.animalId,
    // The event's own scope columns point at the DESTINATION, so a per-camp / per-mob feed shows
    // the arrival. The full before/after lives in the payload.
    mobId: toMobId,
    landUnitId: toLandUnitId,
    employeeId: null,
    batchId: input.batchId ?? null,
    inventoryLotId: null,
    locationGeojson: input.locationGeojson ?? null,
    notes: input.notes ?? null,
    createdBy: input.createdBy ?? null,
  };

  return {
    event,
    animalChange: { animalId: input.animalId, landUnitId: toLandUnitId, mobId: toMobId },
  };
}
