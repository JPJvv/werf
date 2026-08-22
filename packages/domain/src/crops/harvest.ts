/**
 * Recording a harvest (FR-207) as an append-only `harvest` event. Mirrors `planting.ts`/
 * `fertiliser.ts` exactly for the shape of the event itself. This module builds the event; it does
 * NOT run the PHI guard — that is `phi-guard.ts`, one file over, deliberately separate because a
 * guard is a READ over spray history and this is a WRITE of a new fact, and the caller (API
 * service, or the client capture screen) is the one place both need to be composed.
 *
 * `phiOverride.by` is OPTIONAL here, and that is not a gap: it is the acting user id, and this
 * layer never accepts client input for it (`harvestPayloadSchema`'s own module note, `@werf/core`)
 * — the SAME reasoning `createdBy`, two fields down, is never client-supplied anywhere in this
 * codebase. The API service always fills it in from the session before the AUTHORITATIVE event is
 * built; a client's own LOCAL, not-yet-sent capture has a reason (the farmer just typed it) but
 * genuinely no server-trusted answer to give for who, so it is built with `phiOverride: { reason }`
 * alone rather than inventing one.
 *
 * Filed under `FARM_SCOPED_EVENT_TYPES` (@werf/core) — a block is ground, not a herd, the same
 * filing `planting`/`fertiliser`/`spray` already use and for the identical reason.
 *
 * Pure (.claude/rules/domain.md): no I/O, no clock. The event id and `occurredAt` are injected.
 */

import { schemas, ValidationError } from '@werf/core';

/** A harvest, ready to become an event. `landUnitId` is not optional: a harvest with no ground
 *  under it is not a harvest — the same posture `planting`/`fertiliser`/`spray` take. */
export interface HarvestInput {
  /** Client-generated UUIDv7 for the event row (injected — a v7 embeds a clock this package can't read). */
  readonly id: string;
  readonly farmId: string;
  /** The block this was harvested. Required — see the module note. */
  readonly landUnitId: string;
  /** When the capture was made (injected). */
  readonly occurredAt: Date;
  /** The farm-local harvest DAY (YYYY-MM-DD) — the day the PHI guard judges (injected). */
  readonly harvestedOn: string;
  readonly quantity: number;
  readonly unit: string;
  readonly grade?: string;
  readonly destination?: string;
  readonly notes?: string | null;
  readonly createdBy?: string | null;
}

/**
 * Build a `harvest` event from a capture. Validates the payload against its per-type schema, so a
 * missing quantity/unit or a malformed override fails loudly at the domain boundary with a typed
 * error instead of entering the append-only log.
 */
export function recordHarvest(input: HarvestInput): schemas.NewEvent {
  const payload: Record<string, unknown> = {
    harvestedOn: input.harvestedOn,
    quantity: input.quantity,
    unit: input.unit,
  };
  if (input.grade !== undefined) payload.grade = input.grade;
  if (input.destination !== undefined) payload.destination = input.destination;
  if (!schemas.harvestPayloadSchema.safeParse(payload).success) {
    throw new ValidationError('A harvest needs a day, a quantity and a unit, on a real block');
  }

  return {
    id: input.id,
    farmId: input.farmId,
    type: 'harvest',
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
    inventoryLotId: null,
    locationGeojson: null,
    notes: input.notes ?? null,
    createdBy: input.createdBy ?? null,
  };
}
