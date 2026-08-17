/**
 * Recording a planting (FR-203): what's in the ground, from what seed, sown how thick, and when it
 * is due off — an append-only `planting` event.
 *
 * First module under `crops/` — Phase 4's own domain area, the way `livestock/` and `land/` are
 * theirs. `planting` is filed under `FARM_SCOPED_EVENT_TYPES` (@werf/core), not a herd: a block
 * carries maize this season and lucerne the next, and a mixed farm that hid a planting from the
 * livestock side because it was "under a herd" would be the exact FR-113 filing mistake that list
 * exists to prevent for `boundary_walk` and `rainfall`. The reasoning is identical to both; ground
 * is not a herd.
 *
 * Pure (.claude/rules/domain.md): no I/O, no clock. The event id (UUIDv7) and `occurredAt` are
 * injected at the boundary. `occurredAt` IS the planted date — there is no separate field for it,
 * the same way a boundary walk has no separate "walked on" field beyond its own `occurredAt`.
 *
 * ⭐ THERE IS NO STATUS MACHINE AND NO CLOSING EVENT. "What's currently planted in block B12" is a
 * PROJECTION over this log: the latest `planting` event per `land_unit_id`, ordered `(occurredAt,
 * id)` — the same total order `mob-tally.ts` folds by and `LocalLand.tsx`'s `latestWalkFor` re-
 * derives for a boundary, for the same reason (two devices recording a planting in a dead zone must
 * not disagree about which one is current depending on arrival order). The fold itself lives beside
 * the store that reads it (`apps/web/src/crops/LocalPlantings.tsx`), not here — this module is pure
 * event construction, and `latestWalkFor` is the precedent for keeping the projection there rather
 * than in `@werf/domain`. An annual crop gets a fresh event every season; a vineyard gets one that
 * persists for years while harvests file against the block underneath it. This is a UX/reporting
 * decision — what a screen shows as "currently planted" — and deliberately NOT a safety dependency:
 * the PHI guard (4d) reads a block's SPRAY history directly and never asks what is currently
 * planted, so getting this projection wrong is a wrong label on a screen, not a compliance defect.
 *
 * ⛔ NOT ADDRESSED HERE, named rather than silently missed: whether a SPLIT block (4a·2, `parent_id`)
 * inherits its parent's most recent planting. Left unanswered, a farmer splitting a planted block
 * mid-season sees every child read "never planted" the moment 4a·2 ships, which is a real regression
 * this module cannot see coming because it does not know about splitting yet. Whoever builds the
 * "current planting" read (client projection or a future report) must decide this, the same way
 * 4d·4 had to decide it for spray/PHI.
 */

import { schemas, ValidationError } from '@werf/core';

/** A quantity captured as the farmer states it. Units vary too widely across crops — plants/ha for
 *  an orchard or vineyard row, kg/ha for a broadcast seed rate — for a closed unit set, the same
 *  reasoning FR-201 applied to `soilType`. Mirrors the generic `quantity`/`unit` shape already
 *  sketched for `harvest` (database-schema.md), so the two do not each invent their own. */
export interface PlantingDensity {
  readonly value: number;
  readonly unit: string;
}

/** A planting, ready to become an event. `landUnitId` is not optional: a planting with no ground
 *  under it is not a planting — the same posture `boundary_walk` takes on the shape it is of. */
export interface PlantingInput {
  /** Client-generated UUIDv7 for the event row (injected — a v7 embeds a clock this package can't read). */
  readonly id: string;
  readonly farmId: string;
  /** The block this was planted in. Required — see the module note. */
  readonly landUnitId: string;
  /** When it went in the ground (injected). This IS the planted date; there is no second field. */
  readonly occurredAt: Date;
  readonly crop: string;
  readonly cultivar?: string;
  readonly density?: PlantingDensity;
  readonly seedSource?: string;
  /** YYYY-MM-DD. A farming estimate, not a computed guarantee — nothing here resolves it from a
   *  reference table the way `phiDays`/`earliestHarvestDate` do for a spray (ADR-0005 does not
   *  apply: there is no regulated figure behind an expected harvest date). */
  readonly expectedHarvestDate?: string;
  readonly notes?: string | null;
  readonly createdBy?: string | null;
}

/**
 * Build a `planting` event from a capture. Validates the payload against its per-type schema, so a
 * blank crop or a malformed density fails loudly at the domain boundary with a typed error instead
 * of entering the append-only log.
 */
export function recordPlanting(input: PlantingInput): schemas.NewEvent {
  const payload = {
    crop: input.crop,
    ...(input.cultivar === undefined ? {} : { cultivar: input.cultivar }),
    ...(input.density === undefined ? {} : { density: input.density }),
    ...(input.seedSource === undefined ? {} : { seedSource: input.seedSource }),
    ...(input.expectedHarvestDate === undefined
      ? {}
      : { expectedHarvestDate: input.expectedHarvestDate }),
  };
  if (!schemas.plantingPayloadSchema.safeParse(payload).success) {
    throw new ValidationError('A planting needs at least a crop, sown in a real block');
  }

  return {
    id: input.id,
    farmId: input.farmId,
    type: 'planting',
    occurredAt: input.occurredAt,
    payload,
    // A block is ground, not a herd (FR-113's documented exception — see the module note).
    enterpriseId: null,
    animalId: null,
    mobId: null,
    syncedAt: null,
    landUnitId: input.landUnitId,
    employeeId: null,
    batchId: null,
    locationGeojson: null,
    notes: input.notes ?? null,
    createdBy: input.createdBy ?? null,
  };
}
