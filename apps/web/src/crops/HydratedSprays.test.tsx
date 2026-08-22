/**
 * The two-device conflict matrix for sprays (FR-204/FR-211): a spray another device recorded, or
 * this device's OWN spray round-tripping back down, must show up on the farmer's spray history.
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { schemas } from '@werf/core';
import { App } from '../App';
import { getCurrentFakeLocalDatabase, storedCaptures } from '../test-support/local-db';
import { mapHydratedSpray } from './HydratedSprays';

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

function cachedProduct(): void {
  window.localStorage.setItem(
    PRODUCTS_KEY,
    JSON.stringify([
      {
        id: PRODUCT_ID,
        jurisdiction: 'ZA',
        name: 'Cyprodinex 50 WG',
        registrationNumber: 'L1234',
        crop: 'grapes',
        phiDays: 7,
        reentryHours: 12,
        effectiveFrom: '2020-01-01',
        effectiveTo: null,
      },
    ]),
  );
}

async function hydrateSpray(overrides: Partial<Record<string, unknown>> = {}): Promise<void> {
  const fake = await getCurrentFakeLocalDatabase();
  act(() => {
    fake.hydrateRow('events', {
      id: '0190f3a0-0000-7000-8000-00000000e001',
      farm_id: FARM_ID,
      land_unit_id: BLOCK_ID,
      type: 'spray',
      occurred_at: '2026-10-05T05:00:00.000Z',
      payload: JSON.stringify({
        productId: PRODUCT_ID,
        productName: 'Cyprodinex 50 WG',
        registrationNumber: 'L1234',
        activeIngredients: ['cyprodinil'],
        sprayedOn: '2026-10-05',
        phiDays: 7,
        earliestHarvestDate: '2026-10-12',
      }),
      ...overrides,
    });
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, '', '/');
  cachedSession();
  cachedBlock();
  cachedProduct();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('spray hydration — a spray another device sent (FR-204/FR-211)', () => {
  it('⭐ shows a spray THIS device never itself captured, with its PHI resolved', async () => {
    window.history.pushState({}, '', '/sprays');
    render(<App />);
    await hydrateSpray();

    expect(await screen.findByText('Cyprodinex 50 WG · L1234')).toBeTruthy();
    expect(screen.getByText('2026-10-12')).toBeTruthy();
  });

  it('⭐ the hydrated echo of this device’s own spray keeps the farmer-entered snapshot', async () => {
    const sprayId = '0190f3a0-0000-7000-8000-00000000e003';
    window.localStorage.setItem(
      SPRAYS_KEY,
      JSON.stringify([
        {
          id: sprayId,
          farmId: FARM_ID,
          landUnitId: BLOCK_ID,
          occurredAt: '2026-10-05T05:00:00.000Z',
          sprayedOn: '2026-10-05',
          productId: PRODUCT_ID,
          productName: 'Cyprodinex 50 WG',
          registrationNumber: 'L1234',
          phiDays: 7,
          earliestHarvestDate: '2026-10-12',
        },
      ]),
    );
    window.history.pushState({}, '', '/sprays');
    render(<App />);

    // Before the echo lands, the capture already holds the farmer-entered reminder snapshot.
    expect(await screen.findByText('2026-10-12')).toBeTruthy();

    // The same spray round-trips back through the server with the SAME id, now carrying the PHI.
    await hydrateSpray({ id: sprayId });

    await waitFor(() => {
      expect(screen.getByText('2026-10-12')).toBeTruthy();
    });
    expect(await storedCaptures(SPRAYS_KEY)).toHaveLength(1);
  });
});

describe('⭐ inventory lot reference survives the down-sync mapping (Phase 4e, FR-502)', () => {
  const LOT_ID = '0190f3a0-0000-7000-8000-00000000e0aa';

  it('carries `inventory_lot_id` — a top-level COLUMN, not a payload field — onto the mapped row', () => {
    const mapped = mapHydratedSpray({
      id: '0190f3a0-0000-7000-8000-00000000e004',
      farm_id: FARM_ID,
      land_unit_id: BLOCK_ID,
      occurred_at: '2026-10-05T05:00:00.000Z',
      payload: JSON.stringify({
        productId: PRODUCT_ID,
        productName: 'Cyprodinex 50 WG',
        activeIngredients: ['cyprodinil'],
        sprayedOn: '2026-10-05',
      }),
      inventory_lot_id: LOT_ID,
    });

    expect(mapped?.inventoryLotId).toBe(LOT_ID);
  });

  it('omits it, rather than a stray null/undefined, when no lot was referenced', () => {
    const mapped = mapHydratedSpray({
      id: '0190f3a0-0000-7000-8000-00000000e005',
      farm_id: FARM_ID,
      land_unit_id: BLOCK_ID,
      occurred_at: '2026-10-05T05:00:00.000Z',
      payload: JSON.stringify({
        productId: PRODUCT_ID,
        productName: 'Cyprodinex 50 WG',
        activeIngredients: ['cyprodinil'],
        sprayedOn: '2026-10-05',
      }),
      inventory_lot_id: null,
    });

    expect(mapped && 'inventoryLotId' in mapped).toBe(false);
  });
});
