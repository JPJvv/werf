/**
 * Wire contract for rainfall capture (FR-213). Cross-cutting, so it lives on its own rather than
 * under the livestock captures: a rain gauge reading is a FARM fact that grazing rest/rotation and
 * cropping both read.
 *
 * Note what the body cannot carry: no `animalId`, no `mobId`, no `enterpriseId`. Rain does not fall
 * on a herd. This is the documented exception to FR-113 herd scoping — filing a reading under
 * "cattle" would hide it from the crop side of a mixed farm, which is exactly the filing mistake
 * FR-113 exists to prevent. As everywhere else, `createdBy` and `syncedAt` are absent because they
 * are server-owned (schemas/livestock.ts explains why in full).
 */

import { z } from 'zod';
import { uuidSchema, uuidV7Schema, timestampSchema } from './primitives';
import { rainfallPayloadSchema } from './events';

export const recordRainfallRequestSchema = z.object({
  /** Client-generated UUIDv7 for the event row. */
  id: uuidV7Schema,
  farmId: uuidSchema,
  /** When the gauge was READ on the farm. Not `created_at` (set on write) — a gauge read on Sunday
   *  and captured on Wednesday belongs to Sunday in every report. */
  occurredAt: timestampSchema,
  /** The camp/block the gauge stands in, when the farm records rain per land unit. */
  landUnitId: uuidSchema.nullable().default(null),
  notes: z.string().min(1).nullable().default(null),
  // The reading itself, reused from the `rainfall` event payload so the two cannot drift.
  ...rainfallPayloadSchema.shape,
});
export type RecordRainfallRequest = z.infer<typeof recordRainfallRequestSchema>;
