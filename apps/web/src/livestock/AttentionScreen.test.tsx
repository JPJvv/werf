/**
 * The residue register's DEVICE half (FR-131, COMPLIANCE-GATED) — `useLocalResidueFlags` in
 * `residue.ts`, read through `AttentionScreen`. Renders the real `<App/>` against a seeded
 * `localStorage`, the same boot path a cold start uses, so the fix under test is the one an actual
 * screen shows rather than a unit test of the pure fold in isolation.
 */

import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { schemas } from '@werf/core';
import { App } from '../App';
import { getCurrentFakeLocalDatabase } from '../test-support/local-db';

const SESSION_KEY = 'werf-session';
const FARM_ID = '0190f3a0-0000-7000-8000-0000000000f1';
const MOB_ID = '0190f3a0-0000-7000-8000-00000000b001';

const FLOCK = { id: '0190f3a0-0000-7000-8000-00000000e002', name: 'Dorper flock', type: 'sheep' };

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
        enterpriseTypes: ['sheep'],
        role: 'owner',
        enterprises: [FLOCK],
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

function seedFlock(): void {
  window.localStorage.setItem(
    `werf-mobs:${FARM_ID}`,
    JSON.stringify([
      {
        id: MOB_ID,
        farmId: FARM_ID,
        name: 'Flock A',
        species: 'sheep',
        landUnitId: null,
        enterpriseId: FLOCK.id,
        headCount: 300,
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
});

describe('the register (FR-131) sees a withholding known only by HYDRATION', () => {
  it('⭐ flags a slaughter whose withholding arrived via a transfer this device never captured', async () => {
    // sync-auditor Finding 1 (2026-08-10), third instance. Display-only — LOW/MED rather than the
    // capture-time guard's SEV-2, but the same root cause: `useLocalResidueFlags` read raw local
    // `tallies`, blind to a withholding this device only knows about via down-sync. Without the fix
    // the register said "nothing needs your attention" for a slaughter the server (and, since the
    // sibling fix, this device's own capture screen) would refuse.
    const TRANSFER_ID = '0190f3a0-0000-7000-8000-00000000c003';
    const SLAUGHTER_ID = '0190f3a0-0000-7000-8000-00000000c004';
    const SOURCE = '0190f3a0-0000-7000-8000-00000000c005';
    cachedSession();
    seedFlock();
    window.localStorage.setItem(
      `werf-tallies:${FARM_ID}`,
      JSON.stringify([
        {
          id: SLAUGHTER_ID,
          farmId: FARM_ID,
          mobId: MOB_ID,
          occurredAt: '2026-07-23T12:00:00.000Z',
          reason: 'slaughter',
          count: 10,
          delta: -10,
        },
      ]),
    );

    const fake = await getCurrentFakeLocalDatabase();
    fake.hydrateRow('events', {
      id: TRANSFER_ID,
      farm_id: FARM_ID,
      mob_id: MOB_ID,
      type: 'tally',
      occurred_at: '2026-07-20T12:00:00.000Z',
      payload: JSON.stringify({
        reason: 'transfer_in',
        delta: 40,
        counterpartMobId: SOURCE,
        carriedWithholdUntil: '2026-08-17',
      }),
    });

    window.history.pushState({}, '', '/attention');
    render(<App />);

    expect(await screen.findByText(/must not go into the food chain/i)).toBeTruthy();
    expect(screen.queryByText(/nothing needs your attention/i)).toBeNull();
  });
});
