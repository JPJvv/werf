/**
 * Recording a fertiliser application as a farmer does it (FR-206): pick the block, the method
 * (what distinguishes fertigation from broadcast/band), save — with no signal anywhere in the path
 * (NFR-007). Same shape as `RecordPlanting.test.tsx`: seed `localStorage`, render the real
 * `<App/>`, read the application back through the same boot path a cold start uses.
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

/** One block already on the device, so an application has ground to be about. */
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

function storedApplications(): Promise<readonly Record<string, unknown>[]> {
  return storedCaptures<Record<string, unknown>>(FERTILISER_KEY);
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

describe('recording a fertiliser application (FR-206)', () => {
  it('saves a product against a real block with the network dead, not merely absent', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', `/crops/fertilise?block=${BLOCK_ID}`);
    // Offline is the default state, not the error state: nothing below may await this.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    render(<App />);

    await user.type(await screen.findByLabelText(/^product$/i), 'LAN 28%');
    await user.click(screen.getByRole('button', { name: /save application/i }));

    await waitFor(async () => {
      expect(await storedApplications()).toHaveLength(1);
    });
    const saved = await storedApplications();
    expect(saved[0]).toMatchObject({
      farmId: FARM_ID,
      landUnitId: BLOCK_ID,
      product: 'LAN 28%',
      method: 'broadcast',
    });
    expect(saved[0]!['rate']).toBeUndefined();
  });

  it('carries the fertigation method and rate through untouched when selected', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', `/crops/fertilise?block=${BLOCK_ID}`);
    render(<App />);

    await user.type(await screen.findByLabelText(/^product$/i), 'Nitrosol');
    await user.click(screen.getByRole('button', { name: /^fertigation$/i }));
    await user.type(screen.getByLabelText(/^rate/i), '12');
    await user.type(screen.getByLabelText(/^unit$/i), 'L/ha');
    await user.type(screen.getByLabelText(/applied by/i), 'Sipho');
    await user.click(screen.getByRole('button', { name: /save application/i }));

    await waitFor(async () => {
      expect(await storedApplications()).toHaveLength(1);
    });
    expect((await storedApplications())[0]).toMatchObject({
      product: 'Nitrosol',
      method: 'fertigation',
      rate: { value: 12, unit: 'L/ha' },
      operator: 'Sipho',
    });
  });

  it('refuses a rate value with no unit, rather than dropping half of it silently', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', `/crops/fertilise?block=${BLOCK_ID}`);
    render(<App />);

    await user.type(await screen.findByLabelText(/^product$/i), 'LAN 28%');
    await user.type(screen.getByLabelText(/^rate/i), '250');

    expect(screen.getByRole('button', { name: /save application/i }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByText(/give both a number and a unit/i)).toBeTruthy();

    expect(await storedApplications()).toHaveLength(0);
  });

  it('will not save with no product typed', async () => {
    window.history.pushState({}, '', `/crops/fertilise?block=${BLOCK_ID}`);
    render(<App />);

    expect(
      (await screen.findByRole('button', { name: /save application/i })).hasAttribute('disabled'),
    ).toBe(true);

    expect(await storedApplications()).toHaveLength(0);
  });

  it('offers no block picker and points at adding one first, when the farm has none yet', async () => {
    window.localStorage.removeItem(LAND_KEY);
    window.history.pushState({}, '', '/crops/fertilise');
    render(<App />);

    expect(await screen.findByText(/no blocks yet/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /add a block/i })).toBeTruthy();
    expect(screen.queryByLabelText(/^product$/i)).toBeNull();
  });

  it('is reachable from a block’s row on the land list', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/land');
    render(<App />);

    expect(await screen.findByText(/no fertiliser recorded/i)).toBeTruthy();
    await user.click(screen.getByRole('link', { name: /record fertiliser/i }));

    expect(await screen.findByLabelText(/^product$/i)).toBeTruthy();
  });
});
