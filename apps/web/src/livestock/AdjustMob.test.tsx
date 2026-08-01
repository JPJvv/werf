/**
 * Changing a group's numbers (FR-102) as a farmer does it: pick the flock, say what happened, say
 * how many, save — and the head count on the home tile moves, offline, with no individual animal
 * rows anywhere. Renders the real `<App/>` against a seeded `localStorage`, so the flock and its
 * adjustments are read back through the same boot path a cold start uses.
 *
 * This is the gap the slice closes and the assertion that matters: before it, a 300-head flock
 * created on day one was a 300-head flock forever, through a lambing, a drought and an abattoir run.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { schemas } from '@werf/core';
import { App } from '../App';
import { farmToday } from '../farmTime';

const SESSION_KEY = 'werf-session';
const FARM_ID = '0190f3a0-0000-7000-8000-0000000000f1';
const MOBS_KEY = `werf-mobs:${FARM_ID}`;
const TALLIES_KEY = `werf-tallies:${FARM_ID}`;
const MOB_ID = '0190f3a0-0000-7000-8000-00000000b001';
const OTHER_MOB_ID = '0190f3a0-0000-7000-8000-00000000b002';
const HEALTH_KEY = `werf-health:${FARM_ID}`;
const PRODUCTS_KEY = `werf-vet-products:${FARM_ID}`;
const PRODUCT_ID = '0190f3a0-0000-7000-8000-00000000d001';
const HERD_KEY = `werf-herd:${FARM_ID}`;
const ANIMAL_ID = '0190f3a0-0000-7000-8000-00000000a001';

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

/** A 300-head flock already on the device, as `AddMobScreen` would have left it. */
function seedFlock(headCount: number | null = 300): void {
  window.localStorage.setItem(
    MOBS_KEY,
    JSON.stringify([
      {
        id: MOB_ID,
        farmId: FARM_ID,
        name: 'Flock A',
        species: 'sheep',
        landUnitId: null,
        enterpriseId: FLOCK.id,
        headCount,
      },
    ]),
  );
}

/** Two counted flocks, so a transfer has somewhere to go. Flock B starts empty, as a new camp does. */
function seedTwoFlocks(): void {
  window.localStorage.setItem(
    MOBS_KEY,
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
      {
        id: OTHER_MOB_ID,
        farmId: FARM_ID,
        name: 'Flock B',
        species: 'sheep',
        landUnitId: null,
        enterpriseId: FLOCK.id,
        headCount: 0,
      },
    ]),
  );
}

/** The flock dipped TODAY with a 28-day meat withdrawal, and the register that says so. */
function seedDip(): void {
  window.localStorage.setItem(
    PRODUCTS_KEY,
    JSON.stringify([
      {
        id: PRODUCT_ID,
        name: 'Tickaway',
        registrationNumber: 'G4321 Act 36/1947',
        species: ['sheep'],
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
        id: '0190f3a0-0000-7000-8000-00000000f001',
        farmId: FARM_ID,
        animalId: null,
        mobId: MOB_ID,
        kind: 'dip',
        occurredAt: new Date().toISOString(),
        administeredOn: farmToday(),
        productId: PRODUCT_ID,
        method: 'plunge',
      },
    ]),
  );
}

function storedTallies(): Array<Record<string, unknown>> {
  return JSON.parse(window.localStorage.getItem(TALLIES_KEY) ?? '[]') as Array<
    Record<string, unknown>
  >;
}

/** Seed the tally log directly, for the cases about how adjustments COMPOSE. */
function seedTallies(tallies: Array<Record<string, unknown>>): void {
  window.localStorage.setItem(TALLIES_KEY, JSON.stringify(tallies));
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, '', '/');
});

afterEach(() => {
  window.localStorage.clear();
});

