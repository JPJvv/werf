/**
 * The residue register's DEVICE half (FR-131, COMPLIANCE-GATED) — `useLocalResidueFlags` in
 * `residue.ts`, read through `AttentionScreen`. Renders the real `<App/>` against a seeded
 * `localStorage`, the same boot path a cold start uses, so the fix under test is the one an actual
 * screen shows rather than a unit test of the pure fold in isolation.
 */

import { render, screen, within } from '@testing-library/react';
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

    expect(await screen.findByText(/falls before the reminder date you entered/i)).toBeTruthy();
    expect(screen.queryByText(/nothing needs your attention/i)).toBeNull();
  });

  it('⭐ flags a LOCAL sale whose animal AND dose are known only via hydration (phase-checklists.md 3e)', async () => {
    // The individual-animal counterpart of the test above, and the sibling fix in the SAME slice —
    // `useLocalResidueFlags` merged `evidenceTallies` (mobs/tallies) with hydrated data in the prior
    // session; `animals`/`health`/`moves` — the evidence the INDIVIDUAL disposal path reads — stayed
    // local-only until this one. The sale event itself is local (this device's own capture), but
    // `byId.get(event.animalId)` and the dose it is judged against both come from down-sync only.
    const ANIMAL_ID = '0190f3a0-0000-7000-8000-00000000a010';
    const SALE_ID = '0190f3a0-0000-7000-8000-00000000c010';
    const DOSE_ID = '0190f3a0-0000-7000-8000-00000000c011';
    cachedSession();
    window.localStorage.setItem(
      `werf-events:${FARM_ID}`,
      JSON.stringify([
        {
          id: SALE_ID,
          farmId: FARM_ID,
          animalId: ANIMAL_ID,
          type: 'sale',
          status: 'sold',
          occurredAt: '2026-07-23T12:00:00.000Z',
          counterparty: 'Vleissentraal',
          priceCents: 500000,
        },
      ]),
    );

    const fake = await getCurrentFakeLocalDatabase();
    fake.hydrateRow('animals', {
      id: ANIMAL_ID,
      farm_id: FARM_ID,
      species: 'sheep',
      sex: 'female',
      breed: null,
      status: 'alive',
      dob: null,
      dob_estimated: 0,
      status_at: null,
      dam_id: null,
      sire_id: null,
      mob_id: null,
      land_unit_id: null,
      source: null,
      acquired_at: null,
      brand_id: null,
      brand_applied_at: null,
      attributes: '{}',
      photo_key: null,
      enterprise_id: null,
    });
    fake.hydrateRow('events', {
      id: DOSE_ID,
      farm_id: FARM_ID,
      animal_id: ANIMAL_ID,
      mob_id: null,
      type: 'treatment',
      occurred_at: '2026-07-20T06:00:00.000Z',
      payload: JSON.stringify({
        product: 'Terramycin LA',
        administeredOn: '2026-07-20',
        meatWithholdUntil: '2026-08-17',
      }),
    });

    window.history.pushState({}, '', '/attention');
    render(<App />);

    expect(await screen.findByText(/falls before the reminder date you entered/i)).toBeTruthy();
    expect(screen.queryByText(/nothing needs your attention/i)).toBeNull();
  });
});

