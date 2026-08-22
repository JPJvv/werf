/** Wire contract for a harvest fact. PHI calculations are advisory and never block this capture. */

import { z } from 'zod';
import { uuidSchema, uuidV7Schema, timestampSchema, dateSchema } from './primitives';

export const recordHarvestRequestSchema = z.object({
  /** Client-generated UUIDv7 for the event row. */
  id: uuidV7Schema,
  farmId: uuidSchema,
  /** The block this was harvested. */
  landUnitId: uuidSchema,
  /** When the capture was made. */
  occurredAt: timestampSchema,
  /** The farm-local day harvested — the day the PHI guard judges (4d). Never defaulted from
   *  `occurredAt`: a back-dated capture from a dead zone must resolve against the day the harvest
   *  actually happened. */
  harvestedOn: dateSchema,
  quantity: z.number().positive().finite(),
  unit: z.string().min(1),
  grade: z.string().min(1).optional(),
  destination: z.string().min(1).optional(),
  notes: z.string().min(1).nullable().default(null),
});
export type RecordHarvestRequest = z.infer<typeof recordHarvestRequestSchema>;
