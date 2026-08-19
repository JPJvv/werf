/**
 * Wire contract for recording a spray (FR-204) — COMPLIANCE-GATED (legal-compliance.md § 4).
 * Its own file for the same reason `planting.ts`/`fertiliser.ts` have one: a spray is a crop fact
 * carried on a piece of land, one domain concept per file.
 *
 * ⭐ Deliberately does NOT spread `sprayPayloadSchema.shape` the way `recordPlantingRequestSchema`
 * and `recordFertiliserRequestSchema` spread theirs — those two carry no compliance gate, so the
 * client is trusted with every field it types. A spray is different: `activeIngredients`,
 * `phiDays` and `earliestHarvestDate` are SERVER-RESOLVED from the registered product (the identical
 * property `recordTreatmentRequestSchema` protects for a treatment's withdrawal, `livestock.ts`), and
 * `phiOverride.by` is NOT client-settable either — the identical property `recordHarvestRequestSchema`
 * protects for its own field of the same name, one guard over. Fields are enumerated here one at a
 * time so a future field added to the payload schema does not silently become something a client can
 * dictate.
 *
 * `landUnitId` is REQUIRED, mirroring `planting`/`fertiliser`'s own reasoning: a spray with no
 * block under it is not a spray.
 */

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
  /** The `chemical_products` row the farmer selected. The server resolves the registered active
   *  ingredients AND the pre-harvest interval from it — never sent by the client. */
  productId: uuidSchema,
  rateLPerHa: z.number().positive().finite().optional(),
  waterLPerHa: z.number().positive().finite().optional(),
  operator: z.string().min(1).optional(),
  equipment: z.string().min(1).optional(),
  windKph: z.number().nonnegative().finite().optional(),
  tempC: z.number().finite().optional(),
  targetPest: z.string().min(1).optional(),
  /** Present only when the spray-capture PHI guard blocked this spray (its resulting PHI would
   *  clear after the block's planned harvest date, legal-compliance.md § 4.3) and the farmer chose
   *  to override it. `by` is never carried here — the server resolves it from the authenticated
   *  session and writes it onto the stored event and the audit row. */
  phiOverride: z
    .object({
      reason: z.string().min(1),
    })
    .optional(),
  /** The stock lot this spray drew from (Phase 4e, FR-502) — OPTIONAL, not regulated, so unlike
   *  `productId` this is trusted straight from the client: `insertEvent`'s own
   *  `assertOwnedReferences` call still checks it belongs to this farm. The quantity consumed is a
   *  separate `inventory_movement` capture, never a field of this request. */
  inventoryLotId: uuidSchema.optional(),
  notes: z.string().min(1).nullable().default(null),
});
export type RecordSprayRequest = z.infer<typeof recordSprayRequestSchema>;
