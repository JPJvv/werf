/**
 * Inventory item categories (Phase 4e, FR-501). A closed set, not free text: chemicals,
 * fertiliser, feed and medicine are the four families FR-501 names, and a fixed vocabulary is
 * what lets a low-stock/expiry read model (FR-503) group and report across a mixed farm rather
 * than pattern-matching free text.
 *
 * Values match the Postgres `inventory_item_category` enum exactly, the same relationship
 * `LAND_UNIT_KINDS` has to `land_unit_kind`.
 */

export const INVENTORY_ITEM_CATEGORIES = ['chemical', 'fertiliser', 'feed', 'medicine'] as const;

export type InventoryItemCategory = (typeof INVENTORY_ITEM_CATEGORIES)[number];

export function isInventoryItemCategory(value: string): value is InventoryItemCategory {
  return (INVENTORY_ITEM_CATEGORIES as readonly string[]).includes(value);
}
