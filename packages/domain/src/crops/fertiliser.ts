/**
 * Recording a fertiliser application (FR-206), including fertigation, as an append-only
 * `fertiliser` event. Mirrors `planting.ts` exactly, one level over: a fertiliser application is
 * the same "fact about what's on a block" shape as a planting, filed the same way
 * (`FARM_SCOPED_EVENT_TYPES`, @werf/core — see that list's own comment for why `planting` and
 * `fertiliser` share one rule rather than each inventing a filing strategy).
 *
 * No compliance gate applies here, unlike FR-204's spray: FR-206 names no pre-harvest interval or
 * registered product, so this module resolves nothing from a reference table and computes no
 * clear date. `product` is free text the farmer types.
 *
 * Pure (.claude/rules/domain.md): no I/O, no clock. The event id (UUIDv7) and `occurredAt` are
 * injected at the boundary.
 */

import { schemas, ValidationError } from '@werf/core';

/** A rate captured as the farmer states it. Units vary by method (kg/ha broadcast, L/ha
 *  fertigation) for the same reason `PlantingDensity` has no closed unit set. */
export interface FertiliserRate {
  readonly value: number;
  readonly unit: string;
}

/** A fertiliser application, ready to become an event. `landUnitId` is not optional: an
 *  application with no ground under it is not an application — the same posture `planting` takes. */
export interface FertiliserInput {
  /** Client-generated UUIDv7 for the event row (injected — a v7 embeds a clock this package can't read). */
  readonly id: string;
  readonly farmId: string;
  /** The block this was applied to. Required — see the module note. */
  readonly landUnitId: string;
  /** When it was applied (injected). */
  readonly occurredAt: Date;
  readonly product: string;
  readonly method: schemas.FertiliserPayload['method'];
  readonly rate?: FertiliserRate;
  readonly operator?: string;
  /**
   * The stock lot this application drew from (Phase 4e, FR-502) — OPTIONAL, the identical shape
   * `spray.ts`'s field of the same name documents: a farm without inventory tracking on can still
   * fertilise, and the quantity consumed is a separate `inventory_movement` a caller records on its
   * own, never invented here.
   */
  readonly inventoryLotId?: string;
  readonly notes?: string | null;
  readonly createdBy?: string | null;
}

/**
 * Build a `fertiliser` event from a capture. Validates the payload against its per-type schema, so
 * a missing method or a malformed rate fails loudly at the domain boundary with a typed error
 * instead of entering the append-only log.
 */
export function recordFertiliser(input: FertiliserInput): schemas.NewEvent {
  const payload = {
    product: input.product,
    method: input.method,
    ...(input.rate === undefined ? {} : { rate: input.rate }),
    ...(input.operator === undefined ? {} : { operator: input.operator }),
  };
  if (!schemas.fertiliserPayloadSchema.safeParse(payload).success) {
    throw new ValidationError(
      'A fertiliser application needs a product and a method, on a real block',
    );
  }

  return {
    id: input.id,
    farmId: input.farmId,
    type: 'fertiliser',
    occurredAt: input.occurredAt,
    payload,
    // A block is ground, not a herd (FR-113's documented exception — see FARM_SCOPED_EVENT_TYPES).
    enterpriseId: null,
    animalId: null,
    mobId: null,
    syncedAt: null,
    landUnitId: input.landUnitId,
    employeeId: null,
    batchId: null,
    inventoryLotId: input.inventoryLotId ?? null,
    locationGeojson: null,
    notes: input.notes ?? null,
    createdBy: input.createdBy ?? null,
  };
}
