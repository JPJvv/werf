/**
 * Wire contract for recording a harvest (FR-207) — COMPLIANCE-GATED (legal-compliance.md § 4.3,
 * US-030). Its own file for the same reason `spray.ts`/`planting.ts`/`fertiliser.ts` have one: a
 * harvest is a crop fact carried on a piece of land, one domain concept per file.
 *
 * ⭐ Deliberately does NOT spread `harvestPayloadSchema.shape` the way `recordPlantingRequestSchema`
 * and `recordFertiliserRequestSchema` spread theirs. `quantity`/`unit`/`grade`/`destination` carry
 * no compliance gate and would be safe to spread, but `phiOverride.by` is NOT — it is the acting
 * user id, resolved server-side from the authenticated session, never something a client may state
 * about itself (the identical property `recordSprayRequestSchema`'s enumeration protects for
 * `activeIngredients`/`phiDays`, one field over). Fields are enumerated one at a time so a future
 * field added to the payload schema does not silently become something a client can dictate.
 *
 * `landUnitId` is REQUIRED, mirroring `planting`/`fertiliser`/`spray`'s own reasoning: a harvest
 * with no block under it is not a harvest.
 */

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
  /** Present only when the PHI guard blocked this harvest and the farmer chose to override it
   *  (FR-205: "a written reason... is audited"). `by` is never carried here — the server resolves
   *  it from the authenticated session and writes it onto the stored event and the audit row. */
  phiOverride: z
    .object({
      reason: z.string().min(1),
    })
    .optional(),
  notes: z.string().min(1).nullable().default(null),
});
export type RecordHarvestRequest = z.infer<typeof recordHarvestRequestSchema>;
