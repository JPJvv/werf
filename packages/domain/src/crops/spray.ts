/**
 * Recording a spray to GlobalGAP standard (FR-204) — COMPLIANCE-GATED (legal-compliance.md § 4,
 * .claude/rules/domain.md). The sharp part is the same discipline `livestock/health.ts` proves for
 * a treatment's withdrawal, one field over: the pre-harvest interval is computed AT CAPTURE from
 * the registered `chemical_products` figure and STORED on the event (ADR-0005), never recomputed on
 * read — the rule that applied is the rule at the time of the spray.
 *
 * Two rules this file exists to honour, mirroring `health.ts`'s own two:
 *   1. NO regulated/product number is typed here. The PHI is the chemical product's registered
 *      figure (reference data, resolved by the spray date); the caller injects `phiDays`. A
 *      literal here would be a defect even if correct today.
 *   2. The clear date (`earliestHarvestDate`) is computed AT CAPTURE and stored.
 *
 * `phiOverride` mirrors `harvest.ts`'s field of the same name exactly, one guard over
 * (`phi-guard.ts`'s `sprayPhiGuardFor`, legal-compliance.md § 4.3): present only when the caller's
 * own guard blocked this spray (its resulting PHI would clear after the block's planned harvest
 * date) and the farmer chose to override it. `by` is OPTIONAL for the identical reason it is on
 * `harvest.ts`'s field — the acting user id, never client-supplied; the API service always fills it
 * in, a client's own local capture has a reason but no server-trusted answer to give for who.
 *

 * Filed under `FARM_SCOPED_EVENT_TYPES` (@werf/core) — a block is ground, not a herd, the same
 * filing `planting`/`fertiliser` already use and for the identical reason.
 *
 * Pure: no I/O, no clock. The event id and `occurredAt` are injected; `phiDays` is injected
 * (already resolved by the caller, omitted when the product carries none — never zero); the
 * farm-local spray date (`sprayedOn`, a calendar day) is injected because deriving it from an
 * instant needs a timezone, which is farm data this layer must not assume.
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
  readonly activeIngredients: readonly string[];
  /**
   * The product's pre-harvest interval in whole days, from chemical-product reference data
   * resolved by the spray date (injected, never hardcoded). Omit when the product carries no PHI
   * on record — never inject 0 (see the module note).
   */
  readonly phiDays?: number;
  readonly rateLPerHa?: number;
  readonly waterLPerHa?: number;
  readonly operator?: string;
  readonly equipment?: string;
  readonly windKph?: number;
  readonly tempC?: number;
  readonly targetPest?: string;
  /**
   * Present only when the spray-capture PHI guard blocked this spray and the farmer overrode it
   * (legal-compliance.md § 4.3: "an override that requires a reason and is audited"). `by` is the
   * acting user id — the caller's job to resolve from the session when it can (server: always;
   * client: never — see the module note).
   */
  readonly phiOverride?: { readonly reason: string; readonly by?: string };
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
    activeIngredients: input.activeIngredients,
    sprayedOn: input.sprayedOn,
  };
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
  if (input.phiOverride !== undefined) payload.phiOverride = input.phiOverride;

  if (!schemas.sprayPayloadSchema.safeParse(payload).success) {
    throw new ValidationError(
      'A spray needs a registered product and active ingredients, on a real block',
    );
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