describe('changing a group’s numbers (FR-102)', () => {
  it('takes three dead ewes off the flock, and the home tile follows', async () => {
    cachedSession();
    seedFlock();
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/groups/count');
    const { unmount } = render(<App />);

    await user.click(screen.getByRole('button', { name: /flock a/i }));
    await user.click(screen.getByRole('button', { name: /^died$/i }));
    await user.type(screen.getByLabelText(/how many/i), '3');

    // ⭐ The arithmetic is on screen BEFORE it is committed — the farmer came to change a number
    // and can see the number they are about to write.
    expect(screen.getByText('297')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /^save$/i }));

    const saved = storedTallies();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      farmId: FARM_ID,
      mobId: MOB_ID,
      reason: 'death',
      count: 3,
      // The sign is derived, never typed: the store holds the delta the domain produced.
      delta: -3,
    });

    unmount();
    window.history.pushState({}, '', '/');
    render(<App />);
    expect(screen.getByText('297')).toBeTruthy();
  });

  it('adds a lambing, so the count can go UP as well as down', async () => {
    cachedSession();
    seedFlock();
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/groups/count');
    render(<App />);

    await user.click(screen.getByRole('button', { name: /flock a/i }));
    await user.click(screen.getByRole('button', { name: /^born$/i }));
    await user.type(screen.getByLabelText(/how many/i), '40');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(storedTallies()[0]).toMatchObject({ reason: 'birth', count: 40, delta: 40 });
  });

  it('⭐ keeps BOTH adjustments when two were captured separately, instead of losing one', async () => {
    // Two people, two phones, no signal, three dead ewes each. Six died; the flock is 294. An
    // edited head-count field would be last-write-wins and quietly land on 297.
    cachedSession();
    seedFlock();
    seedTallies([
      {
        id: '0190f3a0-0000-7000-8000-00000000a001',
        farmId: FARM_ID,
        mobId: MOB_ID,
        occurredAt: '2026-07-14T06:00:00.000Z',
        reason: 'death',
        count: 3,
        delta: -3,
      },
      {
        id: '0190f3a0-0000-7000-8000-00000000a002',
        farmId: FARM_ID,
        mobId: MOB_ID,
        occurredAt: '2026-07-14T09:00:00.000Z',
        reason: 'death',
        count: 3,
        delta: -3,
      },
    ]);

    window.history.pushState({}, '', '/');
    render(<App />);

    expect(screen.getByText('294')).toBeTruthy();
  });

  it('lets a recount supersede the arithmetic before it', async () => {
    cachedSession();
    seedFlock();
    seedTallies([
      {
        id: '0190f3a0-0000-7000-8000-00000000a001',
        farmId: FARM_ID,
        mobId: MOB_ID,
        occurredAt: '2026-07-14T06:00:00.000Z',
        reason: 'birth',
        count: 40,
        delta: 40,
      },
      {
        id: '0190f3a0-0000-7000-8000-00000000a002',
        farmId: FARM_ID,
        mobId: MOB_ID,
        occurredAt: '2026-07-16T06:00:00.000Z',
        reason: 'recount',
        count: 291,
        countedHead: 291,
      },
    ]);

    window.history.pushState({}, '', '/');
    render(<App />);

    expect(screen.getByText('291')).toBeTruthy();
  });

  it('refuses to take more head out than the flock has, and says what to do instead', async () => {
    cachedSession();
    seedFlock(3);
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/groups/count');
    render(<App />);

    await user.click(screen.getByRole('button', { name: /flock a/i }));
    await user.click(screen.getByRole('button', { name: /^sold$/i }));
    await user.type(screen.getByLabelText(/how many/i), '4');

    // Answers the next question rather than only refusing.
    expect(screen.getByText(/count the group and record what you find/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^save$/i }).hasAttribute('disabled')).toBe(true);
    expect(storedTallies()).toHaveLength(0);
  });

  it('says that recording a theft is not filing a stock-theft report', async () => {
    cachedSession();
    seedFlock();
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/groups/count');
    render(<App />);

    await user.click(screen.getByRole('button', { name: /flock a/i }));
    await user.click(screen.getByRole('button', { name: /^stolen$/i }));

    expect(screen.getByText(/does not file a stock-theft report/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /file a stock-theft report/i })).toBeTruthy();
  });

  it('⭐ folds the log over the CREATED count, not over the running one', async () => {
    // The failure this pins does not exist yet and cannot be seen from the screen today: nothing
    // writes back into the local mob register, so its `headCount` is still the created count and
    // folding over it happens to give the right answer. When PowerSync hydrates `mobs` in Phase 3
    // the register will hold the SERVER's current count, and a fold over that adds every tally a
    // second time — 300 head, 9 lambs, and a device that says 318 while the server says 309, on
    // every counted mob at once and with nothing on screen to suggest anything went wrong.
    //
    // So the row here is shaped the way a hydrated one will be: the baseline where the fold starts,
    // and a `headCount` the server has already advanced past it.
    cachedSession();
    window.localStorage.setItem(
      MOBS_KEY,
      JSON.stringify([
        {
          id: MOB_ID,
          farmId: FARM_ID,
          name: 'Flock A',
          species: 'sheep',
          landUnitId: null,
          enterpriseId: FLOCK.id,
          headCount: 309,
          initialHeadCount: 300,
        },
      ]),
    );
    seedTallies([
      {
        id: '0190f3a0-0000-7000-8000-00000000c001',
        farmId: FARM_ID,
        mobId: MOB_ID,
        occurredAt: '2026-07-20T10:00:00.000Z',
        reason: 'birth',
        count: 9,
        delta: 9,
      },
    ]);
    window.history.pushState({}, '', '/animals/groups/count');
    render(<App />);

    await userEvent.click(screen.getByRole('button', { name: /flock a/i }));

    expect(screen.getByText('309')).toBeTruthy();
    expect(screen.queryByText('318')).toBeNull();
  });

  it('⭐ refuses to tally a DIPPED flock to the abattoir, at capture and offline', async () => {
    // The last SEV-1. Dip the flock Monday; Tuesday, no signal, tally forty to slaughter. Without
    // this the screen said "saved — 260 head", the truck loaded, and the server's refusal arrived
    // on Friday's flush as a 400 that FR-009 correctly sets aside forever — days after the only
    // moment anyone could act on it. The individual sale path has been guarded at capture since
    // the health slice; this is the path where the exposure is worse, because a flock run by head
    // count is the smallholder's.
    cachedSession();
    seedFlock();
    seedDip();
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/groups/count');
    render(<App />);

    await user.click(screen.getByRole('button', { name: /flock a/i }));
    await user.click(screen.getByRole('button', { name: /^slaughtered$/i }));
    await user.type(screen.getByLabelText(/how many/i), '40');

    // Says no AND says when.
    expect(screen.getByText(/cannot go for slaughter or sale yet/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^save$/i }).hasAttribute('disabled')).toBe(true);
    expect(storedTallies()).toHaveLength(0);
  });

  it('still lets a dipped flock record a DEATH — a dead sheep is not food', async () => {
    // The bound. The guard exists to keep meat out of the food chain, not to stop a farmer
    // recording what happened. Refusing to record a fact is worse than recording it.
    cachedSession();
    seedFlock();
    seedDip();
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/groups/count');
    render(<App />);

    await user.click(screen.getByRole('button', { name: /flock a/i }));
    await user.click(screen.getByRole('button', { name: /^died$/i }));
    await user.type(screen.getByLabelText(/how many/i), '3');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(storedTallies()).toHaveLength(1);
  });

  it('⭐ refuses a flock tally when ONE animal in it was treated individually', async () => {
    // A mob may hold individually-registered animals, and their treatment stores `mob_id = NULL`.
    // The client guard filtered on the mob alone, so it previewed CLEAR while the server — which
    // reads both routes — correctly refused. The two must answer the same question; a capture-time
    // guard narrower than the one that actually refuses is the failure it was built to prevent.
    cachedSession();
    seedFlock();
    window.localStorage.setItem(
      HERD_KEY,
      JSON.stringify([
        {
          id: ANIMAL_ID,
          farmId: FARM_ID,
          species: 'sheep',
          sex: 'female',
          breed: null,
          status: 'alive',
          mobId: MOB_ID,
        },
      ]),
    );
    window.localStorage.setItem(
      PRODUCTS_KEY,
      JSON.stringify([
        {
          id: PRODUCT_ID,
          name: 'Terramycin LA',
          registrationNumber: 'G1234 Act 36/1947',
          species: ['sheep'],
          meatWithdrawalDays: 28,
          milkWithdrawalHours: null,
          route: 'intramuscular',
        },
      ]),
    );
    window.localStorage.setItem(
      HEALTH_KEY,
      JSON.stringify([
        {
          id: '0190f3a0-0000-7000-8000-00000000f002',
          farmId: FARM_ID,
          animalId: ANIMAL_ID,
          mobId: null,
          kind: 'treatment',
          occurredAt: new Date().toISOString(),
          administeredOn: farmToday(),
          productId: PRODUCT_ID,
        },
      ]),
    );
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/groups/count');
    render(<App />);

    await user.click(screen.getByRole('button', { name: /flock a/i }));
    await user.click(screen.getByRole('button', { name: /^sold$/i }));
    await user.type(screen.getByLabelText(/how many/i), '40');

    expect(screen.getByText(/cannot go for slaughter or sale yet/i)).toBeTruthy();
    expect(storedTallies()).toHaveLength(0);
  });

  it('⭐ lets a BACK-DATED tally be recorded against the flock as it stood THAT day', async () => {
    // The client mirror of the as-at cut the server already got. The screen folded the WHOLE local
    // log and then judged a past capture against the present, so: sell the whole flock on the 20th,
    // then remember five ewes died on the 18th — today's count is 0, the projection is −5, Save is
    // disabled, and a true fact cannot be recorded at all. Refusing at capture is worse than a 400,
    // because a 400 at least leaves a queued record to recover.
    cachedSession();
    seedFlock();
    seedTallies([
      {
        id: '0190f3a0-0000-7000-8000-00000000a010',
        farmId: FARM_ID,
        mobId: MOB_ID,
        occurredAt: '2026-07-20T12:00:00.000Z',
        reason: 'sale',
        count: 300,
        delta: -300,
      },
    ]);
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/groups/count');
    render(<App />);

    await user.click(screen.getByRole('button', { name: /flock a/i }));
    await user.click(screen.getByRole('button', { name: /^died$/i }));
    await user.clear(screen.getByLabelText(/what day/i));
    await user.type(screen.getByLabelText(/what day/i), '2026-07-18');
    await user.type(screen.getByLabelText(/how many/i), '5');

    // The flock stood at 300 on the 18th, so five dying is an ordinary fact.
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect(storedTallies().some((t) => t['count'] === 5 && t['delta'] === -5)).toBe(true);
  });

  it('⭐ keeps a SECOND tally on the same mob on the same day, with its own id', async () => {
    // SEV-1 (§2f). The capture id was memoised on `[selectedId, day]`, and `reset()` clears
    // neither — it re-sets `day` to the value it already had. So a second save on the same mob on
    // the same day REUSED the first id: the store appended it, but the flush's `sentLog.has` skips
    // a duplicate id forever, so a 40-head food-chain disposal captured second existed on one phone
    // and reached no one. The same reused id also poisoned the as-at fold (`id < captureId`), which
    // dropped the first tally from the second's baseline — the banner said 260 while the truth was
    // 257. Both captures say "saved"; both must be distinct records the flush can send.
    cachedSession();
    seedFlock();
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/groups/count');
    render(<App />);

    await user.click(screen.getByRole('button', { name: /flock a/i }));
    await user.click(screen.getByRole('button', { name: /^died$/i }));
    await user.type(screen.getByLabelText(/how many/i), '3');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await user.click(screen.getByRole('button', { name: /^sold$/i }));
    await user.type(screen.getByLabelText(/how many/i), '40');

    // The second capture is judged against the flock AFTER the first death: 297 → 257, not 300 → 260.
    expect(screen.getByText('257')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /^save$/i }));

    const saved = storedTallies();
    expect(saved).toHaveLength(2);
    // Two distinct ids, or the flush sends one and silently drops the other.
    expect(new Set(saved.map((t) => t['id'])).size).toBe(2);
  });

  it('⭐ writes BOTH halves of a transfer, carrying the withholding to the group they join', async () => {
    // §2.3b. With no transfer reason, splitting a dipped flock had to be expressed as a sale out
    // and a purchase in — which trips the food-chain guard on the way out (nothing was sold) and
    // LAUNDERS the withholding on the way in, because head arriving by purchase is unconditionally
    // clear. A counted flock has no animal rows, so there is nothing else anywhere to carry it.
    cachedSession();
    seedTwoFlocks();
    seedDip();
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/groups/count');
    render(<App />);

    await user.click(screen.getByRole('button', { name: /flock a/i }));
    await user.click(screen.getByRole('button', { name: /moved to another group/i }));
    await user.type(screen.getByLabelText(/how many/i), '40');
    await user.selectOptions(screen.getByLabelText(/which group did they go to/i), OTHER_MOB_ID);

    // Said out loud, because a farmer who believes a withholding is escaped by changing camps will
    // change camps. The move is NOT refused — nothing goes into the food chain — but it says so.
    expect(screen.getByText(/it moves with them/i)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /^save$/i }));

    const saved = storedTallies();
    expect(saved).toHaveLength(2);
    // Distinct ids, or the flush treats the second as a duplicate of the first and sends one.
    expect(new Set(saved.map((t) => t['id'])).size).toBe(2);

    const out = saved.find((t) => t['reason'] === 'transfer_out');
    const into = saved.find((t) => t['reason'] === 'transfer_in');
    expect(out).toMatchObject({ mobId: MOB_ID, counterpartMobId: OTHER_MOB_ID, delta: -40 });
    // ⭐ The half that closes the hole. Without it the destination is clear the moment the head
    // walk through the gate, on this device as well as on the server.
    expect(into).toMatchObject({ mobId: OTHER_MOB_ID, counterpartMobId: MOB_ID, delta: 40 });
    expect(typeof into?.['carriedWithholdUntil']).toBe('string');
  });

  it('⭐ refuses to send the joined group for slaughter while the carried withholding runs', async () => {
    // The device's own guard, not the server's. The point of carrying the date locally is that the
    // refusal reaches the person who can still act on it — a server-only rule arrives on Friday.
    cachedSession();
    seedTwoFlocks();
    seedDip();
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/groups/count');
    const { unmount } = render(<App />);

    await user.click(screen.getByRole('button', { name: /flock a/i }));
    await user.click(screen.getByRole('button', { name: /moved to another group/i }));
    await user.type(screen.getByLabelText(/how many/i), '40');
    await user.selectOptions(screen.getByLabelText(/which group did they go to/i), OTHER_MOB_ID);
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    unmount();
    window.history.pushState({}, '', '/animals/groups/count');
    render(<App />);

    await user.click(screen.getByRole('button', { name: /flock b/i }));
    await user.click(screen.getByRole('button', { name: /^slaughtered$/i }));
    await user.type(screen.getByLabelText(/how many/i), '10');

    expect(screen.getByText(/cannot go for slaughter or sale yet/i)).toBeTruthy();
    expect((screen.getByRole('button', { name: /^save$/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('records a purchase with no declared withdrawal as unknown history, never a guess', async () => {
    // Absent is the DEFAULT and it means something. Inventing a period for an animal whose
    // treatment nobody here witnessed is the fabricated-regulated-number defect with extra steps.
    cachedSession();
    seedFlock();
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/groups/count');
    render(<App />);

    await user.click(screen.getByRole('button', { name: /flock a/i }));
    await user.click(screen.getByRole('button', { name: /^bought$/i }));
    await user.type(screen.getByLabelText(/how many/i), '12');

    // The field is offered and the blank is explained, rather than the app quietly deciding.
    expect(screen.getByLabelText(/withdrawal the seller declared/i)).toBeTruthy();
    expect(screen.getByText(/recorded as unknown history/i)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /^save$/i }));

    const saved = storedTallies();
    expect(saved).toHaveLength(1);
    expect(saved[0]).not.toHaveProperty('declaredWithdrawalUntil');
  });

  it('does not offer a group that is managed as individual animals', async () => {
    // head_count is null: its number comes from counting the animal rows, and a tally here would
    // start a second count of the same sheep.
    cachedSession();
    seedFlock(null);
    window.history.pushState({}, '', '/animals/groups/count');
    render(<App />);

    expect(screen.queryByRole('button', { name: /flock a/i })).toBeNull();
    expect(screen.getByText(/no group here is managed by a head count yet/i)).toBeTruthy();
  });

  it('is not offered from the animals screen when there is no counted group to change', async () => {
    cachedSession();
    seedFlock(null);
    window.history.pushState({}, '', '/animals');
    render(<App />);

    expect(screen.queryByRole('link', { name: /change a group’s numbers/i })).toBeNull();
  });
});
