/**
 * Recording a loss — a death or a sale — and the herd count going DOWN. Either outcome is captured
 * offline as a lifecycle event, folded onto the herd by the projection through the domain state
 * machine, and the animal drops from the live count while staying in the list, marked — retained
 * forever (FR-105, FR-106, FR-705, FR-017). Like the other capture journeys these seed
 * `localStorage` and render the real `<App/>`; nothing touches the network.
 */

import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { schemas } from '@werf/core';
import { App } from '../App';
import { farmToday } from '../farmTime';
import { getCurrentFakeLocalDatabase, storedCaptures } from '../test-support/local-db';

const SESSION_KEY = 'werf-session';
const FARM_ID = '0190f3a0-0000-7000-8000-0000000000f1';
const HERD_KEY = `werf-herd:${FARM_ID}`;
const EVENTS_KEY = `werf-events:${FARM_ID}`;
const HEALTH_KEY = `werf-health:${FARM_ID}`;
const PRODUCTS_KEY = `werf-vet-products:${FARM_ID}`;
const PRODUCT_ID = '0190f3a0-0000-7000-8000-00000000d001';
const MOB_ID = '0190f3a0-0000-7000-8000-00000000b001';
const MOVES_KEY = `werf-moves:${FARM_ID}`;

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
    farms: [{ id: FARM_ID, name: 'Rietfontein', enterpriseTypes: ['beef_cattle'], role: 'owner' }],
    activeFarmId: FARM_ID,
    secondFactor: 'complete',
  };
  window.localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ payload, confirmedAt: new Date().toISOString() }),
  );
}

function animal(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    farmId: FARM_ID,
    species: 'cattle',
    sex: 'female',
    breed: null,
    status: 'alive',
    ...extra,
  };
}

/** The lifecycle log as the device holds it, read back the way a cold start would. */
function storedEvents(): Promise<readonly Record<string, unknown>[]> {
  return storedCaptures<Record<string, unknown>>(EVENTS_KEY);
}

function seedHerd(...animals: Array<Record<string, unknown>>): void {
  window.localStorage.setItem(HERD_KEY, JSON.stringify(animals));
}

/**
 * An animal dosed TODAY with a 28-day meat withdrawal, and the register that says so — the state a
 * device is genuinely in when a farmer opens this screen a week after a dipping.
 */
function seedActiveWithdrawal(animalId: string): void {
  window.localStorage.setItem(
    PRODUCTS_KEY,
    JSON.stringify([
      {
        id: PRODUCT_ID,
        jurisdiction: 'ZA',
        name: 'Terramycin LA',
        registrationNumber: 'G1234 Act 36/1947',
        species: ['cattle'],
        meatWithdrawalDays: 28,
        milkWithdrawalHours: 96,
        route: 'intramuscular',
        effectiveFrom: '2020-01-01',
        effectiveTo: null,
      },
    ]),
  );
  window.localStorage.setItem(
    HEALTH_KEY,
    JSON.stringify([
      {
        id: '0190f3a0-0000-7000-8000-00000000e001',
        farmId: FARM_ID,
        animalId,
        kind: 'treatment',
        occurredAt: new Date().toISOString(),
        administeredOn: farmToday(),
        productId: PRODUCT_ID,
      },
    ]),
  );
}

/** The flock dipped today, against the MOB — no animal named anywhere in the dose. */
function seedMobDip(mobId: string): void {
  window.localStorage.setItem(
    PRODUCTS_KEY,
    JSON.stringify([
      {
        id: PRODUCT_ID,
        jurisdiction: 'ZA',
        name: 'Tickaway',
        registrationNumber: 'G4321 Act 36/1947',
        species: ['cattle'],
        meatWithdrawalDays: 28,
        milkWithdrawalHours: null,
        route: 'topical',
        effectiveFrom: '2020-01-01',
        effectiveTo: null,
      },
    ]),
  );
  window.localStorage.setItem(
    HEALTH_KEY,
    JSON.stringify([
      {
        id: '0190f3a0-0000-7000-8000-00000000e002',
        farmId: FARM_ID,
        animalId: null,
        mobId,
        kind: 'dip',
        occurredAt: new Date().toISOString(),
        administeredOn: farmToday(),
        productId: PRODUCT_ID,
        method: 'plunge',
      },
    ]),
  );
}

