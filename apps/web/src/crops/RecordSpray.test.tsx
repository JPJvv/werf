/**
 * Recording a spray as a farmer does it (FR-204) — COMPLIANCE-GATED: pick the block, the day, the
 * registered product, save — with no signal anywhere in the path (NFR-007). Same shape as
 * `RecordPlanting.test.tsx`/`RecordFertiliser.test.tsx`: seed `localStorage`, render the real
 * `<App/>`, read the spray back through the same boot path a cold start uses.
 *
 * ⭐ Unlike planting/fertiliser, the saved record carries NO `phiDays`/`activeIngredients` — those
 * are server-resolved (`LocalSprays.tsx`'s module note) — so these tests assert their ABSENCE from
 * the local capture, not their value.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { schemas } from '@werf/core';
import { App } from '../App';
import { storedCaptures } from '../test-support/local-db';

const SESSION_KEY = 'werf-session';
const FARM_ID = '0190f3a0-0000-7000-8000-0000000000f1';
const BLOCK_ID = '0190f3a0-0000-7000-8000-0000000000b1';
const PRODUCT_ID = '0190f3a0-0000-7000-8000-00000000d001';
const LAND_KEY = `werf-land:${FARM_ID}`;
const SPRAYS_KEY = `werf-sprays:${FARM_ID}`;
const PRODUCTS_KEY = `werf-chemical-products:${FARM_ID}`;

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

function cachedBlock(): void {
  window.localStorage.setItem(
    LAND_KEY,
    JSON.stringify([
      {
        id: BLOCK_ID,
        farmId: FARM_ID,
        kind: 'block',
        code: 'B12',
        name: null,
        enterpriseId: null,
        parentId: null,
        boundaryGeojson: null,
        hectares: null,
        carryingCapacityLsu: null,
        soilType: null,
        irrigation: null,
        attributes: {},
      },
    ]),
  );
}

/** The register, already on the device — which is the state a spray tank is actually at. */
function seedProducts(phiDays: number | null): void {
  window.localStorage.setItem(
    PRODUCTS_KEY,
    JSON.stringify([
      {
        id: PRODUCT_ID,
        jurisdiction: 'ZA',
        name: 'Cyprodinex 50 WG',
        registrationNumber: 'L1234',
        crop: 'grapes',
        phiDays,
        reentryHours: 12,
        effectiveFrom: '2020-01-01',
        effectiveTo: null,
      },
    ]),
  );
}

function storedSprays(): Promise<readonly Record<string, unknown>[]> {
  return storedCaptures<Record<string, unknown>>(SPRAYS_KEY);
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, '', '/');
  cachedSession();
  cachedBlock();
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('recording a spray (FR-204)', () => {
  it('saves against a real block and product with the network dead, not merely absent', async () => {
    seedProducts(7);
    const user = userEvent.setup();
    window.history.pushState({}, '', `/crops/spray?block=${BLOCK_ID}`);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    render(<App />);

    await user.selectOptions(await screen.findByLabelText(/^product$/i), PRODUCT_ID);
    await user.click(screen.getByRole('button', { name: /save spray/i }));

    await waitFor(async () => {
      expect(await storedSprays()).toHaveLength(1);
    });
    const saved = await storedSprays();
    expect(saved[0]).toMatchObject({
      farmId: FARM_ID,
      landUnitId: BLOCK_ID,
      productId: PRODUCT_ID,
    });
    // The regulated fields are never on the local capture — see the module note.
    expect(saved[0]!['phiDays']).toBeUndefined();
    expect(saved[0]!['activeIngredients']).toBeUndefined();
  });

  it('shows the earliest safe harvest date as a preview from the cached register', async () => {
    seedProducts(7);
    const user = userEvent.setup();
    window.history.pushState({}, '', `/crops/spray?block=${BLOCK_ID}`);
    render(<App />);

    await user.selectOptions(await screen.findByLabelText(/^product$/i), PRODUCT_ID);

    expect(await screen.findByText(/earliest safe harvest/i)).toBeTruthy();
  });

  it('says a product has no PHI on record, rather than showing a false date', async () => {
    seedProducts(null);
    const user = userEvent.setup();
    window.history.pushState({}, '', `/crops/spray?block=${BLOCK_ID}`);
    render(<App />);

    await user.selectOptions(await screen.findByLabelText(/^product$/i), PRODUCT_ID);

    expect(await screen.findByText(/no pre-harvest interval on record/i)).toBeTruthy();
  });

  it('carries the optional detail through untouched when it is given', async () => {
    seedProducts(7);
    const user = userEvent.setup();
    window.history.pushState({}, '', `/crops/spray?block=${BLOCK_ID}`);
    render(<App />);

    await user.selectOptions(await screen.findByLabelText(/^product$/i), PRODUCT_ID);
    await user.type(screen.getByLabelText(/^rate/i), '2.5');
    await user.type(screen.getByLabelText(/^water/i), '200');
    await user.type(screen.getByLabelText(/target pest/i), 'Powdery mildew');
    await user.click(screen.getByRole('button', { name: /save spray/i }));

    await waitFor(async () => {
      expect(await storedSprays()).toHaveLength(1);
    });
    expect((await storedSprays())[0]).toMatchObject({
      rateLPerHa: 2.5,
      waterLPerHa: 200,
      targetPest: 'Powdery mildew',
    });
  });

  it('will not save with no product selected', async () => {
    seedProducts(7);
    window.history.pushState({}, '', `/crops/spray?block=${BLOCK_ID}`);
    render(<App />);

    expect(
      (await screen.findByRole('button', { name: /save spray/i })).hasAttribute('disabled'),
    ).toBe(true);

    expect(await storedSprays()).toHaveLength(0);
  });

  it('says the register has not reached this device yet, when it holds no products', async () => {
    window.history.pushState({}, '', `/crops/spray?block=${BLOCK_ID}`);
    render(<App />);

    expect(await screen.findByText(/no registered products yet/i)).toBeTruthy();
  });

  it('offers no block picker and points at adding one first, when the farm has none yet', async () => {
    seedProducts(7);
    window.localStorage.removeItem(LAND_KEY);
    window.history.pushState({}, '', '/crops/spray');
    render(<App />);

    expect(await screen.findByText(/no blocks yet/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /add a block/i })).toBeTruthy();
  });

  it('is reachable from the spray-history screen', async () => {
    seedProducts(7);
    const user = userEvent.setup();
    window.history.pushState({}, '', '/sprays');
    render(<App />);

    await user.click(screen.getByRole('link', { name: /record a spray/i }));

    expect(await screen.findByLabelText(/^product$/i)).toBeTruthy();
  });
});
