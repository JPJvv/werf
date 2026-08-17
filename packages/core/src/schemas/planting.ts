/**
 * Wire contract for recording a planting (FR-203). Its own file rather than a fold into `land.ts`:
 * a planting is a crop fact carried on a piece of land, the same relationship `rainfall.ts` has to
 * `land.ts` — one file per domain concept, not per table.
 *
 * `landUnitId` is REQUIRED here, unlike `rainfall`'s optional one: a rainfall reading can be filed
 * against the whole farm, but a planting with no block under it is not a planting. `createdBy` and
 * `syncedAt` are absent because they are server-owned, as everywhere else.
 */

import { z } from 'zod';
import { uuidSchema, uuidV7Schema, timestampSchema } from './primitives';
import { plantingPayloadSchema } from './events';

export const recordPlantingRequestSchema = z.object({
  /** Client-generated UUIDv7 for the event row. */
  id: uuidV7Schema,
  farmId: uuidSchema,
  /** The block this was planted in. */
  landUnitId: uuidSchema,
  /** When it went in the ground. This IS the planted date (FR-203) — there is no second field. */
  occurredAt: timestampSchema,
  notes: z.string().min(1).nullable().default(null),
  // The facts themselves, reused from the `planting` event payload so the two cannot drift.
  ...plantingPayloadSchema.shape,
});
export type RecordPlantingRequest = z.infer<typeof recordPlantingRequestSchema>;
