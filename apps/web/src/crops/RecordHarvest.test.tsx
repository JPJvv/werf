/** Harvest capture stays a farmer-owned fact; interval calculations are reminders only. */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { schemas } from '@werf/core';
import { App } from '../App';
import { storedCaptures } from '../test-support/local-db';

const FARM_ID = '0190f3a0-0000-7000-8000-0000000000f1';
const BLOCK_ID = '0190f3a0-0000-7000-8000-0000000000b1';
const CHILD_ID = '0190f3a0-0000-7000-8000-0000000000b2';
const PRODUCT_ID = '0190f3a0-0000-7000-8000-00000000d001';
const SESSION_KEY = 'werf-session';
const LAND_KEY = `werf-land:${FARM_ID}`;
const ITEMS_KEY = `werf-inventory-items:${FARM_ID}`;
const SPRAYS_KEY = `werf-sprays:${FARM_ID}`;
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

function seedBase(): void {
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

function seedIntervalReminder(): void {
  window.localStorage.setItem(
    ITEMS_KEY,
    JSON.stringify([
      {
        id: PRODUCT_ID,
        farmId: FARM_ID,
        enterpriseId: null,
        category: 'chemical',
        name: 'My Orchard Mix',
        unit: 'L',
        phiDays: 21,
      },
    ]),
  );
  window.localStorage.setItem(
    SPRAYS_KEY,
    JSON.stringify([
      {
        id: '0190f3a0-0000-7000-8000-00000000e001',
        farmId: FARM_ID,
        landUnitId: BLOCK_ID,
        occurredAt: '2026-03-01T08:00:00.000Z',
        sprayedOn: '2026-03-01',
        productId: PRODUCT_ID,
        productName: 'My Orchard Mix',
        phiDays: 21,
        earliestHarvestDate: '2026-03-22',
      },
    ]),
  );
}

async function fillHarvest(user: ReturnType<typeof userEvent.setup>, day = '2026-03-15') {
  await user.type(await screen.findByLabelText(/quantity/i), '5');
  await user.type(screen.getByLabelText(/^unit$/i), 'ton');
  const dayInput = screen.getByLabelText(/day harvested/i) as HTMLInputElement;
  await user.clear(dayInput);
  await user.type(dayInput, day);
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, '', `/crops/harvest?block=${BLOCK_ID}`);
  seedBase();
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('farmer-owned harvest capture', () => {
  it('saves offline as a plain farm record', async () => {
    const user = userEvent.setup();
    render(<App />);
    await fillHarvest(user);
    await user.click(screen.getByRole('button', { name: /save harvest/i }));

    await waitFor(async () => expect(await storedCaptures(HARVESTS_KEY)).toHaveLength(1));
    expect((await storedCaptures<Record<string, unknown>>(HARVESTS_KEY))[0]).toMatchObject({
      farmId: FARM_ID,
      landUnitId: BLOCK_ID,
      harvestedOn: '2026-03-15',
      quantity: 5,
      unit: 'ton',
    });
  });

  it('shows an interval reminder but lets the farmer save without an override', async () => {
    seedIntervalReminder();
    const user = userEvent.setup();
    render(<App />);
    await fillHarvest(user);

    expect(await screen.findByText(/interval reminder/i)).toBeTruthy();
    expect(screen.getByText(/2026-03-22/)).toBeTruthy();
    const save = screen.getByRole('button', { name: /save harvest/i });
    expect(save.hasAttribute('disabled')).toBe(false);
    expect(screen.queryByRole('button', { name: /override/i })).toBeNull();
    await user.click(save);

    await waitFor(async () => expect(await storedCaptures(HARVESTS_KEY)).toHaveLength(1));
    expect(
      (await storedCaptures<Record<string, unknown>>(HARVESTS_KEY))[0]!['phiOverride'],
    ).toBeUndefined();
  });

  it('keeps only malformed data as a save gate', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText(/quantity/i), '5');
    await user.type(screen.getByLabelText(/^unit$/i), 'ton');
    await user.clear(screen.getByLabelText(/day harvested/i));
    expect(screen.getByRole('button', { name: /save harvest/i }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('points out a parent history as a useful reminder, not a confirmation requirement', async () => {
    const blocks = JSON.parse(window.localStorage.getItem(LAND_KEY)!) as unknown[];
    blocks.push({
      ...(blocks[0] as object),
      id: CHILD_ID,
      code: 'B12-A',
      parentId: BLOCK_ID,
    });
    window.localStorage.setItem(LAND_KEY, JSON.stringify(blocks));
    window.history.pushState({}, '', `/crops/harvest?block=${CHILD_ID}`);
    render(<App />);
    expect(await screen.findByText(/parent block may have older spray records/i)).toBeTruthy();
  });
});