function seedSale(animalId: string): void {
  window.localStorage.setItem(
    EVENTS_KEY,
    JSON.stringify([
      {
        id: 'e1',
        farmId: FARM_ID,
        animalId,
        type: 'sale',
        status: 'sold',
        occurredAt: new Date().toISOString(),
        counterparty: 'Vleissentraal',
        priceCents: 850000,
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

describe('recording a loss', () => {
  it('has nothing to record against when there are no live animals', () => {
    cachedSession();
    window.history.pushState({}, '', '/animals/loss');
    render(<App />);

    expect(screen.getByText(/no live animals to record a loss against/i)).toBeTruthy();
  });

  it('records a death offline and takes the animal out of the live herd', async () => {
    cachedSession();
    seedHerd(animal('a1', { sex: 'female' }), animal('a2', { sex: 'male' }));
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/loss');
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /female/i }));
    await user.click(screen.getByRole('button', { name: 'Died' }));
    await user.type(screen.getByLabelText(/cause/i), 'Snakebite');
    await user.click(screen.getByRole('button', { name: /record death/i }));

    expect(screen.getByText(/marked dead/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /female/i })).toBeNull();
  });

  it('records a sale with a price offline and destocks the animal', async () => {
    cachedSession();
    seedHerd(animal('a1', { sex: 'female' }), animal('a2', { sex: 'male' }));
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/loss');
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /female/i }));
    await user.click(screen.getByRole('button', { name: 'Sold' }));
    await user.type(screen.getByLabelText(/buyer/i), 'Vleissentraal');
    await user.type(screen.getByLabelText(/price/i), '8500');
    await user.click(screen.getByRole('button', { name: /record sale/i }));

    expect(screen.getByText(/marked sold/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /female/i })).toBeNull();
  });

  it('records the liveweight the deal was struck on (FR-106)', async () => {
    // Unrecoverable after the truck leaves, and without it a price says nothing about what the
    // animal was worth. Optional on the screen, because plenty of sales happen with no scale.
    cachedSession();
    seedHerd(animal('a1', { sex: 'female' }));
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/loss');
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /female/i }));
    await user.click(screen.getByRole('button', { name: 'Sold' }));
    await user.type(screen.getByLabelText(/buyer/i), 'Vleissentraal');
    await user.type(screen.getByLabelText(/^price/i), '8500');
    await user.type(screen.getByLabelText(/weight sold on/i), '412.5');
    await user.click(screen.getByRole('button', { name: /record sale/i }));

    await waitFor(async () => {
      expect(await storedEvents()).toHaveLength(1);
    });
    const sale = (await storedEvents()).find((e) => e['type'] === 'sale');
    // Money stays integer cents; the weight is kilograms as a number, never a string.
    expect(sale).toMatchObject({
      counterparty: 'Vleissentraal',
      priceCents: 850_000,
      weightKg: 412.5,
    });
  });

  it('saves a sale with no weight rather than demanding one', async () => {
    cachedSession();
    seedHerd(animal('a1', { sex: 'female' }));
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/loss');
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /female/i }));
    await user.click(screen.getByRole('button', { name: 'Sold' }));
    await user.type(screen.getByLabelText(/buyer/i), 'Vleissentraal');
    await user.type(screen.getByLabelText(/^price/i), '8500');
    await user.click(screen.getByRole('button', { name: /record sale/i }));

    await waitFor(async () => {
      expect(await storedEvents()).toHaveLength(1);
    });
    const sale = (await storedEvents()).find((e) => e['type'] === 'sale');
    expect(sale).toBeTruthy();
    expect(sale).not.toHaveProperty('weightKg');
  });

  it('⭐ records a SLAUGHTER as its own outcome, not as a death with a word typed in', async () => {
    // FR-131 needs to be able to READ "this went into the food chain". Home slaughter is the
    // ordinary disposal on most of these farms and it was landing as an ordinary death, so the
    // guard that blocks a sale inside a withdrawal had nothing to fire on — the mirror image of
    // the hole the group tally path closed.
    cachedSession();
    seedHerd(animal('a1', { sex: 'female' }));
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/loss');
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /female/i }));
    await user.click(screen.getByRole('button', { name: 'Slaughtered' }));
    await user.click(screen.getByRole('button', { name: /record slaughter/i }));

    expect(screen.getByText(/slaughtered/i)).toBeTruthy();
    await waitFor(async () => {
      expect(await storedEvents()).toHaveLength(1);
    });
    const death = (await storedEvents()).find((e) => e['type'] === 'death');
    expect(death).toMatchObject({ type: 'death', status: 'dead', slaughtered: true });
  });

  it('⭐ refuses a slaughter inside an active meat withdrawal, at capture', async () => {
    // Offline is the default state, so a server-only refusal arrives days after the animal has
    // been eaten. It says WHEN as well as no: a refusal with no way forward is what makes someone
    // stop recording treatments at all.
    cachedSession();
    seedHerd(animal('a1', { sex: 'female' }));
    seedActiveWithdrawal('a1');
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/loss');
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /female/i }));
    await user.click(screen.getByRole('button', { name: 'Slaughtered' }));

    expect(screen.getByText(/treated and cannot be sold for slaughter yet/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /record slaughter/i }).hasAttribute('disabled')).toBe(
      true,
    );
    expect((await storedEvents()).find((e) => e['type'] === 'death')).toBeUndefined();
  });

  it('⭐ refuses a slaughter for an animal AND its treatment known only via hydration (phase-checklists.md 3e)', async () => {
    // The gap this closes: before it, `RecordLossScreen`'s guard read `useAnimals()` (local-only)
    // to find `selectedStored`, and `useHealthEvents()` (local-only) for the dose. An animal
    // registered on ANOTHER device — never captured here — was invisible to `useAnimals()`, so
    // `selectedStored` came back `undefined` and the guard silently skipped ENTIRELY (not narrowly
    // wrong — OFF). This device never ran `seedHerd`/`seedActiveWithdrawal` at all: the animal AND
    // its treatment both arrive purely through down-sync, exactly as they would for a co-worker's
    // capture this device has only heard about.
    cachedSession();
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/loss');
    render(<App />);

    const fake = await getCurrentFakeLocalDatabase();
    act(() => {
      fake.hydrateRow('animals', {
        id: 'a1',
        farm_id: FARM_ID,
        species: 'cattle',
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
        id: '0190f3a0-0000-7000-8000-00000000e099',
        farm_id: FARM_ID,
        animal_id: 'a1',
        mob_id: null,
        type: 'treatment',
        occurred_at: new Date().toISOString(),
        // Real for a hydrated dose (see withdrawal.ts's module header): no `productId`, the
        // withdrawal already resolved server-side into `meatWithholdUntil`.
        payload: JSON.stringify({
          product: 'Terramycin LA',
          administeredOn: farmToday(),
          meatWithholdUntil: '2099-01-01', // far enough out that no test clock ever runs past it
        }),
      });
    });

    await user.click(await screen.findByRole('button', { name: /female/i }));
    await user.click(screen.getByRole('button', { name: 'Slaughtered' }));

    await waitFor(() => {
      expect(screen.getByText(/treated and cannot be sold for slaughter yet/i)).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: /record slaughter/i }).hasAttribute('disabled')).toBe(
      true,
    );
    expect((await storedEvents()).find((e) => e['type'] === 'death')).toBeUndefined();
  });

  it('⭐ refuses a sale for a HYDRATED animal whose mobId is CURRENT, dosed via a mob it has since LEFT (compliance-checker finding)', async () => {
    // A hydrated animal's `mob_id` is the server's denormalised CURRENT position, not its opening
    // one (`livestock.service.ts`'s `recordMove` overwrites it on every move that lands as the
    // latest). Seeding `withdrawal.ts`'s `mobMembership` from that field made the reconstruction
    // skip the animal's TRUE opening interval outright — a dose given to the mob it opened in,
    // before it ever moved, became invisible. This animal is hydrated already standing in OXEN
    // (current), a hydrated move records it walked there FROM DIP_CAMP, and the dip was given to
    // DIP_CAMP before that move — the exact shape the fix reads `fromMobId` off the wire to catch.
    const DIP_CAMP = '0190f3a0-0000-7000-8000-00000000b010';
    const OXEN = '0190f3a0-0000-7000-8000-00000000b011';
    cachedSession();
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/loss');
    render(<App />);

    const fake = await getCurrentFakeLocalDatabase();
    act(() => {
      fake.hydrateRow('animals', {
        id: 'a1',
        farm_id: FARM_ID,
        species: 'cattle',
        sex: 'female',
        breed: null,
        status: 'alive',
        dob: null,
        dob_estimated: 0,
        status_at: null,
        dam_id: null,
        sire_id: null,
        mob_id: OXEN, // CURRENT position, per the server's denormalisation
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
        id: '0190f3a0-0000-7000-8000-00000000mv01',
        farm_id: FARM_ID,
        animal_id: 'a1',
        type: 'move',
        occurred_at: '2026-07-22T06:00:00.000Z',
        payload: JSON.stringify({
          fromLandUnitId: null,
          toLandUnitId: null,
          fromMobId: DIP_CAMP,
          toMobId: OXEN,
        }),
      });
      fake.hydrateRow('events', {
        id: '0190f3a0-0000-7000-8000-00000000e100',
        farm_id: FARM_ID,
        animal_id: null,
        mob_id: DIP_CAMP,
        type: 'dip',
        occurred_at: '2026-07-20T06:00:00.000Z',
        payload: JSON.stringify({
          product: 'Tickaway',
          administeredOn: '2026-07-20',
          meatWithholdUntil: '2099-01-01',
        }),
      });
    });

    await user.click(await screen.findByRole('button', { name: /female/i }));
    await user.click(screen.getByRole('button', { name: 'Sold' }));
    await user.type(screen.getByLabelText(/buyer/i), 'Vleissentraal');
    await user.type(screen.getByLabelText(/^price/i), '8500');

    await waitFor(() => {
      expect(screen.getByText(/treated and cannot be sold for slaughter yet/i)).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: /record sale/i }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('⭐ a LOCALLY-CAPTURED copy of a move does not mask its own hydrated fromMobId (compliance-checker finding #2, phase-checklists.md 3e)', async () => {
    // The gap finding #1's fix left open: `mergeById`'s local-wins, combined with local capture
    // rows never being evicted, meant a move THIS DEVICE captured (no `fromMobId` — the app never
    // sends one) permanently shadowed its own hydrated twin — the SAME move, same id, now carrying
    // `fromMobId` once the server had echoed it back down — inside `RecordLossScreen`'s fold. That
    // is the ordinary two-device (or two-sync) workflow, not an edge case: reproduced here by
    // seeding BOTH the local move log and the hydrated `events` table with the SAME move id. The
    // fix is `mergeByIdPreferHydrated` — see `HydratedLivestock.tsx`.
    const DIP_CAMP = '0190f3a0-0000-7000-8000-00000000b020';
    const OXEN = '0190f3a0-0000-7000-8000-00000000b021';
    const MOVE_ID = '0190f3a0-0000-7000-8000-00000000mv02';
    cachedSession();
    seedHerd(animal('a1', { sex: 'female', mobId: OXEN }));
    // The LOCAL echo of the move: no `fromMobId`, exactly as a real local capture is shaped — the
    // app never sends one, so a local `StoredMove` structurally cannot carry it.
    window.localStorage.setItem(
      MOVES_KEY,
      JSON.stringify([
        {
          id: MOVE_ID,
          farmId: FARM_ID,
          animalId: 'a1',
          occurredAt: '2026-07-22T06:00:00.000Z',
          toMobId: OXEN,
          batchId: null,
        },
      ]),
    );
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/loss');
    render(<App />);

    const fake = await getCurrentFakeLocalDatabase();
    act(() => {
      // The SAME move (same id), now hydrated back down with the server-resolved `fromMobId` — the
      // enrichment a local capture never carries.
      fake.hydrateRow('events', {
        id: MOVE_ID,
        farm_id: FARM_ID,
        animal_id: 'a1',
        type: 'move',
        occurred_at: '2026-07-22T06:00:00.000Z',
        payload: JSON.stringify({
          fromLandUnitId: null,
          toLandUnitId: null,
          fromMobId: DIP_CAMP,
          toMobId: OXEN,
        }),
      });
      fake.hydrateRow('events', {
        id: '0190f3a0-0000-7000-8000-00000000e101',
        farm_id: FARM_ID,
        animal_id: null,
        mob_id: DIP_CAMP,
        type: 'dip',
        occurred_at: '2026-07-20T06:00:00.000Z',
        payload: JSON.stringify({
          product: 'Tickaway',
          administeredOn: '2026-07-20',
          meatWithholdUntil: '2099-01-01',
        }),
      });
    });

    await user.click(await screen.findByRole('button', { name: /female/i }));
    await user.click(screen.getByRole('button', { name: 'Sold' }));
    await user.type(screen.getByLabelText(/buyer/i), 'Vleissentraal');
    await user.type(screen.getByLabelText(/^price/i), '8500');

    await waitFor(() => {
      expect(screen.getByText(/treated and cannot be sold for slaughter yet/i)).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: /record sale/i }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('refuses a SALE inside an active meat withdrawal, at capture', async () => {
    cachedSession();
    seedHerd(animal('a1', { sex: 'female' }));
    seedActiveWithdrawal('a1');
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/loss');
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /female/i }));
    await user.click(screen.getByRole('button', { name: 'Sold' }));
    await user.type(screen.getByLabelText(/buyer/i), 'Vleissentraal');
    await user.type(screen.getByLabelText(/^price/i), '8500');

    expect(screen.getByText(/treated and cannot be sold for slaughter yet/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /record sale/i }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('⭐ a CLEARED day does not disarm the sale guard, and cannot save an un-sendable sale', async () => {
    // The dose-day bound added to `latestClearAcross` compares `administeredOn > disposalOn`. A
    // native date input is clearable, and every real day is `> ''`, so a blank day skipped EVERY
    // dose, `latest` stayed undefined, and the animal read CLEAR: the red panel vanished and Save
    // went live on an animal deep inside a withholding. The bound written to stop a false REFUSAL
    // had opened a false PASS, which is the worse direction. Second arm: the sale then reached
    // `save` as `new Date('T12:00:00.000Z')` = Invalid Date and threw out of the click handler, so
    // the record was lost with no message. The death branch was given both guards and pinned by a
    // test; the sale branch — the other route into the food chain — was given neither.
    cachedSession();
    seedHerd(animal('a1', { sex: 'female' }));
    seedActiveWithdrawal('a1');
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/loss');
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /female/i }));
    await user.click(screen.getByRole('button', { name: 'Sold' }));
    await user.type(screen.getByLabelText(/buyer/i), 'Vleissentraal');
    await user.type(screen.getByLabelText(/^price/i), '8500');
    await user.clear(screen.getByLabelText(/what day/i));

    // Everything the sale needs is filled in EXCEPT the day. Save must stay disabled...
    expect(screen.getByRole('button', { name: /record sale/i }).hasAttribute('disabled')).toBe(
      true,
    );

    // ...and clicking anyway must write nothing — no Invalid Date, no stranded capture.
    await user.click(screen.getByRole('button', { name: /record sale/i }));
    expect(await storedEvents()).toHaveLength(0);
  });

  it('still lets an untreated animal be slaughtered', async () => {
    // The bound: a guard that refuses what it should not is a guard people learn to work around.
    cachedSession();
    seedHerd(animal('a2', { sex: 'female' }));
    // The dose is on a DIFFERENT animal — one withdrawal must not hold the whole herd.
    seedActiveWithdrawal('a1');
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/loss');
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /female/i }));
    await user.click(screen.getByRole('button', { name: 'Slaughtered' }));
    await user.click(screen.getByRole('button', { name: /record slaughter/i }));

    await waitFor(async () => {
      expect(await storedEvents()).toHaveLength(1);
    });
    expect((await storedEvents()).find((e) => e['type'] === 'death')).toMatchObject({
      slaughtered: true,
    });
  });

  it('⭐ refuses to slaughter an animal whose MOB was dipped, though it was never dosed by name', async () => {
    // Health events are animal-XOR-mob, so a plunge dip stores `animal_id = NULL`. The client guard
    // read only animal-subject events, so it previewed CLEAR for every individual in a dipped
    // flock — while the server, which reconstructs membership, correctly refused. A capture-time
    // guard that disagrees with the one that will actually refuse is worse than none: it tells the
    // farmer the animal is fine.
    cachedSession();
    seedHerd(animal('a1', { sex: 'female', mobId: MOB_ID }));
    seedMobDip(MOB_ID);
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/loss');
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /female/i }));
    await user.click(screen.getByRole('button', { name: 'Slaughtered' }));

    expect(screen.getByText(/treated and cannot be sold for slaughter yet/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /record slaughter/i }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('does NOT withhold an animal that joined the dipped mob AFTER the dip', async () => {
    // The bound, and it is the reason membership is reconstructed rather than read off the current
    // mob. An animal that walked in the next day was never in the race, and blocking its sale for
    // 28 days is a guard inventing a residue — which is how a guard teaches its own workaround.
    cachedSession();
    seedHerd(animal('a1', { sex: 'female', mobId: null }));
    seedMobDip(MOB_ID);
    window.localStorage.setItem(
      MOVES_KEY,
      JSON.stringify([
        {
          id: '0190f3a0-0000-7000-8000-00000000e003',
          farmId: FARM_ID,
          animalId: 'a1',
          // Tomorrow, so it is unambiguously after today's dip whatever the clock says.
          occurredAt: new Date(Date.now() + 86_400_000).toISOString(),
          toMobId: MOB_ID,
          batchId: null,
        },
      ]),
    );
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/loss');
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /female/i }));
    await user.click(screen.getByRole('button', { name: 'Slaughtered' }));

    expect(screen.queryByText(/treated and cannot be sold for slaughter yet/i)).toBeNull();
  });

  it('⭐ judges a BACK-DATED slaughter on the day it happened, not on today', async () => {
    // The disposal day was stamped `new Date()` and never asked. So an animal slaughtered inside a
    // withholding and written up after the clear date passed the guard, and the durable record said
    // it was legal — the same defect class as the health screen stamping `now()`.
    cachedSession();
    seedHerd(animal('a1', { sex: 'female' }));
    seedActiveWithdrawal('a1');
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/loss');
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /female/i }));
    await user.click(screen.getByRole('button', { name: 'Slaughtered' }));

    // The day is ASKED, and it defaults to today.
    const day = screen.getByLabelText(/what day/i) as HTMLInputElement;
    expect(day.value).toBe(farmToday());
    expect(screen.getByText(/treated and cannot be sold for slaughter yet/i)).toBeTruthy();
  });

  it('stores a locale-independent cause for a slaughter', async () => {
    // A translated string in an audit field means the register varies by which phone captured it.
    // The machine-readable fact is the flag; the cause must not be farmer-facing copy.
    cachedSession();
    seedHerd(animal('a1', { sex: 'female' }));
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/loss');
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /female/i }));
    await user.click(screen.getByRole('button', { name: 'Slaughtered' }));
    await user.click(screen.getByRole('button', { name: /record slaughter/i }));

    await waitFor(async () => {
      expect(await storedEvents()).toHaveLength(1);
    });
    expect((await storedEvents()).find((e) => e['type'] === 'death')).toMatchObject({
      cause: 'slaughtered',
      slaughtered: true,
    });
  });

  it('⭐ lets a DEATH be back-dated to the day it happened, not stamped today', async () => {
    // The day input was rendered only for a sale or slaughter, so a `died` outcome always stamped
    // today. A death INSIDE a withholding, written up after the clear date, then reached the server
    // dated wrong — carrying no `withinWithdrawal` flag — and there was no way in the product to
    // record the true day. The group path (AdjustMobScreen) has always asked when; this one did not.
    cachedSession();
    seedHerd(animal('a1', { sex: 'female' }));
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/loss');
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /female/i }));
    await user.click(screen.getByRole('button', { name: 'Died' }));

    // The day is now ASKED for a death too, and defaults to today.
    const day = screen.getByLabelText(/what day/i) as HTMLInputElement;
    expect(day.value).toBe(farmToday());

    await user.clear(day);
    await user.type(day, '2026-07-18');
    await user.type(screen.getByLabelText(/cause/i), 'Bloat');
    await user.click(screen.getByRole('button', { name: /record death/i }));

    await waitFor(async () => {
      expect(await storedEvents()).toHaveLength(1);
    });
    // Stamped midday on the day the farmer gave, so the instant cannot slide across a zone.
    expect((await storedEvents()).find((e) => e['type'] === 'death')?.['occurredAt']).toBe(
      '2026-07-18T12:00:00.000Z',
    );
  });

  it('⭐ will not save a death with the day cleared — no invalid, un-sendable occurredAt', async () => {
    // The day input the back-dating fix added for `died` is clearable, and `canSave` for a death
    // checked only the cause. A cleared date reached `save` as `new Date('T12:00:00.000Z')` = Invalid
    // Date, serialised to `occurredAt: null`, and the death was stranded in the outbox forever (a 400
    // on the timestamp) — losing the very record the day was added to date correctly. The slaughter
    // branch already required the day; the death branch must too.
    cachedSession();
    seedHerd(animal('a1', { sex: 'female' }));
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/loss');
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /female/i }));
    await user.click(screen.getByRole('button', { name: 'Died' }));
    await user.type(screen.getByLabelText(/cause/i), 'Bloat');
    await user.clear(screen.getByLabelText(/what day/i));

    // A cause but no day: Save is disabled, so no invalid record can be captured.
    expect(screen.getByRole('button', { name: /record death/i }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(await storedEvents()).toHaveLength(0);
  });

  it('⭐ records a DEATH inside a withholding — and says so rather than saying nothing', async () => {
    // A death is never refused: refusing to record a fact is the worse failure. But "Died" sits one
    // tap from the blocked "Slaughtered", so silence here teaches the workaround — stopped on one
    // button, the farmer taps the next and the residue leaves with no trace it was ever in
    // question. The fact is kept AND the circumstance is kept.
    cachedSession();
    seedHerd(animal('a1', { sex: 'female' }));
    seedActiveWithdrawal('a1');
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/loss');
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /female/i }));
    await user.click(screen.getByRole('button', { name: 'Died' }));

    expect(screen.getByText(/still inside a meat withdrawal on this day/i)).toBeTruthy();

    // And it saves anyway — the note is not a refusal.
    await user.type(screen.getByLabelText(/cause/i), 'Tick-borne disease');
    await user.click(screen.getByRole('button', { name: /record death/i }));
    await waitFor(async () => {
      expect(await storedEvents()).toHaveLength(1);
    });
    expect((await storedEvents()).find((e) => e['type'] === 'death')).toBeTruthy();
  });

  it('drops the home tile count when an animal is sold, and it survives a cold start', async () => {
    cachedSession();
    seedHerd(animal('a1'), animal('a2'));
    seedSale('a1');
    render(<App />);

    const herd = screen.getByRole('link', { name: /herd/i });
    expect(await within(herd).findByText('1')).toBeTruthy();
  });

  it('keeps the sold animal in the list marked, and the weigh session skips it', async () => {
    cachedSession();
    seedHerd(animal('a1', { sex: 'female' }), animal('a2', { sex: 'male' }));
    seedSale('a1');

    window.history.pushState({}, '', '/animals');
    const { unmount } = render(<App />);
    expect(await screen.findByText(/sold/i)).toBeTruthy();
    unmount();

    window.history.pushState({}, '', '/weigh');
    render(<App />);
    expect(await screen.findByText('1 of 1')).toBeTruthy();
  });
});
