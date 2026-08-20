/**
 * FR-503's write path (4e·5): the reorder-point editor on `StockScreen.tsx`. `GrazingSettings.test.tsx`
 * is the template — same shape of edit (owner/manager-set, online-only, PATCH, `saved`/`failed`
 * banners) one level down (per item, not per farm). Covers the branches `pnpm test:e2e`'s a11y pass
 * cannot: the `!canManage` read-only markup, a rejected save, and the offline-disabled state — none
 * of which render on the owner-online happy path that a11y fixture exercises.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

function cachedSession(role: string): void {
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
        role,
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
        quantity: 40,
        delta: 40,
      },
    ]),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, '', '/inventory');
  cachedStock();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
});

describe('reorder point editor (FR-503, 4e·5)', () => {
  it('an owner writes a new threshold: PATCHes the item id with {farmId, reorderPoint}, shows Saved', async () => {
    cachedSession('owner');
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    fireEvent.change(await screen.findByLabelText(/reorder point/i), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([callUrl]) =>
          String(callUrl).includes(`/inventory/items/${ITEM_ID}/reorder-point`),
        ),
      ).toBe(true),
    );
    const [url, init] = fetchMock.mock.calls.find(([callUrl]) =>
      String(callUrl).includes(`/inventory/items/${ITEM_ID}/reorder-point`),
    )!;
    expect(url).toContain(`/inventory/items/${ITEM_ID}/reorder-point`);
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual({ farmId: FARM_ID, reorderPoint: 20 });

    // Exact match, not a role query: the shell's own `SyncStatusStrip` is ALSO `role="status"` on
    // every route (`GrazingSettings.test.tsx`'s identical note) — "Saved" is this control's own
    // distinct string for exactly that reason.
    await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy());
  });

  it('shows the failure copy, not "Saved", when the server refuses the write', async () => {
    cachedSession('owner');
    const fetchMock = vi.fn(async (callUrl: string, _init?: RequestInit) => {
      if (!String(callUrl).includes('/inventory/items/')) {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return { ok: false, status: 403, json: async () => ({ code: 'FORBIDDEN', message: 'nope' }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    fireEvent.change(await screen.findByLabelText(/reorder point/i), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByText(/could not be saved/i)).toBeTruthy());
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('is read-only for a worker — plain text, not the editable form', async () => {
    cachedSession('worker');
    render(<App />);

    await screen.findByText(/urea 46%/i);
    expect(screen.queryByLabelText(/reorder point/i)).toBeNull();
    expect(screen.getByText(/not set/i)).toBeTruthy();
  });

  it('allows a manager, unlike the farm-wide rest-period-days setting', async () => {
    cachedSession('manager');
    render(<App />);

    expect(await screen.findByLabelText(/reorder point/i)).toBeTruthy();
  });

  it('refuses to save with no connection, and never calls fetch', async () => {
    cachedSession('owner');
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    fireEvent.change(await screen.findByLabelText(/reorder point/i), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByText(/needs signal/i)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
