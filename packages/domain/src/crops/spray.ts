/**
 * Pure builder for a farmer-owned spray record. Product facts and the optional interval are
 * farmer inputs. Werf preserves the capture-time snapshot and performs only transparent calendar
 * arithmetic; it does not approve the product or judge the spray.
 */

import { schemas, ValidationError } from '@werf/core';
import { addCalendarDays } from '../dates';

/** The day a pre-harvest interval starting on `sprayedOn` clears. Non-negative whole days — the
 *  same shape `withholdUntil` (`livestock/health.ts`) proves for a withdrawal, one field over. */
export function earliestHarvestDateFor(sprayedOn: string, phiDays: number): string {
  if (!Number.isInteger(phiDays) || phiDays < 0) {
    throw new ValidationError('A pre-harvest interval must be a non-negative whole number of days');
  }
  return addCalendarDays(sprayedOn, phiDays);
}

/** A spray, ready to become an event. `landUnitId` is not optional: a spray with no ground under
 *  it is not a spray — the same posture `planting`/`fertiliser` take. */
export interface SprayInput {
  /** Client-generated UUIDv7 for the event row (injected — a v7 embeds a clock this package can't read). */
  readonly id: string;
  readonly farmId: string;
  /** The block this was sprayed. Required — see the module note. */
  readonly landUnitId: string;
  /** When it was applied (injected). */
  readonly occurredAt: Date;
  /** The farm-local spray DAY (YYYY-MM-DD) — the base for the PHI arithmetic (injected). */
  readonly sprayedOn: string;
  readonly productId: string;
  readonly productName: string;
  readonly registrationNumber?: string;
  readonly activeIngredients?: readonly string[];
  /** Farmer-entered pre-harvest interval. Omit when the farmer has not entered one. */
  readonly phiDays?: number;
  readonly rateLPerHa?: number;
  readonly waterLPerHa?: number;
  readonly operator?: string;
  readonly equipment?: string;
  readonly windKph?: number;
  readonly tempC?: number;
  readonly targetPest?: string;
  /**
   * The stock lot this spray drew from (Phase 4e, FR-502) — OPTIONAL: a farm without inventory
   * tracking on can still spray. Purely a reference stored on the event; the quantity actually
   * consumed is a SEPARATE `inventory_movement` event a caller records independently
   * (`recordInventoryMovement`, `stock.ts`) — never invented here, since "how much" is the
   * farmer-typed fact the movement carries, not this event's concern.
   */
  readonly inventoryLotId?: string;
  readonly notes?: string | null;
  readonly createdBy?: string | null;
}

/**
 * Build a `spray` event from a capture. Validates the payload against its per-type schema, so a
 * missing product or a malformed rate fails loudly at the domain boundary with a typed error
 * instead of entering the append-only log.
 */
export function recordSpray(input: SprayInput): schemas.NewEvent {
  const payload: Record<string, unknown> = {
    productId: input.productId,
    productName: input.productName,
    sprayedOn: input.sprayedOn,
  };
  if (input.registrationNumber !== undefined) payload.registrationNumber = input.registrationNumber;
  if (input.activeIngredients !== undefined) payload.activeIngredients = input.activeIngredients;
  if (input.rateLPerHa !== undefined) payload.rateLPerHa = input.rateLPerHa;
  if (input.waterLPerHa !== undefined) payload.waterLPerHa = input.waterLPerHa;
  if (input.operator !== undefined) payload.operator = input.operator;
  if (input.equipment !== undefined) payload.equipment = input.equipment;
  if (input.windKph !== undefined) payload.windKph = input.windKph;
  if (input.tempC !== undefined) payload.tempC = input.tempC;
  if (input.targetPest !== undefined) payload.targetPest = input.targetPest;
  if (input.phiDays !== undefined) {
    payload.phiDays = input.phiDays;
    payload.earliestHarvestDate = earliestHarvestDateFor(input.sprayedOn, input.phiDays);
  }
  if (!schemas.sprayPayloadSchema.safeParse(payload).success) {
    throw new ValidationError('A spray needs the farmer’s product and a real block');
  }

  return {
    id: input.id,
    farmId: input.farmId,
    type: 'spray',
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
