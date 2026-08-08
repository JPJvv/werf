/**
 * Health capture (FR-130/131/132/133) — COMPLIANCE-GATED (legal-compliance.md § 3, .claude/rules/
 * domain.md). Record treatments, vaccinations and dips as append-only events, and — the sharp part
 * — compute the meat/milk WITHDRAWAL clear dates AT CAPTURE and store them on the event.
 *
 * Two rules this file exists to honour:
 *   1. NO regulated/product number is typed here. A withdrawal period is the veterinary product's
 *      registered figure (reference data, resolved by the treatment date); the caller injects
 *      `withdrawalDays`. A literal here would be a defect even if correct today.
 *   2. The withdrawal clear date is computed AT CAPTURE and stored (ADR-0005, FR-131), never on read.
 *      The rule that applied is the rule at the time of treatment — recomputing later against a
 *      re-registered withdrawal would silently move an animal in or out of a withholding period.
 *
 * Pure: no I/O, no clock. The event id and `occurredAt` are injected; withdrawal periods are
 * injected; the farm-local treatment date (`administeredOn`, a calendar day) is injected because
 * deriving it from an instant needs a timezone, which is farm data this layer must not assume.
 */

import { ValidationError, schemas } from '@werf/core';
import { addCalendarDays } from '../dates';

/** Fields every health capture carries. `animalId` is the treated animal (or a mob, for a group). */
export interface HealthBase {
  /** Client-generated UUIDv7 for the event row (injected — a v7 embeds a clock this package can't read). */
  readonly id: string;
  readonly farmId: string;
  /** Exactly one of the two is the subject. A dip/vaccination is often a whole mob. */
  readonly animalId?: string | null;
  readonly mobId?: string | null;
  /** When it happened on the farm (injected). Not `created_at`, set server-side on write. */
  readonly occurredAt: Date;
  /** The farm-local treatment DAY (YYYY-MM-DD) — the base for withdrawal arithmetic (injected). */
  readonly administeredOn: string;
  /**
   * The product's withdrawal periods in days, from veterinary product reference data resolved by
   * the treatment date (injected, never hardcoded). Omit or 0 when the product has no withdrawal.
   */
  readonly meatWithdrawalDays?: number;
  readonly milkWithdrawalDays?: number;
  readonly enterpriseId?: string | null;
  readonly batchId?: string | null;
  readonly locationGeojson?: string | null;
  readonly notes?: string | null;
  readonly createdBy?: string | null;
}

/** The date a meat/milk withholding started on `administeredOn` clears. Non-negative whole days. */
export function withholdUntil(administeredOn: string, withdrawalDays: number): string {
  if (!Number.isInteger(withdrawalDays) || withdrawalDays < 0) {
    throw new ValidationError('A withdrawal period must be a non-negative whole number of days');
  }
  return addCalendarDays(administeredOn, withdrawalDays);
}

/**
 * True when a sale / slaughter on `disposalOn` falls inside an active withholding — i.e. before the
 * clear date. The caller BLOCKS or hard-warns (FR-131). A missing withhold date means the product
 * carried no withdrawal, so nothing is withheld.
 */
export function isWithinWithdrawal(clearDate: string | undefined, disposalOn: string): boolean {
  return clearDate !== undefined && disposalOn < clearDate;
}

/**
 * Attach the dosing day and the withhold-until dates computed from the injected periods.
 *
 * ⭐ `administeredOn` goes ONTO the payload, and that is not redundant with the event's `occurredAt`.
 * A dose is day-grained — the farmer knows the day — so a back-dated capture invents an instant to
 * fill `occurredAt`. Every later regulated question about this event (which withdrawal applied,
 * which mob the animal was in when it was dosed) is a question about the DAY, and it must be
 * answered from the day that was recorded rather than from an instant that was made up to store it.
 */
function attachDosing(base: HealthBase, payload: Record<string, unknown>): void {
  payload.administeredOn = base.administeredOn;
  if (base.meatWithdrawalDays !== undefined) {
    payload.meatWithholdUntil = withholdUntil(base.administeredOn, base.meatWithdrawalDays);
  }
  if (base.milkWithdrawalDays !== undefined) {
    payload.milkWithholdUntil = withholdUntil(base.administeredOn, base.milkWithdrawalDays);
  }
}

function buildHealthEvent(
  base: HealthBase,
  type: schemas.NewEvent['type'],
  payloadSchema: { safeParse: (v: unknown) => { success: boolean } },
  payload: Record<string, unknown>,
): schemas.NewEvent {
  const animalId = base.animalId ?? null;
  const mobId = base.mobId ?? null;
  if ((animalId === null) === (mobId === null)) {
    throw new ValidationError(
      'A health event must be recorded against exactly one of an animal or a mob',
    );
  }
  attachDosing(base, payload);
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
    animalId,
    mobId,
    landUnitId: null,
    employeeId: null,
    batchId: base.batchId ?? null,
    locationGeojson: base.locationGeojson ?? null,
    notes: base.notes ?? null,
    createdBy: base.createdBy ?? null,
  };
}

// ── Treatment (FR-130/131) ────────────────────────────────────────────────────────
export interface TreatmentInput extends HealthBase {
  readonly product: string;
  readonly batch?: string;
  readonly doseValue?: number;
  readonly doseUnit?: string;
  readonly route?: schemas.TreatmentRoute;
  readonly administeredBy?: string;
  readonly reason?: string;
}

export function recordTreatment(input: TreatmentInput): schemas.NewEvent {
  const payload: Record<string, unknown> = { product: input.product };
  if (input.batch !== undefined) payload.batch = input.batch;
  if (input.doseValue !== undefined) payload.doseValue = input.doseValue;
  if (input.doseUnit !== undefined) payload.doseUnit = input.doseUnit;
  if (input.route !== undefined) payload.route = input.route;
  if (input.administeredBy !== undefined) payload.administeredBy = input.administeredBy;
  if (input.reason !== undefined) payload.reason = input.reason;
  return buildHealthEvent(input, 'treatment', schemas.treatmentPayloadSchema, payload);
}

// ── Vaccination (FR-132) ────────────────────────────────────────────────────────────
export interface VaccinationInput extends HealthBase {
  readonly product: string;
  readonly programme?: string;
  readonly batch?: string;
  readonly administeredBy?: string;
}

export function recordVaccination(input: VaccinationInput): schemas.NewEvent {
  const payload: Record<string, unknown> = { product: input.product };
  if (input.programme !== undefined) payload.programme = input.programme;
  if (input.batch !== undefined) payload.batch = input.batch;
  if (input.administeredBy !== undefined) payload.administeredBy = input.administeredBy;
  return buildHealthEvent(input, 'vaccination', schemas.vaccinationPayloadSchema, payload);
}

// ── Dip / tick treatment (FR-133) ─────────────────────────────────────────────────────
export interface DipInput extends HealthBase {
  readonly product: string;
  readonly method?: schemas.DipPayload['method'];
  readonly reason?: string;
}

export function recordDip(input: DipInput): schemas.NewEvent {
  const payload: Record<string, unknown> = { product: input.product };
  if (input.method !== undefined) payload.method = input.method;
  if (input.reason !== undefined) payload.reason = input.reason;
  return buildHealthEvent(input, 'dip', schemas.dipPayloadSchema, payload);
}
