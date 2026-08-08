/**
 * Weight capture and performance (FR-140/141): record a weight reading as an append-only `events`
 * row, and compute average daily gain between any two readings.
 *
 * Pure (.claude/rules/domain.md): no I/O, no database, and NO CLOCK. The event id is a
 * client-generated UUIDv7 and `occurredAt` is the farm-local instant the animal stepped on the
 * scale; both are injected by the caller at the I/O boundary. `occurredAt` is what a growth report
 * reads — a weight taken in a crush with no signal syncs days later, and the ADG must still be
 * computed from when the animal was weighed, not when the row reached the server (CLAUDE.md, § 5).
 *
 * A weight is a pure OBSERVATION: unlike the lifecycle captures it never moves the animal through
 * the status state machine, so there is no transition guard here and it returns a bare `NewEvent`.
 */

import { schemas, ValidationError } from '@werf/core';

/** How the reading was taken. Mirrors the `weight` payload's `method` (a tape/visual estimate is
 *  not a scale reading, and ADG built on estimates should be read knowing that). */
export type WeightMethod = schemas.WeightPayload['method'];

/**
 * A weight capture. The subject is EXACTLY ONE of an animal or a mob (FR-140): an individual
 * animal's weight, or a mob/flock weight taken across a group without individual rows. Passing
 * neither, or both, is a capture bug and throws.
 */
export interface WeightInput {
  /** Client-generated UUIDv7 for the event row (injected — a v7 embeds a clock this package can't read). */
  readonly id: string;
  readonly farmId: string;
  /** The individual animal weighed, if this is an animal weight. Mutually exclusive with `mobId`. */
  readonly animalId?: string | null;
  /** The mob/flock weighed, if this is a mob weight. Mutually exclusive with `animalId`. */
  readonly mobId?: string | null;
  /** When the animal was weighed on the farm (injected). Not `created_at`, set server-side on write. */
  readonly occurredAt: Date;
  /** The reading in kilograms. Positive — a zero or negative weight is a capture error. */
  readonly kg: number;
  readonly method: WeightMethod;
  /** Financial attribution — the enterprise this reading belongs to (FR-113 herd scoping). */
  readonly enterpriseId?: string | null;
  /** Groups one weigh session across many animals in one action (FR-112/142). */
  readonly batchId?: string | null;
  readonly locationGeojson?: string | null;
  readonly notes?: string | null;
  readonly createdBy?: string | null;
}

/**
 * Build a `weight` event from a capture. Validates the payload against its per-type schema so a
 * bad reading (a zero or negative kg, an unknown method) fails loudly at the domain boundary with a
 * typed error rather than silently entering the append-only log.
 */
export function recordWeight(input: WeightInput): schemas.NewEvent {
  const animalId = input.animalId ?? null;
  const mobId = input.mobId ?? null;
  if ((animalId === null) === (mobId === null)) {
    throw new ValidationError(
      'A weight must be recorded against exactly one of an animal or a mob',
    );
  }

  const payload = { kg: input.kg, method: input.method };
  if (!schemas.weightPayloadSchema.safeParse(payload).success) {
    throw new ValidationError('Invalid weight payload');
  }

  return {
    id: input.id,
    farmId: input.farmId,
    type: 'weight',
    occurredAt: input.occurredAt,
    payload,
    enterpriseId: input.enterpriseId ?? null,
    syncedAt: null,
    animalId,
    mobId,
    landUnitId: null,
    employeeId: null,
    batchId: input.batchId ?? null,
    locationGeojson: input.locationGeojson ?? null,
    notes: input.notes ?? null,
    createdBy: input.createdBy ?? null,
  };
}

// ── Performance (FR-141) ─────────────────────────────────────────────────────────

/** A weight reading reduced to what a gain calculation needs: the mass and when it was taken. */
export interface WeightReading {
  readonly kg: number;
  /** When the reading was taken on the farm — ADG is measured against occurred_at, never sync time. */
  readonly occurredAt: Date;
}

const MS_PER_DAY = 86_400_000;

/**
 * Average daily gain in kg/day between two readings (FR-141). Order-independent — the earlier of
 * the two is the baseline regardless of the argument order — so a NEGATIVE result is a real,
 * meaningful signal (weight loss over a drought), not an error to reject.
 *
 * Two readings taken at the same instant throw: there is no elapsed time to divide by, so no rate
 * exists. The result is kg/day as a real number; rounding for display is the caller's job.
 */
export function averageDailyGain(a: WeightReading, b: WeightReading): number {
  const [earlier, later] = a.occurredAt.getTime() <= b.occurredAt.getTime() ? [a, b] : [b, a];
  const elapsedMs = later.occurredAt.getTime() - earlier.occurredAt.getTime();
  if (elapsedMs === 0) {
    throw new ValidationError(
      'Cannot compute a daily gain between two weights taken at the same time',
    );
  }
  return (later.kg - earlier.kg) / (elapsedMs / MS_PER_DAY);
}
