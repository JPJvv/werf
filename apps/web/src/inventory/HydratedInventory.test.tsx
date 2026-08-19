/**
 * FR-503's reorder point (4e·5) is a client-absent-then-server-enriched field: an item this device
 * creates never carries one (`LocalInventory.tsx`'s module note — there is no creation-time field
 * for it), so the ONLY way this device ever learns its own item's threshold is the hydrated echo of
 * its own row once an owner/manager sets one. `stock.ts`'s `useEffectiveInventoryItems` switched
 * from `mergeById` to `mergeByIdPreferHydrated` for exactly this — proving it here mirrors
 * `HydratedFertiliser.test.tsx`'s own two-part shape: a direct mapper unit test, then an
 * end-to-end proof through the real screen.
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { schemas } from '@werf/core';
import { App } from '../App';
import { getCurrentFakeLocalDatabase } from '../test-support/local-db';
import { mapHydratedInventoryItem } from './HydratedInventory';

const FARM_ID = '0190f3a0-0000-7000-8000-0000000000f1';
const ITEM_ID = '0190f3a0-0000-7000-8000-0000000000g1';
const LOT_ID = '0190f3a0-0000-7000-8000-0000000000g2';
const SESSION_KEY = 'werf-session';
const ITEMS_KEY = `werf-inventory-items:${FARM_ID}`;
const LOTS_KEY = `werf-inventory-lots:${FARM_ID}`;
const MOVEMENTS_KEY = `werf-inventory-movements:${FARM_ID}`;

const SESSION_USER: schemas.AuthSession['user'] = {
  id: '0190f3a0-0000-7000-8000-000000000001',
  email: 'thabo@rietfontein.test',
  phone: null,
  fullName: 'Thabo Mokoena',
  locale: 'en-ZA',
  theme: 'light',
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

function cachedSession(): void {
  const payload = {
    accessToken: 'access-token',
    expiresIn: 900,
    refreshToken: 'refresh-token',
    refreshExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    user: SESSION_USER,
    farms: [
      {
        id: FARM_ID,
        name: 'Rietfontein',
        enterpriseTypes: ['row_crops'],
        role: 'owner',
        enterprises: [],
      },
    ],
    activeFarmId: FARM_ID,
    secondFactor: 'complete',
  };
  window.localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ payload, confirmedAt: new Date().toISOString() }),
  );
}

/** This device's OWN offline capture of the item — no `reorderPoint` at all, matching what
 *  `ReceiveStockScreen.tsx` actually writes. */
function cachedLocalStock(): void {
  window.localStorage.setItem(
    ITEMS_KEY,
    JSON.stringify([
      {
        id: ITEM_ID,
        farmId: FARM_ID,
        enterpriseId: null,
        category: 'fertiliser',
        name: 'Urea 46%',
        unit: 'kg',
      },
    ]),
  );
  window.localStorage.setItem(
    LOTS_KEY,
    JSON.stringify([
      {
        id: LOT_ID,
        farmId: FARM_ID,
        inventoryItemId: ITEM_ID,
        batch: null,
        expiryDate: null,
        location: null,
      },
    ]),
  );
  window.localStorage.setItem(
    MOVEMENTS_KEY,
    JSON.stringify([
      {
        id: '0190f3a0-0000-7000-8000-0000000000g3',
        farmId: FARM_ID,
        inventoryLotId: LOT_ID,
        occurredAt: '2026-08-01T04:00:00.000Z',
        reason: 'received',
        quantity: 5,
        delta: 5,
      },
    ]),
  );
}

async function hydrateItem(reorderPoint: number | null): Promise<void> {
  const fake = await getCurrentFakeLocalDatabase();
  act(() => {
    fake.hydrateRow('inventory_items', {
      id: ITEM_ID,
      farm_id: FARM_ID,
      enterprise_id: null,
      category: 'fertiliser',
      name: 'Urea 46%',
      unit: 'kg',
      reorder_point: reorderPoint,
    });
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, '', '/');
  cachedSession();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('mapHydratedInventoryItem — reorder_point (FR-503, 4e·5)', () => {
  it('maps a numeric reorder_point column', () => {
    const mapped = mapHydratedInventoryItem({
      id: ITEM_ID,
      farm_id: FARM_ID,
      enterprise_id: null,
      category: 'fertiliser',
      name: 'Urea 46%',
      unit: 'kg',
      reorder_point: 20,
    });

    expect(mapped?.reorderPoint).toBe(20);
  });

  it('maps an unset reorder_point to null, not undefined — an explicit "no threshold" fact', () => {
    const mapped = mapHydratedInventoryItem({
      id: ITEM_ID,
      farm_id: FARM_ID,
      enterprise_id: null,
      category: 'fertiliser',
      name: 'Urea 46%',
      unit: 'kg',
      reorder_point: null,
    });

    expect(mapped?.reorderPoint).toBeNull();
  });
});

describe('⭐ a reorder point set by another device reaches THIS device on its own item (FR-503, 4e·5)', () => {
  it('shows the hydrated reorder point, never shadowed by this device’s own reorder-point-less copy', async () => {
    cachedLocalStock();
    window.history.pushState({}, '', '/inventory');
    render(<App />);
    await screen.findByText(/urea 46%/i);

    // An owner/manager (possibly on another device) sets the threshold after this device already
    // created the item — the exact client-absent-then-server-enriched sequence the module note
    // describes.
    await hydrateItem(20);

    await waitFor(() => {
      expect(screen.getByDisplayValue('20')).toBeTruthy();
    });
  });

  it('surfaces the low-stock warning once the hydrated threshold lands, having shown none before it', async () => {
    cachedLocalStock();
    window.history.pushState({}, '', '/inventory');
    render(<App />);
    await screen.findByText(/urea 46%/i);
    expect(screen.queryByText(/low stock/i)).toBeNull();

    // 5kg on hand, a 20kg reorder point set from elsewhere.
    await hydrateItem(20);

    await waitFor(() => {
      expect(screen.getByText(/low stock/i)).toBeTruthy();
    });
  });
});
