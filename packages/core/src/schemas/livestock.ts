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
  birthPayloadSchema,
  deathPayloadSchema,
  dipPayloadSchema,
  tradePayloadSchema,
  treatmentRouteSchema,
  weaningPayloadSchema,
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
 * Record a birth (FR-104). The event is filed against the DAM — her timeline is where a calving
 * belongs — and the calf is referenced by the id the client already minted for its `animals` row.
 * The flush sends animals before events, so the calf exists by the time this arrives.
 */
export const recordBirthRequestSchema = z.object({
  id: uuidSchema,
  farmId: uuidSchema,
  /** The DAM. The event is hers; the calf is in the payload. */
  animalId: uuidSchema,
  /** When she calved, on the farm. Not `created_at` (set on write). */
  occurredAt: timestampSchema,
  ...birthPayloadSchema.omit({ damId: true }).shape,
});
export type RecordBirthRequest = z.infer<typeof recordBirthRequestSchema>;

/** Record a weaning (FR-111) — weight and, if known, age. No status change; the animal stays alive. */
export const recordWeaningRequestSchema = z.object({
  id: uuidSchema,
  farmId: uuidSchema,
  animalId: uuidSchema,
  occurredAt: timestampSchema,
  ...weaningPayloadSchema.shape,
});
export type RecordWeaningRequest = z.infer<typeof recordWeaningRequestSchema>;

/**
 * Record a purchase (FR-106) — an acquisition against an animal already in the herd. Unlike a sale
 * it does NOT change status: the animal arrives alive and stays alive. Same `trade` payload, so the
 * money side of buying and selling cannot drift apart.
 */
export const recordPurchaseRequestSchema = z.object({
  id: uuidSchema,
  farmId: uuidSchema,
  animalId: uuidSchema,
  occurredAt: timestampSchema,
  ...tradePayloadSchema.shape,
});
export type RecordPurchaseRequest = z.infer<typeof recordPurchaseRequestSchema>;

/**
 * Mark an animal missing (FR-605) — COMPLIANCE-GATED (legal-compliance.md § 3.2, stock theft).
 *
 * `lastSeenGeojson` is REQUIRED and not nullable, which is the whole point of "GPS-anchored": a
 * missing report with no point is of little use to the SAPS Stock Theft Unit, and it is the field
 * an evidence pack is built around. Making it optional "for convenience" would quietly hollow out
 * the one record this exists to produce.
 */
export const recordMissingRequestSchema = z.object({
  id: uuidSchema,
  farmId: uuidSchema,
  animalId: uuidSchema,
  /** When it was last seen, on the farm — days before this is captured, typically. */
  occurredAt: timestampSchema,
  /** Where it was last seen, as GeoJSON. Required. */
  lastSeenGeojson: geoJsonStringSchema,
  cause: z.string().min(1).optional(),
});
export type RecordMissingRequest = z.infer<typeof recordMissingRequestSchema>;

/**
 * Record a move (FR-103) — an animal walked to another camp and/or another mob.
 *
 * ⭐ Only the DESTINATION crosses the wire. The FROM side is read from the animal's own row
 * server-side, exactly as the herd is stamped from the subject (FR-113): the animal already knows
 * where it is, so asking the client to restate it only creates a way for the two to disagree, and a
 * `move` event whose "from" is wrong corrupts the movement history that a grazing rotation and a
 * stock-theft trail are both read from.
 *
 * The two destination fields are `.optional()` rather than defaulted, and the distinction is
 * load-bearing: OMITTING one leaves that dimension unchanged, while sending `null` is a real target
 * — taken off a mapped camp, or unassigned from its mob. A default of null would silently turn
 * "move it to Camp 4" into "move it to Camp 4 and take it out of its mob".
 */
export const recordMoveRequestSchema = z.object({
  id: uuidSchema,
  farmId: uuidSchema,
  animalId: uuidSchema,
  /** When the animal was walked, on the farm. Not `created_at` (set on write). */
  occurredAt: timestampSchema,
  /** Destination camp. Omit to leave the camp unchanged; `null` to take it off a mapped camp. */
  toLandUnitId: uuidSchema.nullable().optional(),
  /** Destination mob. Omit to leave the mob unchanged; `null` to unassign it from its mob. */
  toMobId: uuidSchema.nullable().optional(),
  /** Ties one walk across many animals together as a single action (FR-112). */
  batchId: uuidSchema.nullable().default(null),
  locationGeojson: geoJsonStringSchema.nullable().default(null),
  notes: z.string().min(1).nullable().default(null),
});
export type RecordMoveRequest = z.infer<typeof recordMoveRequestSchema>;

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
