/**
 * Wire contracts for inventory (Phase 4e, FR-501). An item is the farm's own catalogue entry —
 * "our urea", "our Roundup" — and a lot is a physical batch of it: a delivery with its own batch
 * number, expiry, and location. Two tables for the same reason `chemical_products` (the national
 * registration) and a farm's stock of it are deliberately kept apart: what a product IS is not
 * how much of it THIS FARM has.
 *
 * A lot carries no starting quantity. It is created empty and RECEIVED into by a movement, so
 * there is exactly one code path that adds quantity rather than a special-cased "initial amount"
 * that duplicates what `recordInventoryMovement` already does.
 */

import { z } from 'zod';
import {
  dateSchema,
  inventoryItemCategorySchema,
  moneySchema,
  timestampSchema,
  uuidSchema,
  uuidV7Schema,
} from './primitives';
import { inventoryMovementReasonSchema } from './events';

export const newInventoryItemSchema = z.object({
  /** Client-generated UUIDv7 for the row. */
  id: uuidV7Schema,
  farmId: uuidSchema,
  enterpriseId: uuidSchema.nullable().default(null),
  category: inventoryItemCategorySchema,
  name: z.string().min(1),
  /** Free text, like `planting.density`'s unit — "kg", "L", "bag", "25kg bag": too many real
   *  units across chemicals/fertiliser/feed/medicine for a closed set. */
  unit: z.string().min(1),
});
export type NewInventoryItem = z.infer<typeof newInventoryItemSchema>;

export const newInventoryLotSchema = z.object({
  /** Client-generated UUIDv7 for the row. */
  id: uuidV7Schema,
  farmId: uuidSchema,
  inventoryItemId: uuidSchema,
  batch: z.string().min(1).nullable().default(null),
  expiryDate: dateSchema.nullable().default(null),
  location: z.string().min(1).nullable().default(null),
});
export type NewInventoryLot = z.infer<typeof newInventoryLotSchema>;

/**
 * Record a movement against a lot (received / consumed / counted). `quantity` is what the farmer
 * typed, always non-negative — the SIGN follows from `reason` in the domain, mirroring
 * `recordMobTallyRequestSchema`'s own `count` field for the identical reason: a client that could
 * send a negative receipt could corrupt a running total no later read would catch.
 */
export const recordInventoryMovementRequestSchema = z
  .object({
    id: uuidV7Schema,
    farmId: uuidSchema,
    inventoryLotId: uuidSchema,
    occurredAt: timestampSchema,
    reason: inventoryMovementReasonSchema,
    quantity: z.number().nonnegative().finite(),
    /** Money as integer cents, never a float. Only a `received` movement carries one. */
    unitCostCents: moneySchema.nonnegative().optional(),
    enterpriseId: uuidSchema.nullable().default(null),
    notes: z.string().min(1).nullable().default(null),
  })
  .superRefine((request, ctx) => {
    // Mirrors `inventoryMovementPayloadSchema`'s rule at the WIRE, so the refusal names the
    // offending field instead of surfacing as a generic error from the domain one layer in.
    if (request.reason !== 'received' && request.unitCostCents !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['unitCostCents'],
        message: 'Only a receipt carries a cost',
      });
    }
  });
export type RecordInventoryMovementRequest = z.infer<typeof recordInventoryMovementRequestSchema>;
