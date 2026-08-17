/**
 * The two-device conflict matrix for land (phase-checklists.md 3e, land hydration — closed
 * 2026-08-14): a camp another device created, and a boundary walk another device sent, both already
 * replicated to THIS device via PowerSync, must be visible everywhere the local-only register used
 * to be the whole story — mirroring the same proof `AdjustMob.test.tsx`/`Outbox.test.tsx` already
 * run for mobs/tallies. `getCurrentFakeLocalDatabase().hydrateRow(...)` is the fake's stand-in for a
 * down-sync delivery landing; every assertion here fails against the pre-hydration code because
 * `LocalLand.tsx` read only its own local capture stores until this slice.
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { schemas } from '@werf/core';
import { App } from '../App';
import { getCurrentFakeLocalDatabase, storedCaptures } from '../test-support/local-db';

const SESSION_KEY = 'werf-session';
const FARM_ID = '0190f3a0-0000-7000-8000-0000000000f1';
const CAMP_ID = '0190f3a0-0000-7000-8000-0000000000c3';
const LAND_KEY = `werf-land:${FARM_ID}`;

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
        enterpriseTypes: ['beef_cattle'],
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

/** A camp only ANOTHER device knows about, delivered as a down-sync row. */
async function hydrateCamp(overrides: Partial<Record<string, unknown>> = {}): Promise<void> {
  const fake = await getCurrentFakeLocalDatabase();
  act(() => {
    fake.hydrateRow('land_units', {
      id: CAMP_ID,
      farm_id: FARM_ID,
      enterprise_id: null,
      parent_id: null,
      kind: 'camp',
      code: 'Camp 9',
      name: null,
      boundary_geojson: null,
      hectares: null,
      carrying_capacity_lsu: null,
      soil_type: null,
      irrigation: null,
      attributes: '{}',
      ...overrides,
    });
  });
}

async function hydrateWalk(overrides: Partial<Record<string, unknown>> = {}): Promise<void> {
  const fake = await getCurrentFakeLocalDatabase();
  act(() => {
    fake.hydrateRow('events', {
      id: '0190f3a0-0000-7000-8000-00000000e001',
      farm_id: FARM_ID,
      land_unit_id: CAMP_ID,
      type: 'boundary_walk',
      occurred_at: '2026-03-10T06:00:00.000Z',
      payload: JSON.stringify({
        boundaryGeojson: '{"type":"Polygon","coordinates":[[]]}',
        corners: [],
        areaHectares: 325.4,
      }),
      ...overrides,
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

describe('land hydration — a camp or a walk another device sent (phase-checklists.md 3e)', () => {
  it('⭐ shows a camp on the land list that THIS device never itself typed in', async () => {
    window.history.pushState({}, '', '/land');
    render(<App />);
    await hydrateCamp();

    expect(await screen.findByText('Camp 9')).toBeTruthy();
  });

  it('⭐ refuses a duplicate code against a camp known ONLY via hydration', async () => {
    window.history.pushState({}, '', '/land/new');
    render(<App />);
    await hydrateCamp();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/camp name or number/i), 'camp 9');

    expect(await screen.findByText(/already has a camp with that name/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /save camp/i }).hasAttribute('disabled')).toBe(true);
  });

  it('⭐ offers a hydrated-only camp as a walk destination', async () => {
    window.history.pushState({}, '', '/land/walk');
    render(<App />);
    await hydrateCamp();

    expect(await screen.findByText('Camp 9')).toBeTruthy();
  });

  it('⭐ shows the CURRENT boundary as the latest walk by total order, whichever device sent it', async () => {
    // A boundary is the same absolute-that-resets shape as a recount (`@werf/domain`'s
    // `boundary.ts` module header). Two walks, hydrated in the OPPOSITE of chronological order —
    // mirroring `Outbox.test.tsx`'s tally proof that arrival order cannot change the derived
    // result — must still resolve to the one that HAPPENED last, not the one heard about last.
    window.localStorage.setItem(
      LAND_KEY,
      JSON.stringify([
        {
          id: CAMP_ID,
          farmId: FARM_ID,
          kind: 'camp',
          code: 'Camp 3',
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
    window.history.pushState({}, '', '/land');
    render(<App />);

    // The LATER walk (10 March) hydrates FIRST — the fold must not let arrival order decide.
    await hydrateWalk({
      id: '0190f3a0-0000-7000-8000-00000000e001',
      occurred_at: '2026-03-10T06:00:00.000Z',
      payload: JSON.stringify({
        boundaryGeojson: '{"type":"Polygon","coordinates":[[]]}',
        corners: [],
        areaHectares: 325.4,
      }),
    });
    await hydrateWalk({
      id: '0190f3a0-0000-7000-8000-00000000e002',
      occurred_at: '2026-03-01T06:00:00.000Z',
      payload: JSON.stringify({
        boundaryGeojson: '{"type":"Polygon","coordinates":[[]]}',
        corners: [],
        areaHectares: 108.1,
      }),
    });

    await waitFor(() => {
      expect(screen.getByText(/325\.4/)).toBeTruthy();
    });
    expect(screen.queryByText(/108\.1/)).toBeNull();
  });

  it('a LOCAL walk this device captured is never shadowed by its own hydrated echo landing later', async () => {
    window.localStorage.setItem(
      LAND_KEY,
      JSON.stringify([
        {
          id: CAMP_ID,
          farmId: FARM_ID,
          kind: 'camp',
          code: 'Camp 3',
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
    const walkId = '0190f3a0-0000-7000-8000-00000000e003';
    window.localStorage.setItem(
      `werf-boundary-walks:${FARM_ID}`,
      JSON.stringify([
        {
          id: walkId,
          farmId: FARM_ID,
          landUnitId: CAMP_ID,
          occurredAt: '2026-03-10T06:00:00.000Z',
          corners: [],
          boundaryGeojson: '{"type":"Polygon","coordinates":[[]]}',
          areaHectares: 325.4,
        },
      ]),
    );
    window.history.pushState({}, '', '/land');
    render(<App />);

    expect(await screen.findByText(/325\.4/)).toBeTruthy();

    // The same walk round-trips back through the server with the SAME id.
    await hydrateWalk({
      id: walkId,
      occurred_at: '2026-03-10T06:00:00.000Z',
      payload: JSON.stringify({
        boundaryGeojson: '{"type":"Polygon","coordinates":[[]]}',
        corners: [],
        areaHectares: 325.4,
      }),
    });

    expect(await screen.findByText(/325\.4/)).toBeTruthy();
    expect(await storedCaptures(`werf-boundary-walks:${FARM_ID}`)).toHaveLength(1);
  });
});
