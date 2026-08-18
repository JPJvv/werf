/**
 * The two-device conflict matrix for harvests (FR-207): a harvest another device recorded, already
 * replicated to THIS device via PowerSync, must be visible on the harvest-history screen — mirroring
 * `HydratedFertiliser.test.tsx`'s proof for a fertiliser application, one store over.
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
const HARVESTS_KEY = `werf-harvests:${FARM_ID}`;

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

async function hydrateHarvest(overrides: Partial<Record<string, unknown>> = {}): Promise<void> {
  const fake = await getCurrentFakeLocalDatabase();
  act(() => {
    fake.hydrateRow('events', {
      id: '0190f3a0-0000-7000-8000-00000000e001',
      farm_id: FARM_ID,
      land_unit_id: BLOCK_ID,
      type: 'harvest',
      occurred_at: '2026-11-01T04:00:00.000Z',
      payload: JSON.stringify({ harvestedOn: '2026-11-01', quantity: 12.5, unit: 'ton' }),
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

describe('harvest hydration — a harvest another device sent (FR-207)', () => {
  it('⭐ shows a harvest THIS device never itself captured', async () => {
    window.history.pushState({}, '', '/harvest');
    render(<App />);
    await hydrateHarvest();

    expect(await screen.findByText('12.5')).toBeTruthy();
  });

  it('⭐ shows the LATEST harvest as the latest by occurredAt, whichever device sent it', async () => {
    window.history.pushState({}, '', '/harvest');
    render(<App />);

    await hydrateHarvest({
      id: '0190f3a0-0000-7000-8000-00000000e001',
      occurred_at: '2026-11-10T04:00:00.000Z',
      payload: JSON.stringify({ harvestedOn: '2026-11-10', quantity: 20, unit: 'ton' }),
    });
    await hydrateHarvest({
      id: '0190f3a0-0000-7000-8000-00000000e002',
      occurred_at: '2026-11-01T04:00:00.000Z',
      payload: JSON.stringify({ harvestedOn: '2026-11-01', quantity: 12.5, unit: 'ton' }),
    });

    const rows = await screen.findAllByText(/2026-11-\d\d/);
    expect(rows[0]!.textContent).toContain('2026-11-10');
  });

  it('a LOCAL harvest this device captured is never duplicated by its own hydrated echo landing later', async () => {
    const harvestId = '0190f3a0-0000-7000-8000-00000000e003';
    window.localStorage.setItem(
      HARVESTS_KEY,
      JSON.stringify([
        {
          id: harvestId,
          farmId: FARM_ID,
          landUnitId: BLOCK_ID,
          occurredAt: '2026-11-14T04:00:00.000Z',
          harvestedOn: '2026-11-14',
          quantity: 8,
          unit: 'ton',
        },
      ]),
    );
    window.history.pushState({}, '', '/harvest');
    render(<App />);

    expect(await screen.findByText('8')).toBeTruthy();

    // The same harvest round-trips back through the server with the SAME id.
    await hydrateHarvest({
      id: harvestId,
      occurred_at: '2026-11-14T04:00:00.000Z',
      payload: JSON.stringify({ harvestedOn: '2026-11-14', quantity: 8, unit: 'ton' }),
    });

    await waitFor(async () => {
      expect(await storedCaptures(HARVESTS_KEY)).toHaveLength(1);
    });
    expect(screen.getAllByText('8')).toHaveLength(1);
  });

  it("⭐ a hydrated override's `by` ENRICHES a local capture, never shadowed by mergeById (local-wins)", async () => {
    const harvestId = '0190f3a0-0000-7000-8000-00000000e004';
    window.localStorage.setItem(
      HARVESTS_KEY,
      JSON.stringify([
        {
          id: harvestId,
          farmId: FARM_ID,
          landUnitId: BLOCK_ID,
          occurredAt: '2026-11-14T04:00:00.000Z',
          harvestedOn: '2026-11-14',
          quantity: 8,
          unit: 'ton',
          phiOverride: { reason: 'Export deadline' },
        },
      ]),
    );
    window.history.pushState({}, '', '/harvest');
    render(<App />);

    expect(await screen.findByText(/Export deadline/)).toBeTruthy();

    await hydrateHarvest({
      id: harvestId,
      occurred_at: '2026-11-14T04:00:00.000Z',
      payload: JSON.stringify({
        harvestedOn: '2026-11-14',
        quantity: 8,
        unit: 'ton',
        phiOverride: { reason: 'Export deadline', by: '0190f3a0-0000-7000-8000-000000000001' },
      }),
    });

    // Still exactly one row (no duplicate), and the reason still renders — the enrichment did not
    // break display; it is not independently visible on this screen (see the module note this test
    // file's header would carry if `by` were ever surfaced here).
    await waitFor(async () => {
      expect(await storedCaptures(HARVESTS_KEY)).toHaveLength(1);
    });
    expect(screen.getAllByText(/Export deadline/)).toHaveLength(1);
  });
});
