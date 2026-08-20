/**
 * FR-211's auditor-facing spray history report. Specifically pins the discriminator between "this
 * spray has not round-tripped from the server yet" and "this spray is fully resolved and its
 * product genuinely carries no PHI on record" — the two states share `phiDays === undefined`, and a
 * screen that reads only `phiDays` cannot tell them apart (found by a compliance-checker pass,
 * 2026-08-17). `activeIngredients` is the correct discriminator: required non-empty on the wire, so
 * it is present on every hydrated echo and absent on every local-only capture.
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { schemas } from '@werf/core';
import { App } from '../App';
import { getCurrentFakeLocalDatabase } from '../test-support/local-db';

const SESSION_KEY = 'werf-session';
const FARM_ID = '0190f3a0-0000-7000-8000-0000000000f1';
const BLOCK_ID = '0190f3a0-0000-7000-8000-0000000000b1';
const NO_PHI_PRODUCT_ID = '0190f3a0-0000-7000-8000-00000000d002';
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

function cachedNoPhiProduct(): void {
  window.localStorage.setItem(
    PRODUCTS_KEY,
    JSON.stringify([
      {
        id: NO_PHI_PRODUCT_ID,
        jurisdiction: 'ZA',
        name: 'Sulphur WP',
        registrationNumber: 'L9999',
        crop: 'grapes',
        phiDays: null,
        reentryHours: null,
        effectiveFrom: '2020-01-01',
        effectiveTo: null,
      },
    ]),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, '', '/');
  cachedSession();
  cachedBlock();
  cachedNoPhiProduct();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('spray history report (FR-211)', () => {
  it('shows "not yet synced", never a permanent PHI label, for a spray this device has not hydrated', async () => {
    window.localStorage.setItem(
      SPRAYS_KEY,
      JSON.stringify([
        {
          id: '0190f3a0-0000-7000-8000-00000000e010',
          farmId: FARM_ID,
          landUnitId: BLOCK_ID,
          occurredAt: '2026-10-05T05:00:00.000Z',
          sprayedOn: '2026-10-05',
          productId: NO_PHI_PRODUCT_ID,
        },
      ]),
    );
    window.history.pushState({}, '', '/sprays');
    render(<App />);

    expect(await screen.findByText(/phi not yet confirmed by the server/i)).toBeTruthy();
  });

  it('⭐ shows "no PHI on record", not "not yet synced", once a no-PHI product resolves', async () => {
    window.history.pushState({}, '', '/sprays');
    render(<App />);

    const fake = await getCurrentFakeLocalDatabase();
    act(() => {
      fake.hydrateRow('events', {
        id: '0190f3a0-0000-7000-8000-00000000e011',
        farm_id: FARM_ID,
        land_unit_id: BLOCK_ID,
        type: 'spray',
        occurred_at: '2026-10-05T05:00:00.000Z',
        payload: JSON.stringify({
          productId: NO_PHI_PRODUCT_ID,
          activeIngredients: ['sulphur'],
          sprayedOn: '2026-10-05',
          // no phiDays / earliestHarvestDate — the product genuinely carries none.
        }),
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/no pre-harvest interval on record/i)).toBeTruthy();
    });
    expect(screen.queryByText(/phi not yet confirmed by the server/i)).toBeNull();
  });

  it('shows the resolved earliest harvest date once PHI is confirmed', async () => {
    window.history.pushState({}, '', '/sprays');
    render(<App />);

    const fake = await getCurrentFakeLocalDatabase();
    act(() => {
      fake.hydrateRow('events', {
        id: '0190f3a0-0000-7000-8000-00000000e012',
        farm_id: FARM_ID,
        land_unit_id: BLOCK_ID,
        type: 'spray',
        occurred_at: '2026-10-05T05:00:00.000Z',
        payload: JSON.stringify({
          productId: NO_PHI_PRODUCT_ID,
          activeIngredients: ['cyprodinil'],
          sprayedOn: '2026-10-05',
          phiDays: 7,
          earliestHarvestDate: '2026-10-12',
        }),
      });
    });

    expect(await screen.findByText('2026-10-12')).toBeTruthy();
  });
});
