/**
 * The two-device conflict matrix for fertiliser applications (FR-206): an application another
 * device recorded, already replicated to THIS device via PowerSync, must be visible on the land
 * list — mirroring `HydratedCrops.test.tsx`'s proof for a planting, one store over.
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { schemas } from '@werf/core';
import { App } from '../App';
import { getCurrentFakeLocalDatabase, storedCaptures } from '../test-support/local-db';

const SESSION_KEY = 'werf-session';
const FARM_ID = '0190f3a0-0000-7000-8000-0000000000f1';
const BLOCK_ID = '0190f3a0-0000-7000-8000-0000000000b1';
const LAND_KEY = `werf-land:${FARM_ID}`;
const FERTILISER_KEY = `werf-fertiliser:${FARM_ID}`;

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

async function hydrateFertiliser(overrides: Partial<Record<string, unknown>> = {}): Promise<void> {
  const fake = await getCurrentFakeLocalDatabase();
  act(() => {
    fake.hydrateRow('events', {
      id: '0190f3a0-0000-7000-8000-00000000e001',
      farm_id: FARM_ID,
      land_unit_id: BLOCK_ID,
      type: 'fertiliser',
      occurred_at: '2026-09-01T04:00:00.000Z',
      payload: JSON.stringify({ product: 'Compost', method: 'broadcast' }),
      ...overrides,
    });
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, '', '/');
  cachedSession();
  cachedBlock();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('fertiliser hydration — an application another device sent (FR-206)', () => {
  it('⭐ shows a block as fertilised from an application THIS device never itself captured', async () => {
    window.history.pushState({}, '', '/land');
    render(<App />);
    await hydrateFertiliser();

    expect(await screen.findByText('Compost')).toBeTruthy();
  });

  it('⭐ shows the LATEST application as the latest by occurredAt, whichever device sent it', async () => {
    window.history.pushState({}, '', '/land');
    render(<App />);

    // The LATER application (14 September) hydrates FIRST — the fold must not let arrival order win.
    await hydrateFertiliser({
      id: '0190f3a0-0000-7000-8000-00000000e001',
      occurred_at: '2026-09-14T04:00:00.000Z',
      payload: JSON.stringify({ product: 'LAN 28%', method: 'broadcast' }),
    });
    await hydrateFertiliser({
      id: '0190f3a0-0000-7000-8000-00000000e002',
      occurred_at: '2026-09-01T04:00:00.000Z',
      payload: JSON.stringify({ product: 'Compost', method: 'broadcast' }),
    });

    await waitFor(() => {
      expect(screen.getByText('LAN 28%')).toBeTruthy();
    });
    expect(screen.queryByText('Compost')).toBeNull();
  });

  it('a LOCAL application this device captured is never shadowed by its own hydrated echo landing later', async () => {
    const applicationId = '0190f3a0-0000-7000-8000-00000000e003';
    window.localStorage.setItem(
      FERTILISER_KEY,
      JSON.stringify([
        {
          id: applicationId,
          farmId: FARM_ID,
          landUnitId: BLOCK_ID,
          occurredAt: '2026-09-14T04:00:00.000Z',
          product: 'LAN 28%',
          method: 'broadcast',
        },
      ]),
    );
    window.history.pushState({}, '', '/land');
    render(<App />);

    expect(await screen.findByText('LAN 28%')).toBeTruthy();

    // The same application round-trips back through the server with the SAME id.
    await hydrateFertiliser({
      id: applicationId,
      occurred_at: '2026-09-14T04:00:00.000Z',
      payload: JSON.stringify({ product: 'LAN 28%', method: 'broadcast' }),
    });

    expect(await screen.findByText('LAN 28%')).toBeTruthy();
    expect(await storedCaptures(FERTILISER_KEY)).toHaveLength(1);
  });
});
