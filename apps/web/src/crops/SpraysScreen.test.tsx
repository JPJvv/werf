/** The spray screen reads the farmer's captured snapshots without needing a reference register. */

import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { schemas } from '@werf/core';
import { App } from '../App';

const FARM_ID = '0190f3a0-0000-7000-8000-0000000000f1';
const BLOCK_ID = '0190f3a0-0000-7000-8000-0000000000b1';
const SESSION_KEY = 'werf-session';
const LAND_KEY = `werf-land:${FARM_ID}`;
const SPRAYS_KEY = `werf-sprays:${FARM_ID}`;

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

beforeEach(() => {
  window.localStorage.clear();
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
  window.history.pushState({}, '', '/sprays');
});

afterEach(() => window.localStorage.clear());

describe('private spray history', () => {
  it('shows the capture-time product snapshot and optional application detail', async () => {
    window.localStorage.setItem(
      SPRAYS_KEY,
      JSON.stringify([
        {
          id: '0190f3a0-0000-7000-8000-00000000e001',
          farmId: FARM_ID,
          landUnitId: BLOCK_ID,
          occurredAt: '2026-10-05T05:00:00.000Z',
          sprayedOn: '2026-10-05',
          productId: '0190f3a0-0000-7000-8000-00000000d001',
          productName: 'My Orchard Mix',
          registrationNumber: 'MY-LABEL-7',
          activeIngredients: ['alpha'],
          phiDays: 7,
          earliestHarvestDate: '2026-10-12',
          rateLPerHa: 2.5,
          operator: 'Thabo Mokoena',
        },
      ]),
    );
    render(<App />);

    expect(await screen.findByText(/my orchard mix · my-label-7/i)).toBeTruthy();
    expect(screen.getByText('2026-10-12')).toBeTruthy();
    expect(screen.getByText(/alpha/i)).toBeTruthy();
    expect(screen.getByText(/thabo mokoena/i)).toBeTruthy();
    expect(screen.queryByText(/server confirmed|audit|override/i)).toBeNull();
  });

  it('honestly says no interval was entered without treating that as an error', async () => {
    window.localStorage.setItem(
      SPRAYS_KEY,
      JSON.stringify([
        {
          id: '0190f3a0-0000-7000-8000-00000000e002',
          farmId: FARM_ID,
          landUnitId: BLOCK_ID,
          occurredAt: '2026-10-05T05:00:00.000Z',
          sprayedOn: '2026-10-05',
          productId: '0190f3a0-0000-7000-8000-00000000d002',
          productName: 'Sulphur WP',
        },
      ]),
    );
    render(<App />);
    expect(await screen.findByText(/sulphur wp/i)).toBeTruthy();
    expect(screen.getByText(/no pre-harvest interval on record/i)).toBeTruthy();
  });
});
