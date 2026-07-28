/**
 * Recording a service and a pregnancy diagnosis as a farmer does it (FR-120/121). Renders the real
 * `<App/>` against a seeded `localStorage`, including a seeded gestation cache, so the whole thing
 * runs with no network at all — which is the state a crush is actually in.
 *
 * Four assertions carry the design of this slice:
 *  • A SERVICE IS A WINDOW as often as it is a day, and the window survives to the stored record.
 *    Squeezing "the bull ran with them for six weeks" into one date field would fabricate a
 *    precision the farmer never had.
 *  • The projected CALVING DATE is on screen before the farmer walks away, and it is computed from
 *    the CACHED gestation figure by the same domain function the server runs.
 *  • The stored capture carries the SERVICE DATE and NO due date. The date that counts is projected
 *    server-side (ADR-0005, FR-121); a client that could send it could assert a calving date
 *    nothing on the server can check.
 *  • A SPECIES WITH NO FIGURE STILL RECORDS THE TEST. Refusing would lose a real fact to protect a
 *    projection, so the screen says plainly that no date can be worked out and stores the diagnosis
 *    anyway.
 *
 * ⭐ Dates here go through `farmDay`/`farmToday`, never `toISOString().slice(0, 10)`. The code under
 * test computes in the FARM's zone; a UTC slice names yesterday between 00:00 and 02:00 SAST, so an
 * assertion written that way reds for two hours out of every twenty-four.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { uuidv7, type schemas } from '@werf/core';
import { projectDueDate } from '@werf/domain';
import { App } from '../App';
import { farmToday } from '../farmTime';

const SESSION_KEY = 'werf-session';
const FARM_ID = '0190f3a0-0000-7000-8000-0000000000f2';
const HERD_KEY = `werf-herd:${FARM_ID}`;
const BREEDING_KEY = `werf-breeding:${FARM_ID}`;
const GESTATION_KEY = `werf-species-gestation:${FARM_ID}`;

/** The figure the migration seeds for cattle. Asserted THROUGH the cache, never typed into an
 *  expectation — the test computes what the screen should say with the same function the screen
 *  uses, so a wrong figure fails at the source rather than being copied into both sides. */
const CATTLE_GESTATION = 283;

const SESSION_USER: schemas.AuthSession['user'] = {
  id: '0190f3a0-0000-7000-8000-000000000002',
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

/** The gestation figures, already on the device. `game` is absent ON PURPOSE — that absence is
 *  what the no-projection case exercises, and it mirrors the migration, which seeds no row. */
function seedGestation(): void {
  window.localStorage.setItem(
    GESTATION_KEY,
    JSON.stringify([
      { species: 'cattle', gestationDays: CATTLE_GESTATION, source: 'Species mean (test)' },
      { species: 'sheep', gestationDays: 147, source: 'Species mean (test)' },
    ]),
  );
}

function animal(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: uuidv7(),
    farmId: FARM_ID,
    enterpriseId: null,
    species: 'cattle',
    breed: null,
    sex: 'female',
    dob: null,
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
    ...over,
  };
}

function seedHerd(rows: Array<Record<string, unknown>>): void {
  window.localStorage.setItem(HERD_KEY, JSON.stringify(rows));
}

function storedBreeding(): Array<Record<string, unknown>> {
  return JSON.parse(window.localStorage.getItem(BREEDING_KEY) ?? '[]') as Array<
    Record<string, unknown>
  >;
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, '', '/');
  cachedSession();
  seedGestation();
});