describe('the private interval reminder list', () => {
  it('⭐ renders the section, the product/spray-date/earliest-date line, and folds it into the home badge', async () => {
    // `phiRegister.test.ts` already covers `localPhiFlags` as a pure fold — this is the rendering
    // gap `SpraysScreen.tsx` shipped a MED for having none of (STATUS.md, 21st session): nothing had
    // ever mounted `AttentionScreen` with a PHI flag present, so a broken `t()` key or a dropped
    // `<section>` here would pass every existing test.
    const BLOCK_ID = '0190f3a0-0000-7000-8000-00000000c020';
    const PRODUCT_ID = '0190f3a0-0000-7000-8000-00000000d020';
    const SPRAY_ID = '0190f3a0-0000-7000-8000-00000000e030';
    const HARVEST_ID = '0190f3a0-0000-7000-8000-00000000e031';
    cachedSession();
    window.localStorage.setItem(
      `werf-land:${FARM_ID}`,
      JSON.stringify([
        { id: BLOCK_ID, farmId: FARM_ID, code: 'B7', name: null, hectares: 6, kind: 'block' },
      ]),
    );
    window.localStorage.setItem(
      `werf-inventory-items:${FARM_ID}`,
      JSON.stringify([
        {
          id: PRODUCT_ID,
          farmId: FARM_ID,
          enterpriseId: null,
          category: 'chemical',
          name: 'Roundup PowerMax',
          unit: 'L',
          registrationNumber: 'L1234 Act 36/1947',
          activeIngredients: null,
          phiDays: 21,
          reentryHours: 24,
        },
      ]),
    );
    window.localStorage.setItem(
      `werf-sprays:${FARM_ID}`,
      JSON.stringify([
        {
          id: SPRAY_ID,
          farmId: FARM_ID,
          landUnitId: BLOCK_ID,
          occurredAt: '2026-08-01T08:00:00.000Z',
          sprayedOn: '2026-08-01',
          productId: PRODUCT_ID,
          productName: 'Roundup PowerMax',
          phiDays: 21,
          earliestHarvestDate: '2026-08-22',
        },
      ]),
    );
    // Harvested inside the 21-day PHI (earliest safe date is 2026-08-22), no `phiOverride` — the
    // one shape `localPhiFlags` flags.
    window.localStorage.setItem(
      `werf-harvests:${FARM_ID}`,
      JSON.stringify([
        {
          id: HARVEST_ID,
          farmId: FARM_ID,
          landUnitId: BLOCK_ID,
          occurredAt: '2026-08-05T08:00:00.000Z',
          harvestedOn: '2026-08-05',
          quantity: 3,
          unit: 'ton',
        },
      ]),
    );

    window.history.pushState({}, '', '/');
    render(<App />);

    // The home badge folds the PHI flag in alongside the residue register and conflict queue.
    const attentionLink = await screen.findByRole('link', { name: /needs your attention/i });
    expect(within(attentionLink.closest('p')!).getByText('1')).toBeTruthy();

    window.history.pushState({}, '', '/attention');
    render(<App />);

    expect(await screen.findByText(/roundup powermax/i)).toBeTruthy();
    expect(screen.getByText(/2026-08-01/)).toBeTruthy();
    expect(screen.getByText(/2026-08-22/)).toBeTruthy();
    expect(screen.getByText(/not sent yet/i)).toBeTruthy();
  });
});

describe('the conflict review queue (US-040)', () => {
  it('shows a cached sale/death contradiction without removing either source fact', async () => {
    cachedSession();
    const REVIEW_ID = '0190f3a0-0000-7000-8000-00000000d001';
    const ANIMAL_ID = '0190f3a0-0000-7000-8000-00000000a020';
    window.localStorage.setItem(
      `werf-conflict-reviews:${FARM_ID}`,
      JSON.stringify([
        {
          id: REVIEW_ID,
          farmId: FARM_ID,
          kind: 'status_contradiction',
          subjectId: ANIMAL_ID,
          field: 'status',
          factAEventId: '0190f3a0-0000-7000-8000-00000000e020',
          factBEventId: '0190f3a0-0000-7000-8000-00000000e021',
          winnerEventId: '0190f3a0-0000-7000-8000-00000000e020',
          rule: 'dead wins',
          createdAt: '2026-08-10T15:00:00.000Z',
        },
      ] satisfies schemas.ConflictReviewJson[]),
    );

    window.history.pushState({}, '', '/attention');
    render(<App />);

    expect(await screen.findByText(/both sold and dead/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /mark as reviewed/i })).toBeTruthy();
    expect(screen.queryByText(/nothing needs your attention/i)).toBeNull();
  });
});
