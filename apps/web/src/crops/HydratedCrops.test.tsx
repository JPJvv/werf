/**
 * The two-device conflict matrix for crops (FR-203): a planting another device recorded, already
 * replicated to THIS device via PowerSync, must be visible everywhere the local-only register used
 * to be the whole story — mirroring `land/HydratedLand.test.tsx`'s proof for a boundary walk, one
 * domain over. `getCurrentFakeLocalDatabase().hydrateRow(...)` is the fake's stand-in for a down-
 * sync delivery landing.
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
const PLANTINGS_KEY = `werf-plantings:${FARM_ID}`;

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

async function hydratePlanting(overrides: Partial<Record<string, unknown>> = {}): Promise<void> {
  const fake = await getCurrentFakeLocalDatabase();
  act(() => {
    fake.hydrateRow('events', {
      id: '0190f3a0-0000-7000-8000-00000000e001',
      farm_id: FARM_ID,
      land_unit_id: BLOCK_ID,
      type: 'planting',
      occurred_at: '2026-09-01T04:00:00.000Z',
      payload: JSON.stringify({ crop: 'Lucerne' }),
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

describe('crop hydration — a planting another device sent (FR-203)', () => {
  it('⭐ shows a block as planted from a planting THIS device never itself captured', async () => {
    window.history.pushState({}, '', '/land');
    render(<App />);
    await hydratePlanting();

    expect(await screen.findByText('Lucerne')).toBeTruthy();
  });

  it('⭐ shows the CURRENT planting as the latest by occurredAt, whichever device sent it', async () => {
    window.history.pushState({}, '', '/land');
    render(<App />);

    // The LATER planting (14 September) hydrates FIRST — the fold must not let arrival order win.
    await hydratePlanting({
      id: '0190f3a0-0000-7000-8000-00000000e001',
      occurred_at: '2026-09-14T04:00:00.000Z',
      payload: JSON.stringify({ crop: 'Maize' }),
    });
    await hydratePlanting({
      id: '0190f3a0-0000-7000-8000-00000000e002',
      occurred_at: '2026-09-01T04:00:00.000Z',
      payload: JSON.stringify({ crop: 'Sunflower' }),
    });

    await waitFor(() => {
      expect(screen.getByText('Maize')).toBeTruthy();
    });
    expect(screen.queryByText('Sunflower')).toBeNull();
  });

  it('⭐ breaks a same-day TIE by id, not by arrival order — the case a distinct-timestamp test cannot see', async () => {
    // Day-grained captures (`RecordPlantingScreen.tsx`'s `plantedInstant` stamps a back-dated day at
    // exactly T12:00:00.000Z) make this the NORMAL case for this screen, not an edge one: two
    // plantings of one block on one day are byte-identical on `occurredAt`, so the fold's tie-break
    // is what actually decides which crop shows — the same `COLLINEAR_EPSILON` shape `boundary.ts`
    // already learned this lesson for. The lower id hydrates FIRST, so a broken tie-break (e.g.
    // "first seen wins") would still pass a test that hydrated the higher id first; this one cannot.
    window.history.pushState({}, '', '/land');
    render(<App />);

    await hydratePlanting({
      id: '0190f3a0-0000-7000-8000-00000000e001',
      occurred_at: '2026-09-14T12:00:00.000Z',
      payload: JSON.stringify({ crop: 'Maize' }),
    });
    await hydratePlanting({
      id: '0190f3a0-0000-7000-8000-00000000e002',
      occurred_at: '2026-09-14T12:00:00.000Z',
      payload: JSON.stringify({ crop: 'Sunflower' }),
    });

    await waitFor(() => {
      expect(screen.getByText('Sunflower')).toBeTruthy();
    });
    expect(screen.queryByText('Maize')).toBeNull();
  });

  it('a LOCAL planting this device captured is never shadowed by its own hydrated echo landing later', async () => {
    const plantingId = '0190f3a0-0000-7000-8000-00000000e003';
    window.localStorage.setItem(
      PLANTINGS_KEY,
      JSON.stringify([
        {
          id: plantingId,
          farmId: FARM_ID,
          landUnitId: BLOCK_ID,
          occurredAt: '2026-09-14T04:00:00.000Z',
          crop: 'Maize',
        },
      ]),
    );
    window.history.pushState({}, '', '/land');
    render(<App />);

    expect(await screen.findByText('Maize')).toBeTruthy();

    // The same planting round-trips back through the server with the SAME id.
    await hydratePlanting({
      id: plantingId,
      occurred_at: '2026-09-14T04:00:00.000Z',
      payload: JSON.stringify({ crop: 'Maize' }),
    });

    expect(await screen.findByText('Maize')).toBeTruthy();
    expect(await storedCaptures(PLANTINGS_KEY)).toHaveLength(1);
  });
});
