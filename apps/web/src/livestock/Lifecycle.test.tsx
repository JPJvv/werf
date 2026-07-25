/**
 * The rest of the lifecycle, as a farmer does it (FR-104, FR-111, FR-106 purchase, FR-605 missing).
 * Renders the real `<App/>` against a seeded `localStorage`, so every capture is read back through
 * the same boot path a cold start uses.
 *
 * The cases that carry the design:
 *  • A BIRTH produces two records from one action — the calf as a herd row, and the calving filed
 *    against the DAM — and the calf inherits its mother's herd, species and position.
 *  • A MISSING report will not save without a GPS fix, and names the reason when the fix fails.
 *    That is FR-605's "GPS-anchored" being a promise rather than a hope.
 *  • A PURCHASE is the same herd row plus a money event, not a different kind of animal.
 *  • A WEANING derives the age rather than asking a farmer in a race to work out that a calf is
 *    207 days old.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uuidv7, type schemas } from '@werf/core';
import { App } from '../App';

const SESSION_KEY = 'werf-session';
const FARM_ID = '0190f3a0-0000-7000-8000-0000000000f1';
const HERD_KEY = `werf-herd:${FARM_ID}`;
const EVENTS_KEY = `werf-events:${FARM_ID}`;
const HERD = {
  id: '0190f3a0-0000-7000-8000-00000000e001',
  name: 'Bonsmara cows',
  type: 'beef_cattle',
};

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
        enterprises: [HERD],
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

interface AnimalOverrides {
  readonly sex?: string;
  readonly damId?: string | null;
  readonly dob?: string | null;
}

function animal(id: string, over: AnimalOverrides = {}) {
  return {
    id,
    farmId: FARM_ID,
    enterpriseId: HERD.id,
    species: 'cattle',
    breed: 'Bonsmara',
    sex: over.sex ?? 'female',
    dob: over.dob ?? null,
    dobEstimated: false,
    status: 'alive',
    statusAt: null,
    damId: over.damId ?? null,
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

function seedHerd(...animals: ReturnType<typeof animal>[]): void {
  window.localStorage.setItem(HERD_KEY, JSON.stringify(animals));
}

function storedAnimals(): Array<Record<string, unknown>> {
  return JSON.parse(window.localStorage.getItem(HERD_KEY) ?? '[]') as Array<
    Record<string, unknown>
  >;
}

function storedEvents(): Array<Record<string, unknown>> {
  return JSON.parse(window.localStorage.getItem(EVENTS_KEY) ?? '[]') as Array<
    Record<string, unknown>
  >;
}

/** A phone that gives a fix, or refuses to. */
function stubGeolocation(result: 'ok' | 'denied'): void {
  const getCurrentPosition = vi.fn(
    (success: PositionCallback, failure?: PositionErrorCallback | null) => {
      if (result === 'ok') {
        success({
          coords: { longitude: 26.21, latitude: -29.12 },
        } as unknown as GeolocationPosition);
      } else {
        failure?.({ code: 1, PERMISSION_DENIED: 1 } as unknown as GeolocationPositionError);
      }
    },
  );
  Object.defineProperty(window.navigator, 'geolocation', {
    value: { getCurrentPosition },
    configurable: true,
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, '', '/');
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('recording a birth (FR-104)', () => {
  it('creates the calf AND the calving, and the calf inherits its mother’s herd', async () => {
    cachedSession();
    const damId = uuidv7();
    seedHerd(animal(damId));
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/birth');
    render(<App />);

    await user.selectOptions(screen.getByLabelText(/which cow calved/i), damId);
    await user.click(screen.getByRole('button', { name: /how hard was it\? 3/i }));
    await user.type(screen.getByLabelText(/birth weight/i), '34');
    await user.click(screen.getByRole('button', { name: /record the birth/i }));

    // Two records, one action.
    const animals = storedAnimals();
    expect(animals).toHaveLength(2);
    const calf = animals.find((a) => a['damId'] === damId);
    expect(calf).toMatchObject({
      species: 'cattle',
      damId,
      enterpriseId: HERD.id,
      // Born here today: the one case where a date of birth is known exactly, not estimated.
      dobEstimated: false,
    });
    expect(calf!['dob']).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // The calving is filed against the DAM, not the calf — her timeline is where it belongs.
    const [birth] = storedEvents();
    expect(birth).toMatchObject({
      type: 'birth',
      animalId: damId,
      calfId: calf!['id'],
      easeScore: 3,
      multiples: 1,
      birthWeightKg: 34,
      // A birth moves no status: the dam was alive and stays alive.
      status: null,
    });
  });

  it('says so plainly when there is nothing that could have calved', () => {
    cachedSession();
    seedHerd(animal(uuidv7(), { sex: 'male' }));
    window.history.pushState({}, '', '/animals/birth');
    render(<App />);

    expect(screen.getByText(/no females in the herd/i)).toBeTruthy();
  });
});

describe('reporting an animal missing (FR-605)', () => {
  it('anchors the report to a GPS point and the day it was last seen', async () => {
    cachedSession();
    const id = uuidv7();
    seedHerd(animal(id));
    stubGeolocation('ok');
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/loss');
    render(<App />);

    await user.click(screen.getAllByRole('button', { name: /cattle/i })[0]!);
    await user.click(screen.getByRole('button', { name: /^missing$/i }));
    await user.click(screen.getByRole('button', { name: /report it missing/i }));

    const [report] = storedEvents();
    expect(report).toMatchObject({ type: 'missing', status: 'missing', animalId: id });
    // GeoJSON is [longitude, latitude] — the opposite of how it is said out loud. Getting this
    // backwards would put a Free State camp in Somalia.
    expect(JSON.parse(String(report!['lastSeenGeojson']))).toMatchObject({
      type: 'Point',
      coordinates: [26.21, -29.12],
    });

    // And it is out of the live herd.
    window.history.pushState({}, '', '/animals');
    render(<App />);
    expect(screen.getAllByText(/missing/i).length).toBeGreaterThan(0);
  });

  it('refuses to save without a fix, and says what to do about it', async () => {
    cachedSession();
    seedHerd(animal(uuidv7()));
    stubGeolocation('denied');
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/loss');
    render(<App />);

    await user.click(screen.getAllByRole('button', { name: /cattle/i })[0]!);
    await user.click(screen.getByRole('button', { name: /^missing$/i }));
    await user.click(screen.getByRole('button', { name: /report it missing/i }));

    // A record with no point is of little use to the Stock Theft Unit, so it is not written —
    // and the message is about the PERMISSION, not about being offline.
    expect(storedEvents()).toHaveLength(0);
    expect(screen.getByText(/not allowing the app to use its location/i)).toBeTruthy();
  });
});

describe('buying an animal (FR-106)', () => {
  it('is the same herd row plus a money event, not a different kind of animal', async () => {
    cachedSession();
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/new');
    render(<App />);

    await user.click(screen.getByRole('button', { name: /i bought this animal/i }));
    await user.type(screen.getByLabelText(/bought from/i), 'Bloem Vleismark');
    await user.type(screen.getByLabelText(/price paid/i), '18450');
    await user.click(screen.getByRole('button', { name: /save animal/i }));

    const [bought] = storedAnimals();
    // Where it came from lives on the ANIMAL too: an evidence pack reads source/acquired_at
    // rather than trawling the event log (FR-603).
    expect(bought).toMatchObject({ source: 'Bloem Vleismark' });
    expect(bought!['acquiredAt']).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const [purchase] = storedEvents();
    expect(purchase).toMatchObject({
      type: 'purchase',
      counterparty: 'Bloem Vleismark',
      // Money is integer cents at the boundary, never a float.
      priceCents: 1_845_000,
      // A purchase moves no status: it arrived alive and stays alive.
      status: null,
    });
  });

  it('will not save a purchase with no seller or no price', async () => {
    cachedSession();
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/new');
    render(<App />);

    await user.click(screen.getByRole('button', { name: /i bought this animal/i }));
    expect(screen.getByRole('button', { name: /save animal/i }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(storedAnimals()).toHaveLength(0);
  });
});

describe('the weaning session (FR-111)', () => {
  it('works down the calves and derives the age from the date of birth', async () => {
    cachedSession();
    const damId = uuidv7();
    const calfId = uuidv7();
    // Born a known number of days ago, so the derived age is a fact rather than a guess.
    const born = new Date(Date.now() - 205 * 86_400_000).toISOString().slice(0, 10);
    seedHerd(animal(damId), animal(calfId, { damId, dob: born }));
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/wean');
    render(<App />);

    // Only the calf is in the queue: its mother has no dam on file, so she was never a calf here.
    expect(screen.getByText(/1 of 1/i)).toBeTruthy();

    await user.type(screen.getByLabelText(/weaning weight/i), '210');
    await user.click(screen.getByRole('button', { name: /save & next/i }));

    const [weaning] = storedEvents();
    expect(weaning).toMatchObject({
      type: 'weaning',
      animalId: calfId,
      weightKg: 210,
      ageDays: 205,
      status: null,
    });
  });

  it('omits the age entirely when the date of birth is unknown', async () => {
    // A guessed age is worse than no age in a growth comparison, so it is left out rather than
    // filled in with something plausible.
    cachedSession();
    const damId = uuidv7();
    seedHerd(animal(damId), animal(uuidv7(), { damId }));
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/wean');
    render(<App />);

    await user.type(screen.getByLabelText(/weaning weight/i), '198');
    await user.click(screen.getByRole('button', { name: /save & next/i }));

    expect(storedEvents()[0]).not.toHaveProperty('ageDays');
  });
});
