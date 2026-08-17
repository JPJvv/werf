/**
 * Recording a planting as a farmer does it (FR-203): pick the block, name the crop, save — with no
 * signal anywhere in the path (NFR-007). Like the other capture tests these seed `localStorage` and
 * render the real `<App/>`, so the planting is read back through the same boot path a cold start
 * uses.
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

/** One block already on the device, so a planting has ground to be about. */
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

function storedPlantings(): Promise<readonly Record<string, unknown>[]> {
  return storedCaptures<Record<string, unknown>>(PLANTINGS_KEY);
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

describe('recording a planting (FR-203)', () => {
  it('saves a crop against a real block with the network dead, not merely absent', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', `/crops/plant?block=${BLOCK_ID}`);
    // Offline is the default state, not the error state: nothing below may await this.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    render(<App />);

    await user.type(await screen.findByLabelText(/^crop$/i), 'Maize');
    await user.click(screen.getByRole('button', { name: /save planting/i }));

    // append() commits synchronously (NFR-007), but persistence to the SQLite-backed store is
    // fire-and-forget — wait for it to land before reading it back.
    await waitFor(async () => {
      expect(await storedPlantings()).toHaveLength(1);
    });
    const saved = await storedPlantings();
    expect(saved[0]).toMatchObject({ farmId: FARM_ID, landUnitId: BLOCK_ID, crop: 'Maize' });
    expect(saved[0]!['cultivar']).toBeUndefined();
  });

  it('carries cultivar, density, seed source and expected harvest through untouched', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', `/crops/plant?block=${BLOCK_ID}`);
    render(<App />);

    await user.type(await screen.findByLabelText(/^crop$/i), 'Maize');
    await user.type(screen.getByLabelText(/cultivar/i), 'PAN 6479');
    await user.type(screen.getByLabelText(/^density/i), '32000');
    await user.type(screen.getByLabelText(/^unit$/i), 'plants/ha');
    await user.type(screen.getByLabelText(/seed source/i), 'Klein Karoo Seed');
    await user.type(screen.getByLabelText(/expected harvest/i), '2027-04-15');
    await user.click(screen.getByRole('button', { name: /save planting/i }));

    await waitFor(async () => {
      expect(await storedPlantings()).toHaveLength(1);
    });
    expect((await storedPlantings())[0]).toMatchObject({
      crop: 'Maize',
      cultivar: 'PAN 6479',
      density: { value: 32_000, unit: 'plants/ha' },
      seedSource: 'Klein Karoo Seed',
      expectedHarvestDate: '2027-04-15',
    });
  });

  it('refuses a density value with no unit, rather than dropping half of it silently', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', `/crops/plant?block=${BLOCK_ID}`);
    render(<App />);

    await user.type(await screen.findByLabelText(/^crop$/i), 'Maize');
    await user.type(screen.getByLabelText(/^density/i), '32000');

    expect(screen.getByRole('button', { name: /save planting/i }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByText(/give both a number and a unit/i)).toBeTruthy();

    expect(await storedPlantings()).toHaveLength(0);
  });

  it('will not save with no crop typed', async () => {
    window.history.pushState({}, '', `/crops/plant?block=${BLOCK_ID}`);
    render(<App />);

    expect(
      (await screen.findByRole('button', { name: /save planting/i })).hasAttribute('disabled'),
    ).toBe(true);

    expect(await storedPlantings()).toHaveLength(0);
  });

  it('⭐ saves against a REAL block when the link names one this phone does not hold', async () => {
    // The same defect class `WalkBoundaryScreen` closed: a bookmarked link, a block deleted since,
    // or the farm switcher (which changes farms WITHOUT navigating) must not leave an enabled Save
    // targeting a phantom.
    const user = userEvent.setup();
    window.history.pushState({}, '', '/crops/plant?block=0190f3a0-0000-7000-8000-00000000dead');
    render(<App />);

    await user.type(await screen.findByLabelText(/^crop$/i), 'Maize');
    const save = screen.getByRole('button', { name: /save planting/i });
    expect(save.hasAttribute('disabled')).toBe(false);
    await user.click(save);

    await waitFor(async () => {
      expect(await storedPlantings()).toHaveLength(1);
    });
    expect((await storedPlantings())[0]).toMatchObject({ landUnitId: BLOCK_ID });
  });

  it('offers no block picker and points at adding one first, when the farm has none yet', async () => {
    window.localStorage.removeItem(LAND_KEY);
    window.history.pushState({}, '', '/crops/plant');
    render(<App />);

    expect(await screen.findByText(/no blocks yet/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /add a block/i })).toBeTruthy();
    expect(screen.queryByLabelText(/^crop$/i)).toBeNull();
  });

  it('is reachable from a block’s row on the land list', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/land');
    render(<App />);

    expect(await screen.findByText(/not planted yet/i)).toBeTruthy();
    await user.click(screen.getByRole('link', { name: /record a planting/i }));

    expect(await screen.findByLabelText(/^crop$/i)).toBeTruthy();
  });
});
