/**
 * FR-207's auditor-facing harvest history report — filters and the empty state, the report-screen
 * coverage `SpraysScreen.test.tsx`'s own header names as the exact gap a MED shipped unnoticed
 * through (STATUS.md, 21st session): do not ship this screen with zero dedicated tests either.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { schemas } from '@werf/core';
import { App } from '../App';

const SESSION_KEY = 'werf-session';
const FARM_ID = '0190f3a0-0000-7000-8000-0000000000f1';
const BLOCK_A = '0190f3a0-0000-7000-8000-0000000000b1';
const BLOCK_B = '0190f3a0-0000-7000-8000-0000000000b2';
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

function cachedBlocks(): void {
  window.localStorage.setItem(
    LAND_KEY,
    JSON.stringify([
      {
        id: BLOCK_A,
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
      {
        id: BLOCK_B,
        farmId: FARM_ID,
        kind: 'block',
        code: 'B13',
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

function cachedHarvests(): void {
  window.localStorage.setItem(
    HARVESTS_KEY,
    JSON.stringify([
      {
        id: '0190f3a0-0000-7000-8000-00000000e001',
        farmId: FARM_ID,
        landUnitId: BLOCK_A,
        occurredAt: '2026-09-01T04:00:00.000Z',
        harvestedOn: '2026-09-01',
        quantity: 5,
        unit: 'ton',
      },
      {
        id: '0190f3a0-0000-7000-8000-00000000e002',
        farmId: FARM_ID,
        landUnitId: BLOCK_B,
        occurredAt: '2026-11-01T04:00:00.000Z',
        harvestedOn: '2026-11-01',
        quantity: 20,
        unit: 'ton',
      },
    ]),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, '', '/');
  cachedSession();
  cachedBlocks();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('harvest history report (FR-207)', () => {
  it('says nothing has been recorded yet, when the farm has no harvests', async () => {
    window.history.pushState({}, '', '/harvest');
    render(<App />);

    expect(await screen.findByText(/no harvests recorded yet/i)).toBeTruthy();
  });

  it('lists every harvest, newest first by default', async () => {
    cachedHarvests();
    window.history.pushState({}, '', '/harvest');
    render(<App />);

    const rows = await screen.findAllByText(/2026-\d\d-\d\d/);
    expect(rows[0]!.textContent).toContain('2026-11-01');
    expect(rows[1]!.textContent).toContain('2026-09-01');
  });

  it('narrows to one block', async () => {
    cachedHarvests();
    const user = userEvent.setup();
    window.history.pushState({}, '', '/harvest');
    render(<App />);
    await screen.findByText('2026-11-01');

    await user.selectOptions(screen.getByLabelText(/filter by block/i), BLOCK_A);

    expect(screen.getByText('2026-09-01')).toBeTruthy();
    expect(screen.queryByText('2026-11-01')).toBeNull();
  });

  it('narrows to a date range on the harvest day', async () => {
    cachedHarvests();
    const user = userEvent.setup();
    window.history.pushState({}, '', '/harvest');
    render(<App />);
    await screen.findByText('2026-11-01');

    await user.type(screen.getByLabelText('From'), '2026-10-15');
    await user.type(screen.getByLabelText('To'), '2026-11-15');

    expect(screen.getByText('2026-11-01')).toBeTruthy();
    expect(screen.queryByText('2026-09-01')).toBeNull();
  });

  it('is the home grid harvest tile’s destination, and links on to the capture screen', async () => {
    window.history.pushState({}, '', '/harvest');
    render(<App />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole('link', { name: /record a harvest/i }));

    expect(await screen.findByLabelText(/quantity/i)).toBeTruthy();
  });
});
