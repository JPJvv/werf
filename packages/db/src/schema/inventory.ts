/**
 * Inventory — items and lots (Phase 4e, FR-501). An item is the farm's own catalogue entry for a
 * chemical, fertiliser, feed or medicine — "our urea", "our Roundup" — and a lot is a physical
 * batch of it, with its own batch number, expiry and location. Deliberately two tables, the same
 * split `chemical_products` (what a registration IS, national reference data) draws from a farm's
 * own stock of it: conflating them would make a farm's stock count sync-scoped by jurisdiction
 * instead of by farm.
 *
 * `quantity_on_hand` is DERIVED from the `inventory_movement` event log, never edited directly —
 * the identical relationship `mobs.head_count` has to the `tally` log (see `@werf/domain`'s
 * `projectQuantityOnHand`). Unlike a mob, a lot carries no immutable baseline column: it is
 * created empty (zero) and RECEIVED into by a movement, so there is nothing to carry forward.
 */

import { sql } from 'drizzle-orm';
import { check, date, numeric, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { auditColumns, primaryId } from './columns';
import { inventoryItemCategoryEnum } from './enums';
import { enterprises, farms, users } from './core';

export const inventoryItems = pgTable(
  'inventory_items',
  {
    id: primaryId(),
    farmId: uuid('farm_id')
      .notNull()
      .references(() => farms.id),
    enterpriseId: uuid('enterprise_id').references(() => enterprises.id),
    category: inventoryItemCategoryEnum('category').notNull(),
    name: text('name').notNull(),
    /** Free text — "kg", "L", "bag" — too many real units across four categories for a closed set. */
    unit: text('unit').notNull(),
    /**
     * FR-503's low-stock WARNING threshold (4e·5) — how much of this item the farm wants on hand
     * before it counts as running low. Nullable, no default: an unset threshold means no warning
     * is shown, never a guessed number presented as if it were considered advice — the identical
     * "no seeded default" decision `farms.rest_period_days` (4e·2) already made, one item at a
     * time instead of one farm-wide number, because a reorder point cannot honestly be a single
     * farm-wide figure (5kg of dip and 2 tonnes of feed have nothing in common). Owner/manager-set
     * and editable after creation — see `inventory.service.ts`'s `updateReorderPoint`.
     */
    reorderPoint: numeric('reorder_point', { precision: 12, scale: 2 }),
    ...auditColumns,
    createdBy: uuid('created_by').references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
  },
  (t) => [
    check(
      'inventory_items_reorder_point_positive',
      sql`${t.reorderPoint} IS NULL OR ${t.reorderPoint} > 0`,
    ),
  ],
);

export const inventoryLots = pgTable('inventory_lots', {
  id: primaryId(),
  farmId: uuid('farm_id')
    .notNull()
    .references(() => farms.id),
  inventoryItemId: uuid('inventory_item_id')
    .notNull()
    .references(() => inventoryItems.id),
  batch: text('batch'),
  expiryDate: date('expiry_date'),
  location: text('location'),
  /** The current quantity — derived from the `inventory_movement` log, never edited. See module note. */
  quantityOnHand: numeric('quantity_on_hand', { precision: 12, scale: 2 }).notNull().default('0'),
  ...auditColumns,
  createdBy: uuid('created_by').references(() => users.id),
  updatedBy: uuid('updated_by').references(() => users.id),
});
