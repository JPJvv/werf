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
/**
 * ⭐ Dates here go through `farmDay`/`farmToday`, never `toISOString().slice(0, 10)`. The code under
 * test computes in the FARM's zone; a UTC slice names yesterday between 00:00 and 02:00 SAST, so an
 * assertion written that way reds for two hours out of every twenty-four and passes for the other
 * twenty-two. That is not a flake — it is a test asserting a different day from the one the product
 * is right about.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uuidv7, type schemas } from '@werf/core';
import { App } from '../App';
import { farmDay } from '../farmTime';
import { storedCaptures } from '../test-support/local-db';

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

function storedAnimals(): Promise<readonly Record<string, unknown>[]> {
  return storedCaptures<Record<string, unknown>>(HERD_KEY);
}

function storedEvents(): Promise<readonly Record<string, unknown>[]> {
  return storedCaptures<Record<string, unknown>>(EVENTS_KEY);
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

    await user.selectOptions(await screen.findByLabelText(/which cow calved/i), damId);
    await user.click(screen.getByRole('button', { name: /how hard was it\? 3/i }));
    await user.type(screen.getByLabelText(/birth weight/i), '34');
    await user.click(screen.getByRole('button', { name: /record the birth/i }));

    // Two records, one action.
    await waitFor(async () => {
      expect(await storedAnimals()).toHaveLength(2);
    });
    const animals = await storedAnimals();
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
    const [birth] = await storedEvents();
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

  it('records TWO lambs for a twin birth, each with its own sex and weight', async () => {
    // Sheep twin routinely. This screen once minted exactly one calf however many were born while
    // storing `multiples: 2` on the event — so a lambing season left the flock short by one per
    // twin birth, and the two facts contradicted each other inside the same action.
    cachedSession();
    const ewe = uuidv7();
    seedHerd(animal(ewe));
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/birth');
    render(<App />);

    await user.selectOptions(await screen.findByLabelText(/which cow calved/i), ewe);
    await user.selectOptions(screen.getByLabelText(/how many born/i), '2');
    await user.click(screen.getByRole('button', { name: /how hard was it\? 2/i }));

    // Twins differ in both, and a screen that asked once and applied the answer twice would be
    // inventing data rather than capturing it.
    const sexes = screen.getAllByLabelText(/the calf is/i);
    const weights = screen.getAllByLabelText(/birth weight/i);
    expect(sexes).toHaveLength(2);
    await user.selectOptions(sexes[0]!, 'female');
    await user.type(weights[0]!, '4.1');
    await user.selectOptions(sexes[1]!, 'male');
    await user.type(weights[1]!, '3.8');
    await user.click(screen.getByRole('button', { name: /record the birth/i }));

    // The ewe plus two lambs — the head count a farmer would get walking the camp.
    await waitFor(async () => {
      expect((await storedAnimals()).filter((a) => a['damId'] === ewe)).toHaveLength(2);
    });
    const lambs = (await storedAnimals()).filter((a) => a['damId'] === ewe);
    expect(lambs.map((l) => l['sex']).sort()).toEqual(['female', 'male']);

    // One event per lamb, each naming its own lamb and each recording that it was one of two —
    // so the herd rows and the events agree about how many were born.
    const births = (await storedEvents()).filter((e) => e['type'] === 'birth');
    expect(births).toHaveLength(2);
    expect(births.every((b) => b['animalId'] === ewe && b['multiples'] === 2)).toBe(true);
    expect(births.map((b) => b['calfId']).sort()).toEqual(lambs.map((l) => l['id']).sort());
    expect(births.map((b) => b['birthWeightKg']).sort()).toEqual([3.8, 4.1]);
  });

  it('keeps what was already typed when the count changes', async () => {
    // A farmer fills in the first lamb and then realises there were two. Losing the first one's
    // details at that moment is how a capture screen teaches someone to distrust it.
    cachedSession();
    const ewe = uuidv7();
    seedHerd(animal(ewe));
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/birth');
    render(<App />);

    await user.selectOptions(await screen.findByLabelText(/which cow calved/i), ewe);
    await user.type(screen.getByLabelText(/birth weight/i), '4.1');
    await user.selectOptions(screen.getByLabelText(/how many born/i), '2');

    expect(screen.getAllByLabelText(/birth weight/i)[0]!).toHaveProperty('value', '4.1');
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

    // findAllByRole: the loss screen's live-herd list is only populated once its capture stores
    // finish hydrating (phase-checklists.md 3c).
    await user.click((await screen.findAllByRole('button', { name: /cattle/i }))[0]!);
    await user.click(screen.getByRole('button', { name: /^missing$/i }));
    await user.click(screen.getByRole('button', { name: /report it missing/i }));

    await waitFor(async () => {
      expect(await storedEvents()).toHaveLength(1);
    });
    const [report] = await storedEvents();
    expect(report).toMatchObject({ type: 'missing', status: 'missing', animalId: id });
    // GeoJSON is [longitude, latitude] — the opposite of how it is said out loud. Getting this
    // backwards would put a Free State camp in Somalia.
    expect(JSON.parse(String(report!['lastSeenGeojson']))).toMatchObject({
      type: 'Point',
      coordinates: [26.21, -29.12],
    });

    // And it is out of the live herd. findAllByText: a fresh render's stores hydrate
    // asynchronously (phase-checklists.md 3c), even against the same in-memory data.
    window.history.pushState({}, '', '/animals');
    render(<App />);
    expect((await screen.findAllByText(/missing/i)).length).toBeGreaterThan(0);
  });

  it('refuses to save without a fix, and says what to do about it', async () => {
    cachedSession();
    seedHerd(animal(uuidv7()));
    stubGeolocation('denied');
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/loss');
    render(<App />);

    // findAllByRole: the loss screen's live-herd list is only populated once its capture stores
    // finish hydrating (phase-checklists.md 3c).
    await user.click((await screen.findAllByRole('button', { name: /cattle/i }))[0]!);
    await user.click(screen.getByRole('button', { name: /^missing$/i }));
    await user.click(screen.getByRole('button', { name: /report it missing/i }));

    // A record with no point is of little use to the Stock Theft Unit, so it is not written —
    // and the message is about the PERMISSION, not about being offline.
    expect(await storedEvents()).toHaveLength(0);
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
    await user.clear(screen.getByLabelText(/bought on/i));
    await user.type(screen.getByLabelText(/bought on/i), '2026-06-12');
    await user.type(screen.getByLabelText(/price paid/i), '18450');
    await user.click(screen.getByRole('button', { name: /save animal/i }));

    await waitFor(async () => {
      expect(await storedAnimals()).toHaveLength(1);
    });
    const [bought] = await storedAnimals();
    // Where it came from lives on the ANIMAL too: an evidence pack reads source/acquired_at
    // rather than trawling the event log (FR-603).
    expect(bought).toMatchObject({ source: 'Bloem Vleismark' });
    expect(bought!['acquiredAt']).toBe('2026-06-12');

    const [purchase] = await storedEvents();
    expect(purchase).toMatchObject({
      type: 'purchase',
      counterparty: 'Bloem Vleismark',
      // Money is integer cents at the boundary, never a float.
      priceCents: 1_845_000,
      occurredAt: '2026-06-12T12:00:00.000Z',
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
    expect(await storedAnimals()).toHaveLength(0);
  });
});

describe('the weaning session (FR-111)', () => {
  it('works down the calves and derives the age from the date of birth', async () => {
    cachedSession();
    const damId = uuidv7();
    const calfId = uuidv7();
    // Born a known number of days ago, so the derived age is a fact rather than a guess.
    const born = farmDay(new Date(Date.now() - 205 * 86_400_000));
    seedHerd(animal(damId), animal(calfId, { damId, dob: born }));
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/wean');
    render(<App />);

    // Only the calf is in the queue: its mother has no dam on file, so she was never a calf here.
    // findByText: the session's queue is fixed only once its stores finish hydrating
    // (phase-checklists.md 3c), so the screen shows a brief "Reading the herd…" state first.
    expect(await screen.findByText(/1 of 1/i)).toBeTruthy();

    await user.type(screen.getByLabelText(/weaning weight/i), '210');
    await user.click(screen.getByRole('button', { name: /save & next/i }));

    await waitFor(async () => {
      expect(await storedEvents()).toHaveLength(1);
    });
    const [weaning] = await storedEvents();
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

    // findByLabelText: the session's queue is fixed only once its stores finish hydrating
    // (phase-checklists.md 3c), so the screen shows a brief "Reading the herd…" state first.
    await user.type(await screen.findByLabelText(/weaning weight/i), '198');
    await user.click(screen.getByRole('button', { name: /save & next/i }));

    await waitFor(async () => {
      expect(await storedEvents()).toHaveLength(1);
    });
    expect((await storedEvents())[0]).not.toHaveProperty('ageDays');
  });
});
