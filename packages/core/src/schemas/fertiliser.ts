/**
 * Wire contract for recording a fertiliser application (FR-206). Its own file for the same reason
 * `planting.ts` has one: a fertiliser application is a crop fact carried on a piece of land, one
 * domain concept per file, not one file per table.
 *
 * `landUnitId` is REQUIRED, mirroring `planting`'s own reasoning: a fertiliser application with no
 * block under it is not a fertiliser application. No compliance gate applies (FR-206 carries none,
 * unlike FR-204's spray) — no reference product is resolved server-side, `product` is free text.
 */

import { z } from 'zod';
import { uuidSchema, uuidV7Schema, timestampSchema } from './primitives';
import { fertiliserPayloadSchema } from './events';

export const recordFertiliserRequestSchema = z.object({
  /** Client-generated UUIDv7 for the event row. */
  id: uuidV7Schema,
  farmId: uuidSchema,
  /** The block this was applied to. */
  landUnitId: uuidSchema,
  /** When it was applied. */
  occurredAt: timestampSchema,
  /** The stock lot this application drew from (Phase 4e, FR-502) — OPTIONAL, the identical field
   *  `spray.ts`'s request schema carries. The quantity consumed is a separate `inventory_movement`
   *  capture, never a field of this request. */
  inventoryLotId: uuidSchema.optional(),
  notes: z.string().min(1).nullable().default(null),
  // The facts themselves, reused from the `fertiliser` event payload so the two cannot drift.
  ...fertiliserPayloadSchema.shape,
});
export type RecordFertiliserRequest = z.infer<typeof recordFertiliserRequestSchema>;
