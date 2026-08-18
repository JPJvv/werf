/**
 * Reading stock on hand as a farmer does it (Phase 4e, FR-501): the quantity a screen shows is
 * PROJECTED from the movement log, not a field read off the lot row — so the fixture below seeds a
 * lot at its created (zero) quantity plus a separate `received` movement, exactly as a real device
 * would hold them, and asserts the SUM renders rather than either piece alone.
 */

import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { schemas } from '@werf/core';
import { App } from '../App';

const SESSION_KEY = 'werf-session';
const FARM_ID = '0190f3a0-0000-7000-8000-0000000000f1';
const ITEM_ID = '0190f3a0-0000-7000-8000-0000000000g1';
const LOT_ID = '0190f3a0-0000-7000-8000-0000000000g2';
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

function cachedStock(): void {
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
        batch: 'B-2026-01',
        expiryDate: null,
        location: 'Main store',
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
        quantity: 40,
        delta: 40,
      },
      {
        id: '0190f3a0-0000-7000-8000-0000000000g4',
        farmId: FARM_ID,
        inventoryLotId: LOT_ID,
        occurredAt: '2026-08-05T04:00:00.000Z',
        reason: 'consumed',
        quantity: 12,
        delta: -12,
      },
    ]),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, '', '/');
  cachedSession();
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('stock on hand (Phase 4e, FR-501)', () => {
  it('shows the quantity PROJECTED from the movement log, not the lot’s created (zero) quantity', async () => {
    cachedStock();
    window.history.pushState({}, '', '/inventory');
    render(<App />);

    await screen.findByText(/urea 46%/i);
    // 40 received, 12 consumed — the fold, not either recorded field alone.
    expect(screen.getByText(/28/)).toBeTruthy();
    expect(screen.getByText(/b-2026-01/i)).toBeTruthy();
    expect(screen.getByText(/main store/i)).toBeTruthy();
  });

  it('shows the empty state honestly when the farm has no stock yet', async () => {
    window.history.pushState({}, '', '/inventory');
    render(<App />);

    expect(await screen.findByText(/no stock recorded yet/i)).toBeTruthy();
    expect(screen.queryByText(/urea/i)).toBeNull();
  });
});