describe('recording a service (FR-120)', () => {
  it('keeps a running bull as a WINDOW rather than collapsing it to a day', async () => {
    const cow = animal({ sex: 'female' });
    const bull = animal({ sex: 'male', breed: 'Bonsmara' });
    seedHerd([cow, bull]);

    const user = userEvent.setup();
    render(<App />);
    window.history.pushState({}, '', '/animals/mating');
    render(<App />);

    await user.selectOptions(await screen.findByLabelText('Which female'), cow.id as string);
    // Natural service defaults to the window, which is the point — the commonest case needs no tap.
    await user.selectOptions(screen.getByLabelText('Which sire'), bull.id as string);
    await user.clear(screen.getByLabelText('Bull in'));
    await user.type(screen.getByLabelText('Bull in'), '2026-01-05');
    await user.type(screen.getByLabelText('Bull out'), '2026-02-16');
    await user.click(screen.getByRole('button', { name: 'Record the service' }));

    const stored = storedBreeding();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      kind: 'mating',
      animalId: cow.id,
      method: 'natural',
      sireId: bull.id,
      bullInAt: '2026-01-05',
      bullOutAt: '2026-02-16',
    });
    // The event sits at the EARLIEST day the service could have happened, so it never claims
    // something happened before it could have. Both bounds are on the record either way.
    expect(stored[0]!['occurredAt']).toBe('2026-01-05T12:00:00.000Z');
  });

  it('records an open-ended window — a bull still with the cows is an ordinary October state', async () => {
    const cow = animal({});
    seedHerd([cow]);

    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/mating');
    render(<App />);

    await user.selectOptions(await screen.findByLabelText('Which female'), cow.id as string);
    await user.clear(screen.getByLabelText('Bull in'));
    await user.type(screen.getByLabelText('Bull in'), '2026-03-01');
    await user.click(screen.getByRole('button', { name: 'Record the service' }));

    const stored = storedBreeding();
    expect(stored[0]).toMatchObject({ bullInAt: '2026-03-01' });
    // Absent, not null: an omitted bound means "not closed yet", and a null would assert a date.
    expect(stored[0]).not.toHaveProperty('bullOutAt');
  });

  it('refuses to save a window that runs backwards, and says which date to look at', async () => {
    const cow = animal({});
    seedHerd([cow]);

    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/mating');
    render(<App />);

    await user.selectOptions(await screen.findByLabelText('Which female'), cow.id as string);
    await user.clear(screen.getByLabelText('Bull in'));
    await user.type(screen.getByLabelText('Bull in'), '2026-02-16');
    await user.type(screen.getByLabelText('Bull out'), '2026-01-05');

    expect(screen.getByRole('alert').textContent).toContain('Bull out is before bull in');
    expect(
      screen.getByRole('button', { name: 'Record the service' }).hasAttribute('disabled'),
    ).toBe(true);
    expect(storedBreeding()).toHaveLength(0);
  });

  it('records an external sire by code, and never as a farm animal id', async () => {
    const cow = animal({});
    seedHerd([cow]);

    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/mating');
    render(<App />);

    await user.selectOptions(await screen.findByLabelText('Which female'), cow.id as string);
    await user.click(screen.getByRole('button', { name: 'AI' }));
    await user.selectOptions(screen.getByLabelText('Which sire'), 'external');
    await user.type(screen.getByLabelText('Bull or straw code'), 'SA-BON-4471');
    await user.click(screen.getByRole('button', { name: 'Record the service' }));

    const stored = storedBreeding();
    expect(stored[0]).toMatchObject({ method: 'ai', sireCode: 'SA-BON-4471' });
    expect(stored[0]).not.toHaveProperty('sireId');
    // Choosing AI moved the timing to a single day, because an insemination IS dated.
    expect(stored[0]).not.toHaveProperty('bullInAt');
  });
});

