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
 * not disagree about which one is current depending on arrival order). An annual crop gets a fresh
 * event every season; a vineyard gets one that persists for years while harvests file against the
 * block underneath it.
 *
 * `currentPlantingFor` below is that fold — ONE shared implementation, called identically by the
 * client (`apps/web/src/crops/LocalPlantings.tsx`'s `useCurrentPlanting`, its original home) and now
 * the API service (`crops.service.ts`'s `evaluateSprayPhiGuard`), the same posture `phi-guard.ts`
 * takes for its own guard. This is no longer purely a UX/reporting decision: the spray-capture PHI
 * guard (legal-compliance.md § 4.3, "spraying a block within the PHI of its planned harvest date
 * must be blocked at capture") reads THIS projection's `expectedHarvestDate` as its planned-harvest
 * input, so getting the fold wrong is now a wrong compliance decision, not only a wrong screen label.
 * The PHI guard proper (`phi-guard.ts`'s `phiGuardFor`/`sprayPhiGuardFor`) still reads spray history
 * directly for the actual block/clear decision — this projection only supplies the ONE date those
 * guards compare against.
 *
 * Split-block inheritance (4a·2, `parent_id`) is answered BY REUSING `land/ancestry.ts`'s
 * `ancestorChainOf`, UNBOUNDED — a split never closes the parent, so a child's ground carries
 * whatever was last planted on the ground it came from, until a fresher planting on the child itself
 * supersedes it by the total order. `ancestry.ts`'s own header names this the correct bound for the
 * planting projection specifically (as opposed to the PHI guard's own per-hop spray bound, a
 * different question with a different answer).
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
    inventoryLotId: null,
    locationGeojson: null,
    notes: input.notes ?? null,
    createdBy: input.createdBy ?? null,
  };
}

/** A planting, as either caller can supply it — enough to fold "what's currently in the ground"
 *  over a block and its ancestors. A DB row and a local/hydrated capture both structurally satisfy
 *  this (extra fields ignored), the same posture `PhiSprayFact` takes for a spray. */
export interface PlantingFact {
  readonly id: string;
  readonly landUnitId: string;
  /** ISO instant. Sorted as a string alongside `id` for the total order — see the module note. */
  readonly occurredAt: string;
  readonly expectedHarvestDate?: string;
}

/**
 * The planting a block currently reads as "in the ground" — the latest across `landUnitIds` (a
 * block and, per FR-202, its ancestors — pass `ancestorChainOf(landUnitId, units)`, UNBOUNDED) by
 * the total order `(occurredAt, id)`. `undefined` when none of them has ever been planted.
 *
 * Generic over `T extends PlantingFact` so the CALLER's richer shape survives the round trip:
 * `LocalPlantings.tsx`'s `useCurrentPlanting` passes `StoredPlanting[]` and gets a `StoredPlanting`
 * back (crop, cultivar, density intact), not the narrowed `PlantingFact` this function itself only
 * needs to read. Without the generic, the ONE shared implementation this file's own note above
 * insists on would be shared in name only — the client would have to re-narrow or re-widen the
 * result, exactly the kind of friction that makes a "shared" function quietly grow a second, real
 * implementation next to it.
 */
export function currentPlantingFor<T extends PlantingFact>(
  plantings: readonly T[],
  landUnitIds: readonly string[],
): T | undefined {
  const ids = new Set(landUnitIds);
  let latest: T | undefined;
  for (const planting of plantings) {
    if (!ids.has(planting.landUnitId)) continue;
    if (latest === undefined || isLaterPlanting(planting, latest)) latest = planting;
  }
  return latest;
}

function isLaterPlanting(candidate: PlantingFact, incumbent: PlantingFact): boolean {
  if (candidate.occurredAt !== incumbent.occurredAt) {
    return candidate.occurredAt > incumbent.occurredAt;
  }
  return candidate.id > incumbent.id;
}
