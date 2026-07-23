/**
 * Breeding capture (FR-120/121): record a mating/service, and record a pregnancy diagnosis with a
 * projected due date. Both are recorded against the DAM as append-only events; neither changes the
 * animal's status.
 *
 * Pure (.claude/rules/domain.md): no I/O, no clock. The event id (a client UUIDv7) and `occurredAt`
 * are injected. Crucially, GESTATION IS INJECTED reference data — a species gestation period is a
 * biological constant, not a jurisdictional rate, and not a magic number to type into this file.
 * The due date is computed AT CAPTURE and stored on the event, so a report never re-derives it from
 * a gestation figure that may have been corrected afterwards (the same "freeze the answer" discipline
 * the regulated-rate seam uses for withdrawal periods).
 */

import { ValidationError, schemas } from '@werf/core';

/** Fields a breeding capture carries. `animalId` is the DAM whose timeline the event belongs to. */
export interface BreedingBase {
  /** Client-generated UUIDv7 for the event row (injected — a v7 embeds a clock this package can't read). */
  readonly id: string;
  readonly farmId: string;
  /** The dam. */
  readonly animalId: string;
  /** When it happened on the farm (injected). Not `created_at`, set server-side on write. */
  readonly occurredAt: Date;
  readonly enterpriseId?: string | null;
  readonly batchId?: string | null;
  readonly locationGeojson?: string | null;
  readonly notes?: string | null;
  readonly createdBy?: string | null;
}

function buildBreedingEvent(
  base: BreedingBase,
  type: schemas.NewEvent['type'],
  payloadSchema: { safeParse: (v: unknown) => { success: boolean } },
  payload: Record<string, unknown>,
): schemas.NewEvent {
  if (!payloadSchema.safeParse(payload).success) {
    throw new ValidationError(`Invalid ${type} payload`);
  }
  return {
    id: base.id,
    farmId: base.farmId,
    type,
    occurredAt: base.occurredAt,
    payload,
    enterpriseId: base.enterpriseId ?? null,
    syncedAt: null,
    animalId: base.animalId,
    mobId: null,
    landUnitId: null,
    employeeId: null,
    batchId: base.batchId ?? null,
    locationGeojson: base.locationGeojson ?? null,
    notes: base.notes ?? null,
    createdBy: base.createdBy ?? null,
  };
}

// ── Mating / service (FR-120) ────────────────────────────────────────────────────
export interface MatingInput extends BreedingBase {
  readonly method: schemas.MatingPayload['method'];
  /** A bull on this farm (natural service). Mutually exclusive with `sireCode` in practice. */
  readonly sireId?: string;
  /** An external sire / AI straw code, when the sire is not an animal on the farm. */
  readonly sireCode?: string;
  /** A running-bull period: the service date is the window between these, not a single day. */
  readonly bullInAt?: string;
  readonly bullOutAt?: string;
}

export function recordMating(input: MatingInput): schemas.NewEvent {
  const payload: Record<string, unknown> = { method: input.method };
  if (input.sireId !== undefined) payload.sireId = input.sireId;
  if (input.sireCode !== undefined) payload.sireCode = input.sireCode;
  if (input.bullInAt !== undefined) payload.bullInAt = input.bullInAt;
  if (input.bullOutAt !== undefined) payload.bullOutAt = input.bullOutAt;
  return buildBreedingEvent(input, 'mating', schemas.matingPayloadSchema, payload);
}

// ── Pregnancy diagnosis (FR-121) ───────────────────────────────────────────────────

/**
 * Project a calving/lambing due date from a service date and an injected gestation period. Pure
 * calendar arithmetic on a `YYYY-MM-DD` service date — a due date is a day on the farm, not an
 * instant, so it never touches a timezone. `gestationDays` is species reference data supplied by
 * the caller (e.g. ≈283 for cattle, ≈150 for sheep) — never hardcoded here.
 */
export function projectDueDate(matingDate: string, gestationDays: number): string {
  if (!Number.isInteger(gestationDays) || gestationDays <= 0) {
    throw new ValidationError('Gestation must be a positive whole number of days');
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(matingDate);
  if (!match) {
    throw new ValidationError('Service date must be a YYYY-MM-DD calendar date');
  }
  const [, y, m, d] = match;
  const due = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)) + gestationDays * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${due.getUTCFullYear()}-${pad(due.getUTCMonth() + 1)}-${pad(due.getUTCDate())}`;
}

export interface PregnancyDiagnosisInput extends BreedingBase {
  readonly method: schemas.PregnancyTestPayload['method'];
  readonly result: schemas.PregnancyTestPayload['result'];
  /** The service date (YYYY-MM-DD) to project a due date from. Only used for a `pregnant` result. */
  readonly matingDate?: string;
  /** Injected species gestation in days. Only used for a `pregnant` result. */
  readonly gestationDays?: number;
}

export function recordPregnancyDiagnosis(input: PregnancyDiagnosisInput): schemas.NewEvent {
  const payload: Record<string, unknown> = { method: input.method, result: input.result };
  // A due date only exists for a positive diagnosis with a known service date and gestation; on an
  // open/uncertain result there is nothing to project, and projecting one would be a false claim.
  if (
    input.result === 'pregnant' &&
    input.matingDate !== undefined &&
    input.gestationDays !== undefined
  ) {
    payload.dueDate = projectDueDate(input.matingDate, input.gestationDays);
  }
  return buildBreedingEvent(input, 'pregnancy_test', schemas.pregnancyTestPayloadSchema, payload);
}
