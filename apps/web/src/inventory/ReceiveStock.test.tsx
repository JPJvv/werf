/**
 * Receiving stock as a farmer does it (Phase 4e, FR-501): type what arrived, save — with no signal
 * anywhere in the path (NFR-007). Same shape as `RecordFertiliser.test.tsx`: seed `localStorage`,
 * render the real `<App/>`, read the item/lot/movement back through the same boot path a cold
 * start uses.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { schemas } from '@werf/core';
import { App } from '../App';
import { storedCaptures } from '../test-support/local-db';

const SESSION_KEY = 'werf-session';
const FARM_ID = '0190f3a0-0000-7000-8000-0000000000f1';
const ITEM_ID = '0190f3a0-0000-7000-8000-0000000000g1';
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

/** An item already on the device, ready to be topped up without creating a duplicate. */
function cachedItem(): void {
  window.localStorage.setItem(
    ITEMS_KEY,
    JSON.stringify([
      {
        id: ITEM_ID,
        farmId: FARM_ID,
        enterpriseId: null,
        category: 'chemical',
        name: 'Roundup PowerMax',
        unit: 'L',
      },
    ]),
  );
}

function storedItems(): Promise<readonly Record<string, unknown>[]> {
  return storedCaptures<Record<string, unknown>>(ITEMS_KEY);
}
function storedLots(): Promise<readonly Record<string, unknown>[]> {
  return storedCaptures<Record<string, unknown>>(LOTS_KEY);
}
function storedMovements(): Promise<readonly Record<string, unknown>[]> {
  return storedCaptures<Record<string, unknown>>(MOVEMENTS_KEY);
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

describe('receiving stock (Phase 4e, FR-501)', () => {
  it('creates a new item, an empty lot, and a received movement — with the network dead', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/inventory/receive');
    // Offline is the default state, not the error state: nothing below may await this.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    render(<App />);

    await user.type(await screen.findByLabelText(/what arrived/i), 'Urea 46%');
    await user.click(screen.getByRole('button', { name: /^fertiliser$/i }));
    await user.type(screen.getByLabelText(/^unit$/i), 'kg');
    await user.type(screen.getByLabelText(/how much arrived/i), '40');
    await user.click(screen.getByRole('button', { name: /save receipt/i }));

    await waitFor(async () => {
      expect(await storedMovements()).toHaveLength(1);
    });
    const items = await storedItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: 'Urea 46%', category: 'fertiliser', unit: 'kg' });

    const lots = await storedLots();
    expect(lots).toHaveLength(1);
    expect(lots[0]).toMatchObject({ inventoryItemId: items[0]!['id'], batch: null });

    const movements = await storedMovements();
    expect(movements[0]).toMatchObject({
      inventoryLotId: lots[0]!['id'],
      reason: 'received',
      quantity: 40,
      delta: 40,
    });
  });

  it('matches an EXISTING item by name and does not create a duplicate', async () => {
    const user = userEvent.setup();
    cachedItem();
    window.history.pushState({}, '', '/inventory/receive');
    render(<App />);

    await user.type(await screen.findByLabelText(/what arrived/i), 'Roundup PowerMax');
    // No category/unit fields for a matched item — the form only asks for what is new. Waited
    // for: the item store hydrates its legacy import asynchronously, and typing can outrun it.
    await waitFor(() => expect(screen.queryByLabelText(/^unit$/i)).toBeNull());
    await user.type(screen.getByLabelText(/how much arrived/i), '10');
    await user.click(screen.getByRole('button', { name: /save receipt/i }));

    await waitFor(async () => {
      expect(await storedMovements()).toHaveLength(1);
    });
    // The pre-existing seeded item, and no duplicate appended alongside it.
    expect(await storedItems()).toHaveLength(1);
    const lots = await storedLots();
    expect(lots[0]).toMatchObject({ inventoryItemId: ITEM_ID });
  });

  it('carries batch, expiry, location and cost through untouched', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/inventory/receive');
    render(<App />);

    await user.type(await screen.findByLabelText(/what arrived/i), 'Terramycin LA');
    await user.click(screen.getByRole('button', { name: /^medicine$/i }));
    await user.type(screen.getByLabelText(/^unit$/i), 'bottle');
    await user.type(screen.getByLabelText(/batch/i), 'B-2026-07');
    await user.type(screen.getByLabelText(/expires/i), '2027-06-30');
    await user.type(screen.getByLabelText(/where it is stored/i), 'Vet fridge');
    await user.type(screen.getByLabelText(/how much arrived/i), '5');
    await user.type(screen.getByLabelText(/what it cost/i), '1250.50');
    await user.click(screen.getByRole('button', { name: /save receipt/i }));

    await waitFor(async () => {
      expect(await storedMovements()).toHaveLength(1);
    });
    expect((await storedLots())[0]).toMatchObject({
      batch: 'B-2026-07',
      expiryDate: '2027-06-30',
      location: 'Vet fridge',
    });
    expect((await storedMovements())[0]).toMatchObject({ unitCostCents: 125_050 });
  });

  it('refuses a cost that does not look like rands, rather than dropping it silently', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/inventory/receive');
    render(<App />);

    await user.type(await screen.findByLabelText(/what arrived/i), 'Urea 46%');
    await user.type(screen.getByLabelText(/^unit$/i), 'kg');
    await user.type(screen.getByLabelText(/how much arrived/i), '40');
    await user.type(screen.getByLabelText(/what it cost/i), 'not a number');

    expect(screen.getByRole('button', { name: /save receipt/i }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByText(/does not look like an amount/i)).toBeTruthy();
    expect(await storedMovements()).toHaveLength(0);
  });

  it('will not save with no item typed', async () => {
    window.history.pushState({}, '', '/inventory/receive');
    render(<App />);

    expect(
      (await screen.findByRole('button', { name: /save receipt/i })).hasAttribute('disabled'),
    ).toBe(true);
    expect(await storedMovements()).toHaveLength(0);
  });

  it('will not save a NEW item with no quantity typed', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/inventory/receive');
    render(<App />);

    await user.type(await screen.findByLabelText(/what arrived/i), 'Urea 46%');
    await user.type(screen.getByLabelText(/^unit$/i), 'kg');

    expect(screen.getByRole('button', { name: /save receipt/i }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(await storedMovements()).toHaveLength(0);
  });

  it('is reachable from the stock list', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/inventory');
    render(<App />);

    expect(await screen.findByText(/no stock recorded yet/i)).toBeTruthy();
    await user.click(screen.getByRole('link', { name: /receive stock/i }));

    expect(await screen.findByLabelText(/what arrived/i)).toBeTruthy();
  });
});
