/**
 * The read models a farmer actually looks at (FR-705, FR-017, FR-131, FR-213), through the real
 * `<App/>`. These are the numbers that decide whether the app is an instrument or a menu, so they
 * are tested the way they are seen — on screen, from seeded device data, with no network.
 *
 * The one worth arguing about is the Health tile carrying "N withholding" rather than the "N due"
 * the design sketch suggested. A due/overdue count needs a vaccination programme schedule that does
 * not exist yet; a tile carrying a number the app cannot compute is worse than a tile carrying
 * none, and "3 withholding" is both true today and the number that stops the wrong animal going
 * onto a truck.
 */

import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { uuidv7, type schemas } from '@werf/core';
import { App } from '../App';

const SESSION_KEY = 'werf-session';
const FARM_ID = '0190f3a0-0000-7000-8000-0000000000f1';
const HERD_KEY = `werf-herd:${FARM_ID}`;
const HEALTH_KEY = `werf-health:${FARM_ID}`;
const PRODUCTS_KEY = `werf-vet-products:${FARM_ID}`;
const RAINFALL_KEY = `werf-rainfall:${FARM_ID}`;
const LAND_KEY = `werf-land:${FARM_ID}`;
const MOBS_KEY = `werf-mobs:${FARM_ID}`;
const PRODUCT_ID = '0190f3a0-0000-7000-8000-00000000d001';

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

/** An animal born `ageDays` ago, or with no recorded birth date when that is null. */
function animal(id: string, sex: string, ageDays: number | null) {
  return {
    id,
    farmId: FARM_ID,
    enterpriseId: null,
    species: 'cattle',
    breed: null,
    sex,
    dob:
      ageDays === null
        ? null
        : new Date(Date.now() - ageDays * 86_400_000).toISOString().slice(0, 10),
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
  };
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, '', '/');
});

afterEach(() => {
  window.localStorage.clear();
});

describe('the herd by class (FR-705)', () => {
  it('shows the groups a farmer thinks in, not a flat head count', () => {
    cachedSession();
    window.localStorage.setItem(
      HERD_KEY,
      JSON.stringify([
        animal(uuidv7(), 'female', 900), // a cow
        animal(uuidv7(), 'female', 900), // a cow
        animal(uuidv7(), 'female', 300), // a weaner
        animal(uuidv7(), 'castrated', 900), // a steer
      ]),
    );
    window.history.pushState({}, '', '/animals');
    render(<App />);

    const breakdown = screen.getByRole('list', { name: /cattle by class/i });
    expect(within(breakdown).getByText('2')).toBeTruthy();
    expect(within(breakdown).getByText(/cows/i)).toBeTruthy();
    expect(within(breakdown).getByText(/weaners/i)).toBeTruthy();
    expect(within(breakdown).getByText(/steers/i)).toBeTruthy();
  });

  it('names the animals it cannot age instead of quietly counting them as cows', () => {
    // On an extensive farm a large part of the herd genuinely has no recorded birth date. Sorting
    // them into "cow" would invent the number the farmer opened the screen to check.
    cachedSession();
    window.localStorage.setItem(HERD_KEY, JSON.stringify([animal(uuidv7(), 'female', null)]));
    window.history.pushState({}, '', '/animals');
    render(<App />);

    expect(screen.getByText(/no age recorded/i)).toBeTruthy();
  });

  it('survives a stored animal from an older app version that has no dob field at all', () => {
    // An offline-first app has to expect rows composed by a client six weeks behind an update. A
    // read model that threw would take the whole screen down, offline, with no way out.
    cachedSession();
    const legacy = animal(uuidv7(), 'female', null) as Record<string, unknown>;
    delete legacy['dob'];
    window.localStorage.setItem(HERD_KEY, JSON.stringify([legacy]));
    window.history.pushState({}, '', '/animals');
    render(<App />);

    expect(screen.getByRole('heading', { name: /animals/i })).toBeTruthy();
    expect(screen.getByText(/no age recorded/i)).toBeTruthy();
  });
});

