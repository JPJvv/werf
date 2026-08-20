/**
 * FR-503's pure read model (4e·5): which items are low, which lots are expired. Neither needs
 * React or the capture stores — both are plain folds over the merged item/lot lists a screen
 * already reads, mirroring `grazing.ts`'s own split between the pure fold and its `use*` wrapper.
 */

import { describe, expect, it } from 'vitest';
import type { StoredInventoryItem } from './LocalInventory';
import { lowStockWarnings, isExpired, type EffectiveInventoryLot } from './stock';

const FARM_ID = '0190f3a0-0000-7000-8000-0000000000f1';

function item(over: Partial<StoredInventoryItem> & { id: string }): StoredInventoryItem {
  return {
    farmId: FARM_ID,
    enterpriseId: null,
    category: 'fertiliser',
    name: 'Urea 46%',
    unit: 'kg',
    ...over,
  };
}

function lot(
  over: Partial<EffectiveInventoryLot> & { id: string; inventoryItemId: string },
): EffectiveInventoryLot {
  return {
    farmId: FARM_ID,
    batch: null,
    expiryDate: null,
    location: null,
    quantityOnHand: 0,
    ...over,
  };
}

describe('lowStockWarnings (FR-503, 4e·5)', () => {
  it('is silent for an item with no reorder point set — unset means no warning, never "warn at zero"', () => {
    const items = [item({ id: 'i1' })];
    const lots = [lot({ id: 'l1', inventoryItemId: 'i1', quantityOnHand: 0 })];

    expect(lowStockWarnings(items, lots)).toEqual([]);
  });

  it('is silent for an item with a null reorder point — the explicit-clear case, same as unset', () => {
    const items = [item({ id: 'i1', reorderPoint: null })];
    const lots = [lot({ id: 'l1', inventoryItemId: 'i1', quantityOnHand: 0 })];

    expect(lowStockWarnings(items, lots)).toEqual([]);
  });

  it('warns when the TOTAL across every lot of the item is at or below the reorder point', () => {
    const items = [item({ id: 'i1', reorderPoint: 20 })];
    const lots = [
      lot({ id: 'l1', inventoryItemId: 'i1', quantityOnHand: 8 }),
      lot({ id: 'l2', inventoryItemId: 'i1', quantityOnHand: 8 }),
    ];

    expect(lowStockWarnings(items, lots)).toEqual([
      { inventoryItemId: 'i1', quantityOnHand: 16, reorderPoint: 20 },
    ]);
  });

  it('⭐ does NOT warn off one low lot when another lot of the SAME item covers it — a low batch is normal, not a warning', () => {
    const items = [item({ id: 'i1', reorderPoint: 20 })];
    const lots = [
      lot({ id: 'l1', inventoryItemId: 'i1', quantityOnHand: 2 }),
      lot({ id: 'l2', inventoryItemId: 'i1', quantityOnHand: 40 }),
    ];

    expect(lowStockWarnings(items, lots)).toEqual([]);
  });

  it('never warns above the threshold', () => {
    const items = [item({ id: 'i1', reorderPoint: 20 })];
    const lots = [lot({ id: 'l1', inventoryItemId: 'i1', quantityOnHand: 21 })];

    expect(lowStockWarnings(items, lots)).toEqual([]);
  });
});

describe('isExpired (FR-503, 4e·5)', () => {
  it('is false for a lot with no expiry date recorded', () => {
    expect(isExpired({ expiryDate: null }, '2026-08-19')).toBe(false);
  });

  it('is false for a lot expiring today or later', () => {
    expect(isExpired({ expiryDate: '2026-08-19' }, '2026-08-19')).toBe(false);
    expect(isExpired({ expiryDate: '2026-08-20' }, '2026-08-19')).toBe(false);
  });

  it('is true for a lot whose expiry date has passed', () => {
    expect(isExpired({ expiryDate: '2026-08-18' }, '2026-08-19')).toBe(true);
  });
});
