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
import { uuidSchema, geoJsonStringSchema, timestampSchema } from './primitives';
import { weightPayloadSchema } from './events';

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
