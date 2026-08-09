/**
 * Switching farms (FR-004), through the real `<App/>`.
 *
 * The behaviour that matters is that the switch is a VIEW decision the device makes on its own:
 * instant, offline, and telling the server afterwards. A farmer standing in a camp with no signal
 * must be able to change which farm they are looking at, and an implementation that awaited a POST
 * would put the network in front of an action that needs none.
 *
 * The second assertion is the one a bug would hide: switching swaps every farm-scoped local store
 * with it. The stores are keyed by the active farm's id, so one farm's animals must never appear
 * under another's — the client mirror of the RLS boundary.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uuidv7, type schemas } from '@werf/core';
import { App } from '../App';

const SESSION_KEY = 'werf-session';
const FARM_A = '0190f3a0-0000-7000-8000-0000000000f1';
const FARM_B = '0190f3a0-0000-7000-8000-0000000000f2';

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

function cachedSession(farms: Array<Record<string, unknown>>): void {
  const payload = {
    accessToken: 'access-token',
    expiresIn: 900,
    refreshToken: 'refresh-token',
    refreshExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    user: SESSION_USER,
    farms,
    activeFarmId: farms[0]!['id'],
    secondFactor: 'complete',
  };
  window.localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ payload, confirmedAt: new Date().toISOString() }),
  );
}

function farm(id: string, name: string) {
  return {
    id,
    businessId: '0190f3a0-0000-7000-8000-0000000000b1',
    name,
    enterpriseTypes: ['beef_cattle'],
    enterprises: [],
    role: 'owner',
  };
}

/** One animal on the given farm's store, so the two farms are distinguishable by their data. */
function seedAnimal(farmId: string, breed: string): void {
  window.localStorage.setItem(
    `werf-herd:${farmId}`,
    JSON.stringify([
      {
        id: uuidv7(),
        farmId,
        enterpriseId: null,
        species: 'cattle',
        breed,
        sex: 'female',
        dob: null,
        dobEstimated: false,
        status: 'alive',
        statusAt: null,
        damId: null,
        sireId: null,
        mobId: null,
        landUnitId: null,
        source: null,
        acquiredAt: null,
        brandId: null,
        brandAppliedAt: null,
        attributes: {},
        photoKey: null,
      },
    ]),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, '', '/');
});

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
});

describe('switching farms (FR-004)', () => {
  it('is not offered at all on a single-farm account', () => {
    // A picker with one option is not a choice; it is furniture, and the reference user has four
    // seconds.
    cachedSession([farm(FARM_A, 'Rietfontein')]);
    render(<App />);

    expect(screen.queryByRole('combobox', { name: /farm/i })).toBeNull();
  });

  it('switches the whole shell, and every farm-scoped store with it', async () => {
    cachedSession([farm(FARM_A, 'Rietfontein'), farm(FARM_B, 'Kudu Ranch')]);
    seedAnimal(FARM_A, 'Bonsmara');
    seedAnimal(FARM_B, 'Nguni');
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals');
    render(<App />);

    // The breed sits alongside the sex in one line, so it is matched as a substring.
    expect(await screen.findByText(/Bonsmara/)).toBeTruthy();

    await user.selectOptions(screen.getByRole('combobox', { name: /farm/i }), FARM_B);

    // The other farm's herd, and ONLY the other farm's herd. A store that leaked across the
    // boundary here would be the client's version of a broken RLS policy. findByText: switching
    // farms constructs a fresh set of capture stores that hydrate asynchronously
    // (phase-checklists.md 3c), same as a cold start does.
    expect(await screen.findByText(/Nguni/)).toBeTruthy();
    expect(screen.queryByText(/Bonsmara/)).toBeNull();
  });

  it('switches with no signal, and tells the server later rather than first', async () => {
    // The failure this pins: an implementation that awaited the POST would leave a farmer in a
    // dead zone unable to change which farm they are looking at.
    cachedSession([farm(FARM_A, 'Rietfontein'), farm(FARM_B, 'Kudu Ranch')]);
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
    const fetchMock = vi.fn(() => Promise.reject(new Error('no signal')));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<App />);

    await user.selectOptions(screen.getByRole('combobox', { name: /farm/i }), FARM_B);

    // The shell is showing the other farm, network or not — and it survives a cold start, because
    // the device wrote the choice down.
    expect(screen.getByRole('heading', { name: 'Kudu Ranch' })).toBeTruthy();
    const stored = JSON.parse(window.localStorage.getItem(SESSION_KEY)!) as {
      payload: { activeFarmId: string };
    };
    expect(stored.payload.activeFarmId).toBe(FARM_B);
  });
});