describe('recording a pregnancy diagnosis (FR-121)', () => {
  it('shows the projected calving date before the farmer walks away, and stores no due date', async () => {
    const cow = animal({});
    seedHerd([cow]);

    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/pregnancy');
    render(<App />);

    await user.selectOptions(await screen.findByLabelText('Which female'), cow.id as string);
    await user.clear(screen.getByLabelText('When was she served'));
    await user.type(screen.getByLabelText('When was she served'), '2026-01-05');

    // Computed here the same way the screen computes it, from the SEEDED figure. Nothing in this
    // assertion is a date typed out by hand.
    const expected = projectDueDate('2026-01-05', CATTLE_GESTATION);
    expect(await screen.findByText(new RegExp(expected))).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Record the test' }));

    const stored = storedBreeding();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      kind: 'pregnancyTest',
      animalId: cow.id,
      result: 'pregnant',
      method: 'palpation',
      matingDate: '2026-01-05',
    });
    // ⭐ The one that matters. The device previews a date; the SERVER projects and stores it.
    expect(stored[0]).not.toHaveProperty('dueDate');
  });

  it('prefills the service date from the service already on the phone', async () => {
    const cow = animal({});
    seedHerd([cow]);
    window.localStorage.setItem(
      BREEDING_KEY,
      JSON.stringify([
        {
          id: uuidv7(),
          kind: 'mating',
          farmId: FARM_ID,
          animalId: cow.id,
          occurredAt: '2026-01-05T12:00:00.000Z',
          method: 'natural',
          bullInAt: '2026-01-05',
          bullOutAt: '2026-02-16',
        },
      ]),
    );

    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/pregnancy');
    render(<App />);

    await user.selectOptions(await screen.findByLabelText('Which female'), cow.id as string);

    // Bull IN, not bull out: the earliest she could have been served is the earliest she could
    // calve, and a farmer who watches a week early loses a week — the other error loses a calf.
    expect((screen.getByLabelText('When was she served') as HTMLInputElement).value).toBe(
      '2026-01-05',
    );
    expect(screen.getByText(/Taken from the service you recorded/)).toBeTruthy();
  });

  it('records the test for a species with no gestation figure, and says why there is no date', async () => {
    const doe = animal({ species: 'game' });
    seedHerd([doe]);

    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/pregnancy');
    render(<App />);

    await user.selectOptions(await screen.findByLabelText('Which female'), doe.id as string);
    await user.clear(screen.getByLabelText('When was she served'));
    await user.type(screen.getByLabelText('When was she served'), '2026-01-05');

    const note = screen.getByText(/No calving date can be worked out for/);
    expect(note).toBeTruthy();
    expect(note.textContent).toContain('The test itself is still recorded');

    await user.click(screen.getByRole('button', { name: 'Record the test' }));

    // ⛔ The fact survives. Refusing the diagnosis would lose a real observation to protect a
    // projection that was never available.
    const stored = storedBreeding();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ kind: 'pregnancyTest', result: 'pregnant' });
    expect(stored[0]).not.toHaveProperty('dueDate');
  });

  it('sends no service date on an EMPTY result, where a due date would be a contradiction', async () => {
    const cow = animal({});
    seedHerd([cow]);

    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/pregnancy');
    render(<App />);

    await user.selectOptions(await screen.findByLabelText('Which female'), cow.id as string);
    await user.click(screen.getByRole('button', { name: 'Empty' }));
    await user.click(screen.getByRole('button', { name: 'Record the test' }));

    const stored = storedBreeding();
    expect(stored[0]).toMatchObject({ result: 'open' });
    expect(stored[0]).not.toHaveProperty('matingDate');
  });

  it('defaults the test day to the farm-local today, not the device UTC day', async () => {
    const cow = animal({});
    seedHerd([cow]);

    window.history.pushState({}, '', '/animals/pregnancy');
    render(<App />);

    expect(((await screen.findByLabelText('Tested on')) as HTMLInputElement).value).toBe(
      farmToday(),
    );
  });
});

describe('the breeding captures reach the outbox', () => {
  it('queues both kinds as unsent work the farmer can see', async () => {
    const cow = animal({});
    seedHerd([cow]);

    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/mating');
    render(<App />);

    // The seeded herd row is itself an unsent capture, so the count MOVING is the assertion —
    // a bare total would pass just as well if the service never reached the queue at all.
    const strip = await screen.findByRole('status', { name: 'Save status' });
    expect(strip.textContent ?? '').toContain('1 to send');

    await user.selectOptions(await screen.findByLabelText('Which female'), cow.id as string);
    await user.click(screen.getByRole('button', { name: 'Record the service' }));

    // The words the product uses: a count and "to send". "Sync" is never said to a farmer, and
    // this asserts that it is not.
    expect(
      (await screen.findByRole('status', { name: 'Save status' })).textContent ?? '',
    ).toContain('2 to send');
    expect(strip.textContent ?? '').not.toMatch(/sync/i);
  });
});
