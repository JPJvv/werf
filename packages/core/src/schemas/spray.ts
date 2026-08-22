/** Wire contract for a farmer's spray log. Product and PHI facts are farmer-entered inputs: Werf
 * preserves them and performs date arithmetic, but does not validate or authorise their use. */

import { z } from 'zod';
import { uuidSchema, uuidV7Schema, timestampSchema, dateSchema } from './primitives';

export const recordSprayRequestSchema = z.object({
  /** Client-generated UUIDv7 for the event row. */
  id: uuidV7Schema,
  farmId: uuidSchema,
  /** The block this was sprayed. */
  landUnitId: uuidSchema,
  /** When it was applied. */
  occurredAt: timestampSchema,
  /** The farm-local day sprayed — the base the server resolves the registration AND the PHI
   *  arithmetic against (ADR-0005). Never defaulted from `occurredAt`: a back-dated capture from a
   *  dead zone must resolve against the day the spray actually happened. */
  sprayedOn: dateSchema,
  /** Farm-owned inventory/product row selected by the farmer. */
  productId: uuidSchema,
  /** Capture-time snapshot: later product edits must not rewrite what this spray recorded. */
  productName: z.string().min(1),
  registrationNumber: z.string().min(1).optional(),
  activeIngredients: z.array(z.string().min(1)).optional(),
  /** Farmer-entered calculator input, not a Werf compliance determination. */
  phiDays: z.number().int().nonnegative().optional(),
  rateLPerHa: z.number().positive().finite().optional(),
  waterLPerHa: z.number().positive().finite().optional(),
  operator: z.string().min(1).optional(),
  equipment: z.string().min(1).optional(),
  windKph: z.number().nonnegative().finite().optional(),
  tempC: z.number().finite().optional(),
  targetPest: z.string().min(1).optional(),
  /** The stock lot this spray drew from (Phase 4e, FR-502) — OPTIONAL, not regulated, so unlike
   *  `productId` this is trusted straight from the client: `insertEvent`'s own
   *  `assertOwnedReferences` call still checks it belongs to this farm. The quantity consumed is a
   *  separate `inventory_movement` capture, never a field of this request. */
  inventoryLotId: uuidSchema.optional(),
  notes: z.string().min(1).nullable().default(null),
});
export type RecordSprayRequest = z.infer<typeof recordSprayRequestSchema>;