describe('the home grid as an instrument (FR-017)', () => {
  it('badges the Health tile with the animals that may not be sold yet', () => {
    cachedSession();
    const id = uuidv7();
    window.localStorage.setItem(HERD_KEY, JSON.stringify([animal(id, 'female', 900)]));
    window.localStorage.setItem(
      PRODUCTS_KEY,
      JSON.stringify([
        {
          id: PRODUCT_ID,
          name: 'Terramycin LA',
          registrationNumber: null,
          species: ['cattle'],
          meatWithdrawalDays: 28,
          milkWithdrawalHours: null,
          route: null,
        },
      ]),
    );
    window.localStorage.setItem(
      HEALTH_KEY,
      JSON.stringify([
        {
          id: uuidv7(),
          farmId: FARM_ID,
          animalId: id,
          kind: 'treatment',
          occurredAt: new Date().toISOString(),
          administeredOn: new Date().toISOString().slice(0, 10),
          productId: PRODUCT_ID,
          batchId: null,
        },
      ]),
    );
    render(<App />);

    // A dot AND a number AND a word — never colour alone (NFR-411). Read off the tile itself,
    // because the animals tile is also carrying a 1 (one head), and asserting a bare "1" on the
    // page would pass whichever tile it came from.
    const healthTile = screen.getByRole('link', { name: /health/i });
    expect(within(healthTile).getByText(/withholding/i)).toBeTruthy();
    expect(within(healthTile).getByText('1')).toBeTruthy();
  });

  it('shows the season rainfall on the home screen, so it is not a screen away', () => {
    cachedSession();
    // Readings in the CURRENT season, whichever side of 1 January today falls.
    const now = new Date();
    const seasonYear = now.getMonth() + 1 >= 7 ? now.getFullYear() : now.getFullYear() - 1;
    window.localStorage.setItem(
      RAINFALL_KEY,
      JSON.stringify([
        {
          id: uuidv7(),
          farmId: FARM_ID,
          mm: 18,
          occurredAt: `${seasonYear}-08-02T04:00:00.000Z`,
        },
        {
          id: uuidv7(),
          farmId: FARM_ID,
          mm: 24,
          occurredAt: `${seasonYear}-09-11T04:00:00.000Z`,
        },
        // LAST season. Splitting the year at 1 January would cut a summer-rainfall season in half
        // exactly where the comparison matters, so the boundary is July — and this must not count.
        {
          id: uuidv7(),
          farmId: FARM_ID,
          mm: 99,
          occurredAt: `${seasonYear - 1}-03-11T04:00:00.000Z`,
        },
      ]),
    );
    render(<App />);

    expect(screen.getByText('42')).toBeTruthy();
    expect(screen.getByText(/this season/i)).toBeTruthy();
  });
});

describe('head per camp (FR-705)', () => {
  it('shows what is standing in each camp, counting groups as well as animals', () => {
    // `summariseHerd` has computed `byLandUnit` and been unit-tested since the read-model slice,
    // and nothing rendered it. A number the app knows and does not show is the same as a number it
    // does not have — and "how many are in that camp" is the question asked standing at a gate.
    cachedSession();
    const noord = uuidv7();
    const suid = uuidv7();
    window.localStorage.setItem(
      LAND_KEY,
      JSON.stringify([
        { id: noord, farmId: FARM_ID, code: 'NOORD', name: null, hectares: null, kind: 'camp' },
        { id: suid, farmId: FARM_ID, code: 'SUID', name: null, hectares: null, kind: 'camp' },
      ]),
    );
    window.localStorage.setItem(
      HERD_KEY,
      JSON.stringify([
        { ...animal(uuidv7(), 'female', 900), landUnitId: noord },
        { ...animal(uuidv7(), 'female', 900), landUnitId: noord },
      ]),
    );
    // A flock recorded as a GROUP, with no animal rows at all (FR-102). Counting only individual
    // animals would show an empty camp with 300 sheep standing in it.
    window.localStorage.setItem(
      MOBS_KEY,
      JSON.stringify([
        {
          id: uuidv7(),
          farmId: FARM_ID,
          enterpriseId: null,
          species: 'sheep',
          name: 'Ooie',
          headCount: 300,
          landUnitId: suid,
        },
      ]),
    );
    window.history.pushState({}, '', '/land');
    render(<App />);

    const camps = screen.getAllByRole('listitem');
    expect(within(camps[0]!).getByText('2')).toBeTruthy();
    expect(within(camps[1]!).getByText('300')).toBeTruthy();
  });

  it('says zero for empty ground rather than leaving it blank', () => {
    // A blank would read as "not known" on the one screen where empty ground is the whole point.
    cachedSession();
    window.localStorage.setItem(
      LAND_KEY,
      JSON.stringify([
        {
          id: uuidv7(),
          farmId: FARM_ID,
          code: 'RUS',
          name: null,
          hectares: null,
          kind: 'camp',
        },
      ]),
    );
    window.history.pushState({}, '', '/land');
    render(<App />);

    expect(within(screen.getAllByRole('listitem')[0]!).getByText('0')).toBeTruthy();
  });
});
