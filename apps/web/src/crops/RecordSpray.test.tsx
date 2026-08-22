/** Farmer-owned spray capture: useful offline, optional detail, no regulatory gate. */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { schemas } from '@werf/core';
import { App } from '../App';
import { storedCaptures } from '../test-support/local-db';

const FARM_ID = '0190f3a0-0000-7000-8000-0000000000f1';
const BLOCK_ID = '0190f3a0-0000-7000-8000-0000000000b1';
const PRODUCT_ID = '0190f3a0-0000-7000-8000-00000000d001';
const SESSION_KEY = 'werf-session';
const LAND_KEY = `werf-land:${FARM_ID}`;
const ITEMS_KEY = `werf-inventory-items:${FARM_ID}`;
const SPRAYS_KEY = `werf-sprays:${FARM_ID}`;
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

function seedSessionAndBlock(): void {
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

function seedProduct(): void {
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
        registrationNumber: 'Label 123',
        activeIngredients: ['ingredient one'],
        phiDays: 7,
        reentryHours: null,
      },
    ]),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, '', `/crops/spray?block=${BLOCK_ID}`);
  seedSessionAndBlock();
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('farmer-owned spray capture', () => {
  it('adds the farmer’s own product and saves a useful spray with no signal', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(await screen.findByLabelText(/product name/i), 'Tank Mix A');
    await user.type(screen.getByLabelText(/registration number/i), 'MY-LABEL-7');
    await user.type(screen.getByLabelText(/active ingredients/i), 'alpha, beta');
    await user.type(screen.getByLabelText(/pre-harvest interval/i), '7');
    const day = screen.getByLabelText(/day sprayed/i) as HTMLInputElement;
    await user.clear(day);
    await user.type(day, '2026-03-01');

    const save = screen.getByRole('button', { name: /save spray/i });
    expect(save.hasAttribute('disabled')).toBe(false);
    await user.click(save);

    await waitFor(async () => expect(await storedCaptures(ITEMS_KEY)).toHaveLength(1));
    await waitFor(async () => expect(await storedCaptures(SPRAYS_KEY)).toHaveLength(1));
    expect((await storedCaptures<Record<string, unknown>>(SPRAYS_KEY))[0]).toMatchObject({
      farmId: FARM_ID,
      landUnitId: BLOCK_ID,
      productName: 'Tank Mix A',
      registrationNumber: 'MY-LABEL-7',
      activeIngredients: ['alpha', 'beta'],
      phiDays: 7,
      earliestHarvestDate: '2026-03-08',
    });
  }, 10_000);

  it('reuses a private farm product and keeps application details optional', async () => {
    seedProduct();
    const user = userEvent.setup();
    render(<App />);

    await user.selectOptions(await screen.findByLabelText(/^product$/i), PRODUCT_ID);
    const save = screen.getByRole('button', { name: /save spray/i });
    expect(save.hasAttribute('disabled')).toBe(false);
    await user.click(save);

    await waitFor(async () => expect(await storedCaptures(SPRAYS_KEY)).toHaveLength(1));
    expect((await storedCaptures<Record<string, unknown>>(SPRAYS_KEY))[0]).toMatchObject({
      productId: PRODUCT_ID,
      productName: 'My Orchard Mix',
      phiDays: 7,
    });
  });

  it('shows a planning overlap but never turns it into a save gate', async () => {
    window.localStorage.setItem(
      PLANTINGS_KEY,
      JSON.stringify([
        {
          id: '0190f3a0-0000-7000-8000-0000000000e1',
          farmId: FARM_ID,
          landUnitId: BLOCK_ID,
          occurredAt: '2026-01-01T04:00:00.000Z',
          crop: 'Grapes',
          expectedHarvestDate: '2026-03-05',
        },
      ]),
    );
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText(/product name/i), 'Tank Mix A');
    await user.type(screen.getByLabelText(/pre-harvest interval/i), '7');
    const day = screen.getByLabelText(/day sprayed/i) as HTMLInputElement;
    await user.clear(day);
    await user.type(day, '2026-03-01');

    expect(await screen.findByText(/planning reminder/i)).toBeTruthy();
    expect(screen.getByText(/you can still save your record/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /save spray/i }).hasAttribute('disabled')).toBe(
      false,
    );
    expect(screen.queryByRole('button', { name: /override/i })).toBeNull();
  });

  it('still requires real ground, because that is data integrity rather than compliance', async () => {
    window.localStorage.removeItem(LAND_KEY);
    render(<App />);
    expect(await screen.findByText(/no blocks yet/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /add a block/i })).toBeTruthy();
  });
});
