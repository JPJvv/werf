/**
 * Rainfall capture (FR-213): a reading off a rain gauge, recorded as an append-only `rainfall`
 * event.
 *
 * This sits at the root of @werf/domain, not under `livestock/`, because rain is not a livestock
 * fact. Grazing rest and rotation read it, and so does cropping — one capture, read by both
 * enterprises. That is also why it is the documented exception to FR-113 herd scoping: every
 * OTHER event belongs to a herd or an animal, and rain belongs to the FARM. Scoping a rainfall
 * reading to "cattle" would be a lie, and it would hide the reading from the crop side of a mixed
 * farm, which is precisely the filing mistake FR-113 exists to prevent. So `animalId`, `mobId` and
 * `enterpriseId` are all null here, by construction rather than by convention — this input shape
 * has nowhere to put one.
 *
 * Pure (.claude/rules/domain.md): no I/O, no clock. The event id (UUIDv7) and `occurredAt` are
 * injected at the I/O boundary. `occurredAt` is when the rain was measured on the farm — a gauge
 * read on Sunday and captured on Wednesday belongs to Sunday in every report (CLAUDE.md, § 5).
 *
 * Like a weight, a rainfall reading is a pure OBSERVATION: it moves nothing through a state
 * machine, so there is no transition guard and it returns a bare `NewEvent`.
 */

import { schemas, ValidationError } from '@werf/core';

/** A rainfall capture. Farm-scoped; optionally pinned to the land unit the gauge stands in. */
export interface RainfallInput {
  /** Client-generated UUIDv7 for the event row (injected — a v7 embeds a clock this package can't read). */
  readonly id: string;
  readonly farmId: string;
  /** When the gauge was READ on the farm (injected). Not `created_at`, set server-side on write. */
  readonly occurredAt: Date;
  /** Millimetres in the gauge. Zero is a real reading — see the payload schema. */
  readonly mm: number;
  /** Which gauge, on a farm that reads more than one. */
  readonly gauge?: string;
  /** The camp/block the gauge stands in, when the farm records rain per land unit. */
  readonly landUnitId?: string | null;
  readonly notes?: string | null;
  readonly createdBy?: string | null;
}

/**
 * Build a `rainfall` event from a gauge reading. Validates the payload against its per-type schema,
 * so a negative or non-finite millimetre value fails loudly at the domain boundary with a typed
 * error instead of entering the append-only log.
 */
export function recordRainfall(input: RainfallInput): schemas.NewEvent {
  const payload =
    input.gauge === undefined ? { mm: input.mm } : { mm: input.mm, gauge: input.gauge };
  if (!schemas.rainfallPayloadSchema.safeParse(payload).success) {
    throw new ValidationError(
      'A rainfall reading must be a millimetre measurement of zero or more',
    );
  }

  return {
    id: input.id,
    farmId: input.farmId,
    type: 'rainfall',
    occurredAt: input.occurredAt,
    payload,
    // Rain falls on the farm, not on a herd (FR-213, the FR-113 exception documented above).
    enterpriseId: null,
    animalId: null,
    mobId: null,
    syncedAt: null,
    landUnitId: input.landUnitId ?? null,
    employeeId: null,
    batchId: null,
    locationGeojson: null,
    notes: input.notes ?? null,
    createdBy: input.createdBy ?? null,
  };
}
