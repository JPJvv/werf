/**
 * Wire contracts for livestock capture (Phase 2). These are the shapes a client composes
 * OFFLINE — id is its own UUIDv7, occurredAt is the farm-local instant it happened — and
 * posts to the API (or, in Phase 3, queues for sync). The server never invents an id or a
 * time here; it only stamps who (`created_by`, from the session) and when the row was
 * written (`created_at`). Both client and server validate against the identical schema.
 *
 * Two fields are deliberately ABSENT from every capture body:
 *   • createdBy — the author is the authenticated caller, read from the session, never the
 *     body. A body-supplied author would let a caller attribute a capture to someone else.
 *   • syncedAt  — server-owned; the client cannot assert when its own write reached the server.
 */

import { z } from 'zod';
import { uuidSchema, geoJsonStringSchema, dateSchema, timestampSchema } from './primitives';
import {
  deathPayloadSchema,
  dipPayloadSchema,
  tradePayloadSchema,
  treatmentRouteSchema,
  weightPayloadSchema,
} from './events';

export {
  newAnimalSchema as recordAnimalRequestSchema,
  type NewAnimal as RecordAnimalRequest,
} from './animals';

/**
 * Record a weight (FR-140). The reading (`kg` + `method`) is exactly the `weight` event
 * payload, reused so the two cannot drift. The subject is one of `animalId` (an individual)
 * or `mobId` (a whole group) — the "exactly one" rule is enforced once, in the `recordWeight`
 * domain function, so a bad capture fails with a typed ValidationError rather than being
 * duplicated as a schema refinement that could disagree with it.
 */
export const recordWeightRequestSchema = z.object({
  /** Client-generated UUIDv7 for the event row. */
  id: uuidSchema,
  farmId: uuidSchema,
  /** The individual animal weighed. Mutually exclusive with `mobId` (checked in the domain). */
  animalId: uuidSchema.nullable().default(null),
  /** The mob/flock weighed. Mutually exclusive with `animalId`. */
  mobId: uuidSchema.nullable().default(null),
  /** When the animal stepped on the scale, on the farm. Not `created_at` (set on write). */
  occurredAt: timestampSchema,
  /** Financial attribution — the enterprise this reading belongs to (FR-113 herd scoping). */
  enterpriseId: uuidSchema.nullable().default(null),
  /** Groups one weigh session across many animals (FR-112/142). */
  batchId: uuidSchema.nullable().default(null),
  /** GPS where it happened, as GeoJSON (never PostGIS on the wire). */
  locationGeojson: geoJsonStringSchema.nullable().default(null),
  notes: z.string().min(1).nullable().default(null),
  // The reading itself, reused from the `weight` event payload so the two cannot drift.
  ...weightPayloadSchema.shape,
});
export type RecordWeightRequest = z.infer<typeof recordWeightRequestSchema>;

/**
 * Record a death (FR-105). A death is always against an individual animal — the subject is
 * required here, not the animal-xor-mob of a weight — and drives its status to 'dead' through
 * the state machine (enforced in the `recordDeath` domain function, not duplicated here). The
 * cause (+ optional disposal) is exactly the `death` event payload, reused so the two cannot
 * drift.
 */
export const recordDeathRequestSchema = z.object({
  id: uuidSchema,
  farmId: uuidSchema,
  animalId: uuidSchema,
  /** When the animal died, on the farm. Not `created_at` (set on write). */
  occurredAt: timestampSchema,
  ...deathPayloadSchema.shape,
});
export type RecordDeathRequest = z.infer<typeof recordDeathRequestSchema>;

/**
 * Record a sale (FR-106) — an individual animal leaving the herd for a price. `priceCents` is
 * Money (integer cents, never a float) and non-negative; counterparty and the optional sale
 * weight are the `trade` event payload, reused so the wire and the stored event cannot drift.
 * A sale drives status → 'sold' via the state machine in the `recordSale` domain function.
 */
export const recordSaleRequestSchema = z.object({
  id: uuidSchema,
  farmId: uuidSchema,
  animalId: uuidSchema,
  /** When the animal was sold, on the farm. Not `created_at` (set on write). */
  occurredAt: timestampSchema,
  ...tradePayloadSchema.shape,
});
export type RecordSaleRequest = z.infer<typeof recordSaleRequestSchema>;

/**
 * Health capture (FR-130/131/132/133) — COMPLIANCE-GATED (legal-compliance.md § 3). The fields
 * every treatment / vaccination / dip carries. The sharp part: the client sends a `productId`, NOT
 * the withdrawal period. The server resolves the veterinary product's REGISTERED meat/milk
 * withdrawal from reference data (by the farm's jurisdiction) and computes+stores the clear dates on
 * the event AT CAPTURE (ADR-0005, FR-131). A withdrawal number never crosses the wire and never
 * appears in code (.claude/rules/domain.md); `product` (the name) is filled server-side too, so a
 * client cannot claim a shorter withdrawal by naming a different product than the one it selected.
 */
const healthCaptureBase = {
  /** Client-generated UUIDv7 for the event row. */
  id: uuidSchema,
  farmId: uuidSchema,
  /** Exactly one of the two is the subject (a dip/vaccination is often a whole mob) — the rule is
   *  enforced in the domain fn, not duplicated here. */
  animalId: uuidSchema.nullable().default(null),
  mobId: uuidSchema.nullable().default(null),
  /** When it happened on the farm. Not `created_at` (set on write). */
  occurredAt: timestampSchema,
  /** The farm-local treatment DAY (YYYY-MM-DD) — the base for the withdrawal clear-date arithmetic. */
  administeredOn: dateSchema,
  /** The veterinary_products row the farmer selected. The server resolves the registered withdrawal
   *  period AND the product name from it — never a withdrawal number on the wire. */
  productId: uuidSchema,
  /** Which herd/enterprise this event belongs to (FR-113). */
  enterpriseId: uuidSchema.nullable().default(null),
  /** Groups one dosing run across many animals (FR-112). */
  batchId: uuidSchema.nullable().default(null),
  locationGeojson: geoJsonStringSchema.nullable().default(null),
  notes: z.string().min(1).nullable().default(null),
} as const;

/** Record a treatment (FR-130/131): the registered product, batch, dose, route, who gave it, why. */
export const recordTreatmentRequestSchema = z.object({
  ...healthCaptureBase,
  batch: z.string().min(1).optional(),
  doseValue: z.number().positive().optional(),
  doseUnit: z.string().min(1).optional(),
  // Reused from the treatment payload so the route vocabulary cannot drift between wire and event.
  route: treatmentRouteSchema.optional(),
  administeredBy: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
});
export type RecordTreatmentRequest = z.infer<typeof recordTreatmentRequestSchema>;

/** Record a vaccination (FR-132): the product, the programme it belongs to, batch, who gave it. */
export const recordVaccinationRequestSchema = z.object({
  ...healthCaptureBase,
  programme: z.string().min(1).optional(),
  batch: z.string().min(1).optional(),
  administeredBy: z.string().min(1).optional(),
});
export type RecordVaccinationRequest = z.infer<typeof recordVaccinationRequestSchema>;

/** Record a dip / tick treatment (FR-133): required in controlled areas (Animal Diseases Act). */
export const recordDipRequestSchema = z.object({
  ...healthCaptureBase,
  // Reused from the dip payload so the method vocabulary cannot drift between wire and event.
  method: dipPayloadSchema.shape.method,
  reason: z.string().min(1).optional(),
});
export type RecordDipRequest = z.infer<typeof recordDipRequestSchema>;
