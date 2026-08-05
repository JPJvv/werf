/**
 * Recording a loss — a death or a sale — and the herd count going DOWN. Either outcome is captured
 * offline as a lifecycle event, folded onto the herd by the projection through the domain state
 * machine, and the animal drops from the live count while staying in the list, marked — retained
 * forever (FR-105, FR-106, FR-705, FR-017). Like the other capture journeys these seed
 * `localStorage` and render the real `<App/>`; nothing touches the network.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { schemas } from '@werf/core';
import { App } from '../App';
import { farmToday } from '../farmTime';

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
function storedEvents(): Array<Record<string, unknown>> {
  return JSON.parse(window.localStorage.getItem(EVENTS_KEY) ?? '[]') as Array<
    Record<string, unknown>
  >;
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
        name: 'Terramycin LA',
        registrationNumber: 'G1234 Act 36/1947',
        species: ['cattle'],
        meatWithdrawalDays: 28,
        milkWithdrawalHours: 96,
        route: 'intramuscular',
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
        name: 'Tickaway',
        registrationNumber: 'G4321 Act 36/1947',
        species: ['cattle'],
        meatWithdrawalDays: 28,
        milkWithdrawalHours: null,
        route: 'topical',
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

    await user.click(screen.getByRole('button', { name: /female/i }));
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

    await user.click(screen.getByRole('button', { name: /female/i }));
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

    await user.click(screen.getByRole('button', { name: /female/i }));
    await user.click(screen.getByRole('button', { name: 'Sold' }));
    await user.type(screen.getByLabelText(/buyer/i), 'Vleissentraal');
    await user.type(screen.getByLabelText(/^price/i), '8500');
    await user.type(screen.getByLabelText(/weight sold on/i), '412.5');
    await user.click(screen.getByRole('button', { name: /record sale/i }));

    const sale = storedEvents().find((e) => e['type'] === 'sale');
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

    await user.click(screen.getByRole('button', { name: /female/i }));
    await user.click(screen.getByRole('button', { name: 'Sold' }));
    await user.type(screen.getByLabelText(/buyer/i), 'Vleissentraal');
    await user.type(screen.getByLabelText(/^price/i), '8500');
    await user.click(screen.getByRole('button', { name: /record sale/i }));

    const sale = storedEvents().find((e) => e['type'] === 'sale');
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

    await user.click(screen.getByRole('button', { name: /female/i }));
    await user.click(screen.getByRole('button', { name: 'Slaughtered' }));
    await user.click(screen.getByRole('button', { name: /record slaughter/i }));

    expect(screen.getByText(/slaughtered/i)).toBeTruthy();
    const death = storedEvents().find((e) => e['type'] === 'death');
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

    await user.click(screen.getByRole('button', { name: /female/i }));
    await user.click(screen.getByRole('button', { name: 'Slaughtered' }));

    expect(screen.getByText(/treated and cannot be sold for slaughter yet/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /record slaughter/i }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(storedEvents().find((e) => e['type'] === 'death')).toBeUndefined();
  });

  it('refuses a SALE inside an active meat withdrawal, at capture', async () => {
    cachedSession();
    seedHerd(animal('a1', { sex: 'female' }));
    seedActiveWithdrawal('a1');
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/loss');
    render(<App />);

    await user.click(screen.getByRole('button', { name: /female/i }));
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

    await user.click(screen.getByRole('button', { name: /female/i }));
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
    expect(storedEvents()).toHaveLength(0);
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

    await user.click(screen.getByRole('button', { name: /female/i }));
    await user.click(screen.getByRole('button', { name: 'Slaughtered' }));
    await user.click(screen.getByRole('button', { name: /record slaughter/i }));

    expect(storedEvents().find((e) => e['type'] === 'death')).toMatchObject({ slaughtered: true });
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

    await user.click(screen.getByRole('button', { name: /female/i }));
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

    await user.click(screen.getByRole('button', { name: /female/i }));
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

    await user.click(screen.getByRole('button', { name: /female/i }));
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

    await user.click(screen.getByRole('button', { name: /female/i }));
    await user.click(screen.getByRole('button', { name: 'Slaughtered' }));
    await user.click(screen.getByRole('button', { name: /record slaughter/i }));

    expect(storedEvents().find((e) => e['type'] === 'death')).toMatchObject({
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

    await user.click(screen.getByRole('button', { name: /female/i }));
    await user.click(screen.getByRole('button', { name: 'Died' }));

    // The day is now ASKED for a death too, and defaults to today.
    const day = screen.getByLabelText(/what day/i) as HTMLInputElement;
    expect(day.value).toBe(farmToday());

    await user.clear(day);
    await user.type(day, '2026-07-18');
    await user.type(screen.getByLabelText(/cause/i), 'Bloat');
    await user.click(screen.getByRole('button', { name: /record death/i }));

    // Stamped midday on the day the farmer gave, so the instant cannot slide across a zone.
    expect(storedEvents().find((e) => e['type'] === 'death')?.['occurredAt']).toBe(
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

    await user.click(screen.getByRole('button', { name: /female/i }));
    await user.click(screen.getByRole('button', { name: 'Died' }));
    await user.type(screen.getByLabelText(/cause/i), 'Bloat');
    await user.clear(screen.getByLabelText(/what day/i));

    // A cause but no day: Save is disabled, so no invalid record can be captured.
    expect(screen.getByRole('button', { name: /record death/i }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(storedEvents()).toHaveLength(0);
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

    await user.click(screen.getByRole('button', { name: /female/i }));
    await user.click(screen.getByRole('button', { name: 'Died' }));

    expect(screen.getByText(/still inside a meat withdrawal on this day/i)).toBeTruthy();

    // And it saves anyway — the note is not a refusal.
    await user.type(screen.getByLabelText(/cause/i), 'Tick-borne disease');
    await user.click(screen.getByRole('button', { name: /record death/i }));
    expect(storedEvents().find((e) => e['type'] === 'death')).toBeTruthy();
  });

  it('drops the home tile count when an animal is sold, and it survives a cold start', () => {
    cachedSession();
    seedHerd(animal('a1'), animal('a2'));
    seedSale('a1');
    render(<App />);

    const herd = screen.getByRole('link', { name: /herd/i });
    expect(within(herd).getByText('1')).toBeTruthy();
  });

  it('keeps the sold animal in the list marked, and the weigh session skips it', () => {
    cachedSession();
    seedHerd(animal('a1', { sex: 'female' }), animal('a2', { sex: 'male' }));
    seedSale('a1');

    window.history.pushState({}, '', '/animals');
    const { unmount } = render(<App />);
    expect(screen.getByText(/sold/i)).toBeTruthy();
    unmount();

    window.history.pushState({}, '', '/weigh');
    render(<App />);
    expect(screen.getByText('1 of 1')).toBeTruthy();
  });
});
