/**
 * The outbox flush, as the farmer's day actually goes: captures are made in the veld with no
 * signal and sit safely on the phone; back in range they go up on their own, and the strip says
 * so. This is the first test in the codebase where BOTH layers run together — the local capture
 * stores and the `apps/api` write path — so it is where the offline-first promise is proved end to
 * end rather than one half at a time.
 *
 * These seed `localStorage` (a session and some captures) and render the real `<App/>`, the same
 * boot path a reload uses, then stub `fetch` to stand in for the server. The invariants pinned
 * here are the ones a lost row would hide: the animal is sent BEFORE the events that reference it,
 * a refusal leaves the whole queue intact, a cold start does not re-send what already went, and
 * nothing at all leaves the device while offline.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { schemas } from '@werf/core';
import { App } from '../App';

const SESSION_KEY = 'werf-session';
const FARM_ID = '0190f3a0-0000-7000-8000-0000000000f1';
const ANIMAL_ID = '0190f3a0-0000-7000-8000-0000000000a1';
const WEIGHT_ID = '0190f3a0-0000-7000-8000-0000000000e1';
const DEATH_ID = '0190f3a0-0000-7000-8000-0000000000e2';
const MOB_ID = '0190f3a0-0000-7000-8000-0000000000b1';
const DIP_ID = '0190f3a0-0000-7000-8000-0000000000c1';
const TALLY_ID = '0190f3a0-0000-7000-8000-0000000000c2';
const MOVE_ID = '0190f3a0-0000-7000-8000-0000000000c3';

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

/** A cached, signed-in cattle farm. `withToken: false` models a session whose access token is
 *  not usable — the flush then holds everything as pending rather than sending. */
function cachedSession(withToken = true): void {
  const payload = {
    ...(withToken ? { accessToken: 'access-token' } : {}),
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

/** Seed the local stores the way the capture screens would have, offline. */
function seedCaptures(): void {
  const animal = schemas.newAnimalSchema.parse({
    id: ANIMAL_ID,
    farmId: FARM_ID,
    species: 'cattle',
    sex: 'female',
  });
  window.localStorage.setItem(`werf-herd:${FARM_ID}`, JSON.stringify([animal]));
  window.localStorage.setItem(
    `werf-weights:${FARM_ID}`,
    JSON.stringify([
      {
        id: WEIGHT_ID,
        farmId: FARM_ID,
        animalId: ANIMAL_ID,
        kg: 415,
        method: 'scale',
        occurredAt: '2026-07-20T06:00:00.000Z',
      },
    ]),
  );
  window.localStorage.setItem(
    `werf-events:${FARM_ID}`,
    JSON.stringify([
      {
        id: DEATH_ID,
        farmId: FARM_ID,
        animalId: ANIMAL_ID,
        type: 'death',
        status: 'dead',
        occurredAt: '2026-07-22T06:00:00.000Z',
        cause: 'Snakebite',
      },
    ]),
  );
}

/**
 * One offline window in which a flock is dipped, an animal is walked, and head is tallied OUT of
 * that flock to the abattoir — captured in the order a farmer does them, all still pending.
 */
function seedDoseThenDisposal(): void {
  window.localStorage.setItem(
    `werf-mobs:${FARM_ID}`,
    JSON.stringify([
      {
        id: MOB_ID,
        farmId: FARM_ID,
        name: 'Flock A',
        species: 'cattle',
        landUnitId: null,
        enterpriseId: null,
        headCount: 300,
        initialHeadCount: 300,
      },
    ]),
  );
  window.localStorage.setItem(
    `werf-health:${FARM_ID}`,
    JSON.stringify([
      {
        id: DIP_ID,
        farmId: FARM_ID,
        animalId: null,
        mobId: MOB_ID,
        kind: 'dip',
        occurredAt: '2026-07-20T06:00:00.000Z',
        administeredOn: '2026-07-20',
        productId: '0190f3a0-0000-7000-8000-0000000000d1',
        method: 'plunge',
      },
    ]),
  );
  window.localStorage.setItem(
    `werf-tallies:${FARM_ID}`,
    JSON.stringify([
      {
        id: TALLY_ID,
        farmId: FARM_ID,
        mobId: MOB_ID,
        occurredAt: '2026-07-21T12:00:00.000Z',
        reason: 'slaughter',
        count: 40,
        delta: -40,
      },
    ]),
  );
  window.localStorage.setItem(
    `werf-moves:${FARM_ID}`,
    JSON.stringify([
      {
        id: MOVE_ID,
        farmId: FARM_ID,
        animalId: ANIMAL_ID,
        occurredAt: '2026-07-20T08:00:00.000Z',
        toMobId: MOB_ID,
      },
    ]),
  );
}

/** A fetch that always accepts (201). Returns the mock so a test can inspect the calls. */
function acceptingFetch() {
  return vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
    Promise.resolve({ ok: true, status: 201, json: async () => ({}) } as unknown as Response),
  );
}

/**
 * The paths POSTed, in call order — enough to assert the send sequence.
 *
 * POSTs only, deliberately. The app also makes INBOUND fetches (the regulated product register the
 * crush needs offline, FR-131), and those are not sends: counting every fetch would make "nothing
 * was re-sent" fail the moment the app learned to fetch anything at all, which is a test asserting
 * the implementation rather than the behaviour.
 */
function postedPaths(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls
    .filter((call) => (call[1] as RequestInit | undefined)?.method === 'POST')
    .map((call) => String(call[0]));
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, '', '/');
});

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
  // Restore connectivity for the next test (one test forces it off).
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
});

describe('sending queued captures once there is a signal (FR-009)', () => {
  it('sends the animal before the events that reference it, then says the work is sent', async () => {
    cachedSession();
    seedCaptures();
    const fetchMock = acceptingFetch();
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    // It settles on "sent", not "sync" — the word a farmer must never see.
    expect(await screen.findByText('Saved and sent')).toBeTruthy();
    expect(screen.queryByText(/sync/i)).toBeNull();

    const paths = postedPaths(fetchMock);
    expect(paths.some((p) => p.endsWith('/livestock/animals'))).toBe(true);
    expect(paths.some((p) => p.endsWith('/livestock/weights'))).toBe(true);
    expect(paths.some((p) => p.endsWith('/livestock/deaths'))).toBe(true);

    // The FK order: the animal row goes up before either event that points at it, or the server
    // would reject the event against a row it has never seen.
    const animalAt = paths.findIndex((p) => p.endsWith('/livestock/animals'));
    expect(animalAt).toBeLessThan(paths.findIndex((p) => p.endsWith('/livestock/weights')));
    expect(animalAt).toBeLessThan(paths.findIndex((p) => p.endsWith('/livestock/deaths')));

    // The author is carried as the session's bearer token, never in the body.
    const init = fetchMock.mock.calls[0]![1]!;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer access-token');
  });

  it('⭐ sends the DOSE and the MOVE before the disposal the server must judge against them', async () => {
    // ⭐ A safety ordering, not a foreign-key one — the FK graph is satisfied either way.
    //
    // The server's withdrawal guard is a point-in-time query. It cannot refuse a dose it has not
    // received. With health sent second-to-last, one device could do all of this offline and get a
    // 201: dip the flock Monday, tally forty of it to the abattoir Tuesday, reconnect Friday. The
    // tally arrived first, the guard found no withholding, and the boundary that exists to stop
    // meat inside a withdrawal affirmatively let it through.
    //
    // The move matters for the same reason one level down: membership decides WHICH doses reached
    // which animal, so it has to be on the server before anything is judged against it.
    cachedSession();
    seedCaptures();
    seedDoseThenDisposal();
    const fetchMock = acceptingFetch();
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    expect(await screen.findByText('Saved and sent')).toBeTruthy();

    const paths = postedPaths(fetchMock);
    const at = (suffix: string) => paths.findIndex((p) => p.endsWith(suffix));

    expect(at('/livestock/dips')).toBeGreaterThanOrEqual(0);
    expect(at('/livestock/mob-tallies')).toBeGreaterThanOrEqual(0);
    expect(at('/livestock/moves')).toBeGreaterThanOrEqual(0);

    // The evidence before the act it is read against.
    expect(at('/livestock/dips')).toBeLessThan(at('/livestock/mob-tallies'));
    expect(at('/livestock/moves')).toBeLessThan(at('/livestock/mob-tallies'));
    expect(at('/livestock/dips')).toBeLessThan(at('/livestock/deaths'));

    // And the foreign-key rule still holds underneath it.
    expect(at('/livestock/mobs')).toBeLessThan(at('/livestock/dips'));
    expect(at('/livestock/animals')).toBeLessThan(at('/livestock/moves'));
  });

  it('⭐ holds the disposal back when the dose it is judged against is refused this round', async () => {
    // §2f SEV-2. Ordering evidence before the act only helps if the act waits for evidence that
    // DID NOT LAND. The dip is refused (409) and set aside — and the old flush then walked straight
    // on to the tally, which the server accepted, because the withholding it should have been
    // judged against was never received. Forty head to the abattoir inside a withdrawal, with the
    // one guard that exists to stop it answering 201. The tally must be held, not overtake the dose.
    cachedSession();
    seedDoseThenDisposal();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const refused = String(input).endsWith('/livestock/dips') && init?.method === 'POST';
      return refused
        ? ({
            ok: false,
            status: 409,
            json: async () => ({ code: 'CONFLICT', message: 'already recorded' }),
          } as unknown as Response)
        : ({ ok: true, status: 201, json: async () => ({}) } as unknown as Response);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    // The dose is what needs the farmer; the tally is not refused, just still waiting.
    expect(await screen.findByText(/^1 not sent — needs your attention/)).toBeTruthy();

    const paths = postedPaths(fetchMock);
    // The dose was attempted and refused; the tally was HELD behind it and never posted this round.
    expect(paths.some((p) => p.endsWith('/livestock/dips'))).toBe(true);
    expect(paths.some((p) => p.endsWith('/livestock/mob-tallies'))).toBe(false);

    // Nothing discarded: the tally is still on the device and absent from the sent-log, so the next
    // reconnect sends it once the dose lands or the farmer clears the refusal.
    expect(window.localStorage.getItem(`werf-tallies:${FARM_ID}`)).toContain(TALLY_ID);
    const sent = window.localStorage.getItem(`werf-sent:${FARM_ID}`) ?? '';
    expect(sent).not.toContain(TALLY_ID);
    expect(sent).not.toContain(DIP_ID);
  });

  it('⭐ holds a tally when a member carried a refused dose in from ANOTHER mob', async () => {
    // The gap the FIFTH pass found in all three agents. The dip is on the DIP CAMP; an ox is moved
    // out of it into the sale mob; the sale mob is tallied to slaughter. The dip's subject is the
    // dip camp, not the sale mob — so a `guardedBy` of `[tally.mobId]` alone did not intersect the
    // taint, and the tally posted while the withholding evidence (refused this round) never landed.
    // The held set must be the FULL set the mob guard reads: the mob plus every member standing in
    // it and their mob histories, exactly as `meatWithdrawalForMob` refuses it at capture.
    const DIP_CAMP = '0190f3a0-0000-7000-8000-0000000000b2';
    cachedSession();
    window.localStorage.setItem(
      `werf-mobs:${FARM_ID}`,
      JSON.stringify([
        { id: DIP_CAMP, farmId: FARM_ID, name: 'Dip camp', species: 'cattle', headCount: null },
        {
          id: MOB_ID,
          farmId: FARM_ID,
          name: 'Ossies',
          species: 'cattle',
          headCount: 40,
          initialHeadCount: 40,
        },
      ]),
    );
    // The ox: individually registered, FIRST captured in the dip camp.
    window.localStorage.setItem(
      `werf-herd:${FARM_ID}`,
      JSON.stringify([
        schemas.newAnimalSchema.parse({
          id: ANIMAL_ID,
          farmId: FARM_ID,
          species: 'cattle',
          sex: 'male',
          mobId: DIP_CAMP,
        }),
      ]),
    );
    window.localStorage.setItem(
      `werf-vet-products:${FARM_ID}`,
      JSON.stringify([
        {
          id: '0190f3a0-0000-7000-8000-0000000000d1',
          name: 'Tickaway',
          registrationNumber: 'G4321 Act 36/1947',
          species: ['cattle'],
          meatWithdrawalDays: 28,
          milkWithdrawalHours: null,
          route: 'topical',
        },
      ]),
    );
    // Dip the DIP CAMP (mob dose, animalId null). Move the ox into the sale mob. Tally the sale mob.
    window.localStorage.setItem(
      `werf-health:${FARM_ID}`,
      JSON.stringify([
        {
          id: DIP_ID,
          farmId: FARM_ID,
          animalId: null,
          mobId: DIP_CAMP,
          kind: 'dip',
          occurredAt: '2026-07-20T06:00:00.000Z',
          administeredOn: '2026-07-20',
          productId: '0190f3a0-0000-7000-8000-0000000000d1',
          method: 'plunge',
        },
      ]),
    );
    window.localStorage.setItem(
      `werf-moves:${FARM_ID}`,
      JSON.stringify([
        {
          id: MOVE_ID,
          farmId: FARM_ID,
          animalId: ANIMAL_ID,
          occurredAt: '2026-07-22T08:00:00.000Z',
          toMobId: MOB_ID,
        },
      ]),
    );
    window.localStorage.setItem(
      `werf-tallies:${FARM_ID}`,
      JSON.stringify([
        {
          id: TALLY_ID,
          farmId: FARM_ID,
          mobId: MOB_ID,
          occurredAt: '2026-07-23T12:00:00.000Z',
          reason: 'slaughter',
          count: 10,
          delta: -10,
        },
      ]),
    );
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const refused = String(input).endsWith('/livestock/dips') && init?.method === 'POST';
      return refused
        ? ({
            ok: false,
            status: 409,
            json: async () => ({ code: 'CONFLICT', message: 'already recorded' }),
          } as unknown as Response)
        : ({ ok: true, status: 201, json: async () => ({}) } as unknown as Response);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    expect(await screen.findByText(/^1 not sent — needs your attention/)).toBeTruthy();

    const paths = postedPaths(fetchMock);
    // The move landed; the dip was refused; the tally is HELD because the ox carried the dip camp's
    // withholding into the sale mob.
    expect(paths.some((p) => p.endsWith('/livestock/moves'))).toBe(true);
    expect(paths.some((p) => p.endsWith('/livestock/mob-tallies'))).toBe(false);
    const sent = window.localStorage.getItem(`werf-sent:${FARM_ID}`) ?? '';
    expect(sent).not.toContain(TALLY_ID);
  });

  it('⭐ holds a slaughter when the TRANSFER that withholds its flock was refused', async () => {
    // The same defect one route along. §2.3b made a tally EVIDENCE as well as an act: head arriving
    // by `transfer_in` carries a withholding onto the mob it joins, and for a counted flock — no
    // `animals` rows, nothing else to attach a dose to — it is the only thing that can. The transfer
    // declared no `provides`, so a refused one tainted nothing and the slaughter behind it posted to
    // a server that had never heard of the arrival. 201, and dipped meat on the truck.
    const SOURCE = '0190f3a0-0000-7000-8000-0000000000b3';
    const TRANSFER_ID = '0190f3a0-0000-7000-8000-0000000000a9';
    cachedSession();
    window.localStorage.setItem(
      `werf-mobs:${FARM_ID}`,
      JSON.stringify([
        {
          id: SOURCE,
          farmId: FARM_ID,
          name: 'Dip camp',
          species: 'sheep',
          headCount: 200,
          initialHeadCount: 200,
        },
        {
          id: MOB_ID,
          farmId: FARM_ID,
          name: 'Sale flock',
          species: 'sheep',
          headCount: 40,
          initialHeadCount: 40,
        },
      ]),
    );
    window.localStorage.setItem(
      `werf-tallies:${FARM_ID}`,
      JSON.stringify([
        // Captured Monday: forty head walk in from the dipped camp, carrying its withholding.
        {
          id: TRANSFER_ID,
          farmId: FARM_ID,
          mobId: MOB_ID,
          occurredAt: '2026-07-22T12:00:00.000Z',
          reason: 'transfer_in',
          count: 40,
          delta: 40,
          counterpartMobId: SOURCE,
          carriedWithholdUntil: '2026-08-17',
        },
        // Captured Tuesday: ten of them to the abattoir.
        {
          id: TALLY_ID,
          farmId: FARM_ID,
          mobId: MOB_ID,
          occurredAt: '2026-07-23T12:00:00.000Z',
          reason: 'slaughter',
          count: 10,
          delta: -10,
        },
      ]),
    );
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      // Both halves go to the same endpoint, so the refusal is chosen on the record, not the path.
      const body = typeof init?.body === 'string' ? init.body : '';
      const refused = body.includes('transfer_in');
      return refused
        ? ({
            ok: false,
            status: 409,
            json: async () => ({ code: 'CONFLICT', message: 'the source group is short' }),
          } as unknown as Response)
        : ({ ok: true, status: 201, json: async () => ({}) } as unknown as Response);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    expect(await screen.findByText(/^1 not sent — needs your attention/)).toBeTruthy();

    const sent = window.localStorage.getItem(`werf-sent:${FARM_ID}`) ?? '';
    expect(sent).not.toContain(TALLY_ID);
    expect(sent).not.toContain(TRANSFER_ID);
    // And the capture is KEPT, never dropped: a 4xx sets it aside for a later round.
    expect(window.localStorage.getItem(`werf-tallies:${FARM_ID}`)).toContain(TALLY_ID);
  });

  it('⭐ holds the arrival — and the slaughter behind it — when the DEPARTURE was refused', async () => {
    // §2m #1. A move is two events because a tally has one subject mob and one delta, and until the
    // batch id linked them they were two unrelated queue items. The source is short (another phone
    // sold the flock while this one was in a dead zone), so the server refuses the `transfer_out` —
    // and the `transfer_in` landed anyway. The destination gained forty head that no group ever
    // lost, and the count on the tile was wrong on the server in a way no later capture repairs.
    //
    // The second half of this test is the sharper one: a HELD item must taint what it provides, or
    // the slaughter behind the held arrival posts to a server that never heard of the arrival.
    // ⚠️ Distinct from every id at the top of this file. `TALLY_ID` is `…c2` and `DIP_ID` is `…c1`,
    // and seeding a second capture under one of those makes an assertion fire under the wrong name —
    // which is what happened here while this test was being written, and it read as a defect in the
    // flush rather than as a duplicate fixture id.
    const SOURCE = '0190f3a0-0000-7000-8000-0000000000b4';
    const BATCH = '0190f3a0-0000-7000-8000-0000000000ba';
    const OUT_ID = '0190f3a0-0000-7000-8000-0000000000d7';
    const IN_ID = '0190f3a0-0000-7000-8000-0000000000d8';
    cachedSession();
    window.localStorage.setItem(
      `werf-mobs:${FARM_ID}`,
      JSON.stringify([
        {
          id: SOURCE,
          farmId: FARM_ID,
          name: 'Dip camp',
          species: 'sheep',
          headCount: 200,
          initialHeadCount: 200,
        },
        {
          id: MOB_ID,
          farmId: FARM_ID,
          name: 'Sale flock',
          species: 'sheep',
          headCount: 40,
          initialHeadCount: 40,
        },
      ]),
    );
    window.localStorage.setItem(
      `werf-tallies:${FARM_ID}`,
      JSON.stringify([
        // Deliberately stored in the order the SCREEN writes them, and deliberately with the arrival
        // first in capture order for the slaughter — the queue's ordering is what is under test, not
        // the order the device happened to append in.
        {
          id: IN_ID,
          farmId: FARM_ID,
          mobId: MOB_ID,
          occurredAt: '2026-07-22T12:00:00.000Z',
          reason: 'transfer_in',
          count: 40,
          delta: 40,
          counterpartMobId: SOURCE,
          batchId: BATCH,
          carriedWithholdUntil: '2026-08-17',
        },
        {
          id: OUT_ID,
          farmId: FARM_ID,
          mobId: SOURCE,
          occurredAt: '2026-07-22T12:00:00.000Z',
          reason: 'transfer_out',
          count: 40,
          delta: -40,
          counterpartMobId: MOB_ID,
          batchId: BATCH,
        },
        {
          id: TALLY_ID,
          farmId: FARM_ID,
          mobId: MOB_ID,
          occurredAt: '2026-07-23T12:00:00.000Z',
          reason: 'slaughter',
          count: 10,
          delta: -10,
        },
      ]),
    );
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : '';
      // Both halves go to the same endpoint, so the refusal is chosen on the record, not the path.
      return body.includes('transfer_out')
        ? ({
            ok: false,
            status: 409,
            json: async () => ({ code: 'CONFLICT', message: 'the source group is short' }),
          } as unknown as Response)
        : ({ ok: true, status: 201, json: async () => ({}) } as unknown as Response);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    // One REFUSAL — the departure. The other two are held, which is pending and not the farmer's
    // problem to solve: nothing was rejected about them.
    expect(await screen.findByText(/^1 not sent — needs your attention/)).toBeTruthy();

    const sent = window.localStorage.getItem(`werf-sent:${FARM_ID}`) ?? '';
    expect(sent).not.toContain(OUT_ID);
    expect(sent).not.toContain(IN_ID);
    expect(sent).not.toContain(TALLY_ID);
    // Every capture kept. A 4xx sets the departure aside for a later round; the two behind it are
    // simply still pending, and the next reconnect sends them once the source is repaired.
    const stored = window.localStorage.getItem(`werf-tallies:${FARM_ID}`) ?? '';
    expect(stored).toContain(OUT_ID);
    expect(stored).toContain(IN_ID);
    expect(stored).toContain(TALLY_ID);
  });

  it('⭐ holds the SECOND departure of a chain when the first arrival never landed', async () => {
    // The eighth pass, and the fifth widening of this mechanism. `transfer_out`, `death` and `theft`
    // declared no `guardedBy` at all, so they were sent regardless of whether the arrival that
    // funded the head had landed. The seventh pass fixed the chain in the SORT; the HOLD path
    // reached the same harm.
    //
    // A→B→C offline. Another phone recounts A, so the server legitimately refuses `out_A`. `in_B` is
    // held (correct, it is linked). `out_B` then went ANYWAY, to a server whose fold of B has no head
    // in it — and the refusal it earns says "count the group and record what you find" while
    // `/not-sent` says "Record it again". A RECOUNT RESETS, so following either instruction corrupts
    // B's count permanently. That is why this is not merely a redundant round trip.
    //
    // ⚠️ Every id below is distinct from every other fixture in this file — a duplicate once made an
    // assertion fire under the wrong name and read as a flush defect.
    const A = '0190f3a0-0000-7000-8000-0000000000b5';
    const B = '0190f3a0-0000-7000-8000-0000000000b6';
    const C = '0190f3a0-0000-7000-8000-0000000000b7';
    const BATCH1 = '0190f3a0-0000-7000-8000-0000000000bb';
    const BATCH2 = '0190f3a0-0000-7000-8000-0000000000bc';
    const OUT_A = '0190f3a0-0000-7000-8000-0000000000d9';
    const IN_B = '0190f3a0-0000-7000-8000-0000000000da';
    const OUT_B = '0190f3a0-0000-7000-8000-0000000000db';
    const IN_C = '0190f3a0-0000-7000-8000-0000000000dc';
    cachedSession();
    window.localStorage.setItem(
      `werf-mobs:${FARM_ID}`,
      JSON.stringify([
        {
          id: A,
          farmId: FARM_ID,
          name: 'Camp A',
          species: 'sheep',
          headCount: 100,
          initialHeadCount: 100,
        },
        {
          id: B,
          farmId: FARM_ID,
          name: 'Camp B',
          species: 'sheep',
          headCount: 0,
          initialHeadCount: 0,
        },
        {
          id: C,
          farmId: FARM_ID,
          name: 'Camp C',
          species: 'sheep',
          headCount: 0,
          initialHeadCount: 0,
        },
      ]),
    );
    window.localStorage.setItem(
      `werf-tallies:${FARM_ID}`,
      // Capture order, which is causal: the farmer moved A→B and then B→C.
      JSON.stringify([
        {
          id: OUT_A,
          farmId: FARM_ID,
          mobId: A,
          occurredAt: '2026-07-22T12:00:00.000Z',
          reason: 'transfer_out',
          count: 40,
          delta: -40,
          counterpartMobId: B,
          batchId: BATCH1,
        },
        {
          id: IN_B,
          farmId: FARM_ID,
          mobId: B,
          occurredAt: '2026-07-22T12:00:00.000Z',
          reason: 'transfer_in',
          count: 40,
          delta: 40,
          counterpartMobId: A,
          batchId: BATCH1,
        },
        {
          id: OUT_B,
          farmId: FARM_ID,
          mobId: B,
          occurredAt: '2026-07-23T12:00:00.000Z',
          reason: 'transfer_out',
          count: 20,
          delta: -20,
          counterpartMobId: C,
          batchId: BATCH2,
        },
        {
          id: IN_C,
          farmId: FARM_ID,
          mobId: C,
          occurredAt: '2026-07-23T12:00:00.000Z',
          reason: 'transfer_in',
          count: 20,
          delta: 20,
          counterpartMobId: B,
          batchId: BATCH2,
        },
      ]),
    );
    // Only the FIRST departure is refused, chosen on the record's own id so the other departure is
    // not caught by the same rule — the whole point is what happens to the one behind it.
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : '';
      return body.includes(OUT_A)
        ? ({
            ok: false,
            status: 409,
            json: async () => ({ code: 'CONFLICT', message: 'the source group is short' }),
          } as unknown as Response)
        : ({ ok: true, status: 201, json: async () => ({}) } as unknown as Response);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    // One REFUSAL — `out_A`. The three behind it are held, which is pending, not the farmer's fault.
    //
    // ⛔ THE SECOND HALF OF THIS LINE IS THE NINTH PASS'S FIX AND IT USED TO BE ABSENT. The strip
    // returned early on the refusal count, so the pending total vanished and this exact scenario —
    // one refusal, three captures stranded behind it — read as "1 not sent" with the other three
    // counted nowhere a farmer could see. Held is a third state; a hold nobody can see is a lost
    // record. The count needing attention is still first, because it is the only one that is a task.
    expect(await screen.findByText('1 not sent — needs your attention · 3 to send')).toBeTruthy();

    const sent = window.localStorage.getItem(`werf-sent:${FARM_ID}`) ?? '';
    expect(sent).not.toContain(OUT_A);
    expect(sent).not.toContain(IN_B);
    // ⭐ THE ASSERTION THIS TEST EXISTS FOR. Before the head-count subject this went out and earned a
    // destructive refusal.
    expect(sent).not.toContain(OUT_B);
    expect(sent).not.toContain(IN_C);

    // And nothing was dropped — the queue keeps every capture for the next round.
    const stored = window.localStorage.getItem(`werf-tallies:${FARM_ID}`) ?? '';
    for (const id of [OUT_A, IN_B, OUT_B, IN_C]) expect(stored).toContain(id);
  });

  it('⭐⭐ SENDS a death the mob can fund, even though an unrelated increase on it was refused', async () => {
    // ⛔ THE NINTH PASS'S SEV-2, AND THE BOUND THE EIGHTH PASS HAD NO TEST FOR. Two agents found it
    // independently; §2q claimed "all 14 pre-existing outbox tests still pass, which is the check
    // that no false hold crept in", and not one of those tests refused an INCREASE — so the check
    // was structurally incapable of detecting this. An assertion that cannot fail, one level up.
    //
    // The first fix made a decrease `guardedBy: ['head:<mob>']` and every increase provide it, so a
    // decrease was held whenever ANY increase on the mob was tainted — related or not. Here the mob
    // has 100 head standing on the server. The purchase of 10 is refused on its merits. The three
    // deaths need none of those 10: the server folds 100, takes 3, and returns 201.
    //
    // Held, they would never move. The refusal is permanent by this file's own definition, there is
    // no edit or discard path for a refused capture, and a held item appeared in no surface — so
    // three dead ewes would sit on the phone for ever while the strip said "1 not sent". That is a
    // capture silently lost, which is the same harm as the false pass the hold was added to stop.
    const M = '0190f3a0-0000-7000-8000-0000000000c1';
    const BOUGHT = '0190f3a0-0000-7000-8000-0000000000c2';
    const DIED = '0190f3a0-0000-7000-8000-0000000000c3';
    cachedSession();
    window.localStorage.setItem(
      `werf-mobs:${FARM_ID}`,
      JSON.stringify([
        {
          id: M,
          farmId: FARM_ID,
          name: 'Home camp',
          species: 'sheep',
          headCount: 107,
          // ⭐ The mob is ALREADY on the server with 100 head — the baseline the server folds from.
          initialHeadCount: 100,
        },
      ]),
    );
    window.localStorage.setItem(
      `werf-tallies:${FARM_ID}`,
      JSON.stringify([
        {
          id: BOUGHT,
          farmId: FARM_ID,
          mobId: M,
          occurredAt: '2026-07-22T12:00:00.000Z',
          reason: 'purchase',
          count: 10,
          delta: 10,
        },
        {
          id: DIED,
          farmId: FARM_ID,
          mobId: M,
          occurredAt: '2026-07-23T12:00:00.000Z',
          reason: 'death',
          count: 3,
          delta: -3,
        },
      ]),
    );
    // The mob row is already on the server, so only the two tallies are in flight. Refuse the
    // purchase alone, on its own id, so nothing else is caught by the same rule.
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : '';
      return body.includes(BOUGHT)
        ? ({
            ok: false,
            status: 409,
            json: async () => ({ code: 'CONFLICT', message: 'already recorded' }),
          } as unknown as Response)
        : ({ ok: true, status: 201, json: async () => ({}) } as unknown as Response);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    // Deliberately a REGEX, and matched loosely on purpose: the exact wording differs between the
    // held and the sent case, and the strip's phrasing is the SIBLING test's subject, not this
    // one's. Waiting on the exact string here made the red land on the wording instead of on the
    // assertion below — a test whose failure names the wrong cause is most of the way to a test
    // that cannot fail.
    expect(await screen.findByText(/not sent — needs your attention/)).toBeTruthy();

    const sent = window.localStorage.getItem(`werf-sent:${FARM_ID}`) ?? '';
    expect(sent).not.toContain(BOUGHT);
    // ⭐ THE ASSERTION THIS TEST EXISTS FOR. The death is funded by head the server already holds.
    expect(sent).toContain(DIED);
  });

  it('⭐ still HOLDS a decrease the mob genuinely cannot fund without the refused increase', async () => {
    // The other side of the bound, and the reason the fix is arithmetic rather than a deletion. Same
    // shape as above with one number changed: the camp holds 2 head on the server, not 100. Now the
    // three deaths DO depend on the refused purchase, the server would fold 2, take 3, and refuse
    // with "There are 2 head on file in this group… count the group and record what you find" —
    // whose instruction, followed, RESETS the count and corrupts it permanently.
    //
    // Same guard, opposite answer, decided by the same fold the server runs. A test that only ever
    // asserted the holding direction is what let the over-broad version look correct.
    const M = '0190f3a0-0000-7000-8000-0000000000c5';
    const BOUGHT = '0190f3a0-0000-7000-8000-0000000000c6';
    const DIED = '0190f3a0-0000-7000-8000-0000000000c7';
    cachedSession();
    window.localStorage.setItem(
      `werf-mobs:${FARM_ID}`,
      JSON.stringify([
        {
          id: M,
          farmId: FARM_ID,
          name: 'Small camp',
          species: 'sheep',
          headCount: 9,
          initialHeadCount: 2,
        },
      ]),
    );
    window.localStorage.setItem(
      `werf-tallies:${FARM_ID}`,
      JSON.stringify([
        {
          id: BOUGHT,
          farmId: FARM_ID,
          mobId: M,
          occurredAt: '2026-07-22T12:00:00.000Z',
          reason: 'purchase',
          count: 10,
          delta: 10,
        },
        {
          id: DIED,
          farmId: FARM_ID,
          mobId: M,
          occurredAt: '2026-07-23T12:00:00.000Z',
          reason: 'death',
          count: 3,
          delta: -3,
        },
      ]),
    );
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : '';
      return body.includes(BOUGHT)
        ? ({
            ok: false,
            status: 409,
            json: async () => ({ code: 'CONFLICT', message: 'already recorded' }),
          } as unknown as Response)
        : ({ ok: true, status: 201, json: async () => ({}) } as unknown as Response);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    // One refused, one held — and the held one is COUNTED, which is the visibility half of the fix.
    expect(await screen.findByText('1 not sent — needs your attention · 1 to send')).toBeTruthy();

    const sent = window.localStorage.getItem(`werf-sent:${FARM_ID}`) ?? '';
    expect(sent).not.toContain(BOUGHT);
    expect(sent).not.toContain(DIED);
  });

  it('⭐ NAMES the held capture on /not-sent, so a hold is a thing the farmer can see', async () => {
    // ⛔ The tenth pass's finding, and it is about the ninth pass's own fix. That fix existed to
    // end "a hold nobody can see is a lost record" — and the surface it added, the waiting list on
    // `/not-sent`, was rendered by NO test. `Outbox.test.tsx` asserted the strip COUNT ("· 1 to
    // send") and stopped there, and the e2e `/not-sent` case reaches the empty state. So deleting
    // the `HeldCapturesContext.Provider` wrapper, or the `waiting.length > 0` block, made held
    // captures invisible again with `pnpm verify` fully green — the exact regression the fix was
    // written to prevent, undetectable by the gate that is supposed to prevent it.
    //
    // Same seed as the test above: 2 head on the server, a refused purchase of 10, three deaths
    // that genuinely need it. One refused, one held. This asserts the held one is NAMED, in its
    // own list, in the farmer's words — not merely counted.
    const M = '0190f3a0-0000-7000-8000-0000000000c5';
    const BOUGHT = '0190f3a0-0000-7000-8000-0000000000c6';
    const DIED = '0190f3a0-0000-7000-8000-0000000000c7';
    cachedSession();
    window.localStorage.setItem(
      `werf-mobs:${FARM_ID}`,
      JSON.stringify([
        {
          id: M,
          farmId: FARM_ID,
          name: 'Small camp',
          species: 'sheep',
          headCount: 9,
          initialHeadCount: 2,
        },
      ]),
    );
    window.localStorage.setItem(
      `werf-tallies:${FARM_ID}`,
      JSON.stringify([
        {
          id: BOUGHT,
          farmId: FARM_ID,
          mobId: M,
          occurredAt: '2026-07-22T12:00:00.000Z',
          reason: 'purchase',
          count: 10,
          delta: 10,
        },
        {
          id: DIED,
          farmId: FARM_ID,
          mobId: M,
          occurredAt: '2026-07-23T12:00:00.000Z',
          reason: 'death',
          count: 3,
          delta: -3,
        },
      ]),
    );
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : '';
      return body.includes(BOUGHT)
        ? ({
            ok: false,
            status: 409,
            json: async () => ({ code: 'CONFLICT', message: 'already recorded' }),
          } as unknown as Response)
        : ({ ok: true, status: 201, json: async () => ({}) } as unknown as Response);
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('link', { name: /see what/i }));

    // The held capture is in its OWN list, not mixed into the refusals — it is not the farmer's
    // problem and must not be presented as one.
    const waitingList = await screen.findByRole('list', { name: 'Waiting on one of the above' });
    expect(within(waitingList).getByText(/a count change for/i)).toBeTruthy();
    expect(within(waitingList).getByText('Small camp')).toBeTruthy();

    // ⛔ And the held capture is NOT also in the refusal list, which would blame the farmer for a
    // capture the server has never seen. The refusal list holds exactly ONE item — the purchase
    // the server actually refused — so the count is what carries this claim, not the label (both
    // rows would read "A count change for Small camp"; they name the same mob).
    const refusedList = screen.getByRole('list', { name: 'What needs your attention' });
    expect(within(refusedList).getAllByRole('listitem').length).toBe(1);
    expect(within(refusedList).getByText(/already recorded|already on another/i)).toBeTruthy();
  });

  it('⭐ does not point at an empty list when a hold stands ALONE, with no refusal above it', async () => {
    // Every `guardedBy` hold chains back to a refusal, so for a long time "Waiting on one of the
    // above" was always literally true. `needsHead` broke that: it waits on ARITHMETIC — the
    // server's fold of the group is short of the head this decrease spends — and needs no refusal
    // to exist. The screen then said "The server would not take these as they stand. Fix what it
    // names" above an EMPTY list, and headed the holds "Waiting on one of the above" with nothing
    // above them. A farmer goes looking for work that is not there.
    //
    // Seeded past the capture screen on purpose: `AdjustMobScreen` refuses this at capture, but a
    // queue is not only ever written by the current screen on this device.
    const M = '0190f3a0-0000-7000-8000-0000000000d1';
    const DIED = '0190f3a0-0000-7000-8000-0000000000d2';
    cachedSession();
    window.localStorage.setItem(
      `werf-mobs:${FARM_ID}`,
      JSON.stringify([
        {
          id: M,
          farmId: FARM_ID,
          name: 'Small camp',
          species: 'sheep',
          headCount: 2,
          initialHeadCount: 2,
        },
      ]),
    );
    window.localStorage.setItem(
      `werf-tallies:${FARM_ID}`,
      JSON.stringify([
        {
          id: DIED,
          farmId: FARM_ID,
          mobId: M,
          occurredAt: '2026-07-23T12:00:00.000Z',
          reason: 'death',
          count: 3,
          delta: -3,
        },
      ]),
    );
    // Everything the server IS asked for succeeds — so there is no refusal anywhere.
    const fetchMock = acceptingFetch();
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('link', { name: /see what/i }));

    // The hold is named, under a heading that stands on its own two feet.
    const waitingList = await screen.findByRole('list', { name: 'Waiting to go up' });
    expect(within(waitingList).getByText('Small camp')).toBeTruthy();

    // ⛔ And the screen does NOT tell the farmer to fix something. There is no refusal, so there
    // is no refusal list, no "fix what it names", and no pointer at records that are not there.
    expect(screen.queryByRole('list', { name: 'What needs your attention' })).toBeNull();
    expect(screen.queryByText(/would not take these as they stand/i)).toBeNull();
    expect(screen.queryByText(/sort out what is above/i)).toBeNull();
  });

  it('⭐ sends a CHAINED move A→B→C in one round, without a false refusal on the second leg', async () => {
    // Found by `sync-auditor`, and it was a regression inside the previous session's own fix. That
    // fix lifted every `transfer_out` into the first pass, which inverts the order of a CHAIN: the
    // departure from B was posted before the arrival INTO B had landed, so the server folded B's log,
    // saw no head, and refused with "There are 0 head on file in this group… count the group and
    // record what you find". The capture was perfectly valid.
    //
    // ⭐ Why that is worse than a retry: the `/not-sent` copy tells the farmer to record it again,
    // and a recount RESETS rather than adds. Following the instruction turns a transient ordering
    // artefact into a permanent double-move that no later capture repairs.
    const A = '0190f3a0-0000-7000-8000-0000000000e5';
    const B = '0190f3a0-0000-7000-8000-0000000000e6';
    const C = '0190f3a0-0000-7000-8000-0000000000e7';
    const BATCH_1 = '0190f3a0-0000-7000-8000-0000000000f5';
    const BATCH_2 = '0190f3a0-0000-7000-8000-0000000000f6';
    const OUT_A = '0190f3a0-0000-7000-8000-0000000000d1';
    const IN_B = '0190f3a0-0000-7000-8000-0000000000d2';
    const OUT_B = '0190f3a0-0000-7000-8000-0000000000d3';
    const IN_C = '0190f3a0-0000-7000-8000-0000000000d4';
    cachedSession();
    window.localStorage.setItem(
      `werf-mobs:${FARM_ID}`,
      JSON.stringify(
        [
          { id: A, head: 100 },
          { id: B, head: 0 },
          { id: C, head: 0 },
        ].map((m) => ({
          id: m.id,
          farmId: FARM_ID,
          name: `Flock ${m.id.slice(-1)}`,
          species: 'sheep',
          headCount: m.head,
          initialHeadCount: m.head,
        })),
      ),
    );
    // Captured in the order the screen writes them: each move's departure, then its arrival.
    window.localStorage.setItem(
      `werf-tallies:${FARM_ID}`,
      JSON.stringify(
        [
          {
            id: OUT_A,
            mobId: A,
            reason: 'transfer_out',
            count: 40,
            delta: -40,
            counterpartMobId: B,
            batchId: BATCH_1,
          },
          {
            id: IN_B,
            mobId: B,
            reason: 'transfer_in',
            count: 40,
            delta: 40,
            counterpartMobId: A,
            batchId: BATCH_1,
          },
          {
            id: OUT_B,
            mobId: B,
            reason: 'transfer_out',
            count: 20,
            delta: -20,
            counterpartMobId: C,
            batchId: BATCH_2,
          },
          {
            id: IN_C,
            mobId: C,
            reason: 'transfer_in',
            count: 20,
            delta: 20,
            counterpartMobId: B,
            batchId: BATCH_2,
          },
        ].map((t) => ({ ...t, farmId: FARM_ID, occurredAt: '2026-07-22T12:00:00.000Z' })),
      ),
    );

    const fetchMock = acceptingFetch();
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    expect(await screen.findByText('Saved and sent')).toBeTruthy();

    // ⭐ The assertion is the ORDER, not the outcome. The outcome self-heals: a refused `out_B` is
    // set aside, `in_B` lands, and the next round sends it — so asserting "everything arrived"
    // passes against the broken order too, and would be an assertion that cannot fail. What the
    // farmer actually suffers is the round in between, where `/not-sent` shows a refusal for a
    // capture that was never wrong and tells them to record it again.
    const bodies = fetchMock.mock.calls
      .filter((call) => (call[1] as RequestInit | undefined)?.method === 'POST')
      .map((call) => String((call[1] as RequestInit).body));
    const at = (id: string) => bodies.findIndex((b) => b.includes(id));

    // Each departure before its own arrival — a refused departure must taint the batch first.
    expect(at(OUT_A)).toBeLessThan(at(IN_B));
    expect(at(OUT_B)).toBeLessThan(at(IN_C));
    // ⭐ And the second leg AFTER the arrival that funds it. This is the one the three-pass order
    // broke: `out_B` overtook `in_B`, so the server folded B's log, saw no head, and refused.
    expect(at(IN_B)).toBeLessThan(at(OUT_B));
  });

  it('⭐ keeps every capture when the session cannot be refreshed — invariant 5', async () => {
    // `offline-sync.md` §5 calls this "a two-line mistake that destroys a month of a farmer's work"
    // and says it gets its own test. It did not have one: the behaviour was correct and held by
    // review alone, which is the state a refactor quietly ends. The token has expired while the
    // phone was in a dead zone and the refresh ALSO fails — an expired refresh token, a revoked
    // session, a server that has forgotten this device. Nothing may be dropped: the queue is the
    // farmer's work and the only copy of it.
    cachedSession();
    window.localStorage.setItem(
      `werf-tallies:${FARM_ID}`,
      JSON.stringify([
        {
          id: TALLY_ID,
          farmId: FARM_ID,
          mobId: MOB_ID,
          occurredAt: '2026-07-23T12:00:00.000Z',
          reason: 'death',
          count: 3,
          delta: -3,
        },
      ]),
    );
    const before = window.localStorage.getItem(`werf-tallies:${FARM_ID}`);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const unauthorised = {
        ok: false,
        status: 401,
        json: async () => ({ code: 'UNAUTHORIZED', message: 'token expired' }),
      } as unknown as Response;
      // Both the capture and the refresh behind it are refused.
      return String(input).includes('/auth/refresh') ? unauthorised : unauthorised;
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await screen.findByText(/not sent|to send|sending/i);

    // The capture store is byte-identical, nothing joined the sent-log, and the session was not
    // cleared out from under the queue.
    await waitFor(() => {
      expect(window.localStorage.getItem(`werf-tallies:${FARM_ID}`)).toBe(before);
    });
    expect(window.localStorage.getItem(`werf-sent:${FARM_ID}`) ?? '').not.toContain(TALLY_ID);
    expect(window.localStorage.getItem('werf-session')).toBeTruthy();
  });

  it('does not re-send after a cold start — the sent-log makes a re-flush a no-op', async () => {
    cachedSession();
    seedCaptures();
    const first = acceptingFetch();
    vi.stubGlobal('fetch', first);
    const { unmount } = render(<App />);
    expect(await screen.findByText('Saved and sent')).toBeTruthy();
    expect(postedPaths(first)).toHaveLength(3);

    // Close and reopen the app. Everything was already confirmed sent; nothing should go again.
    unmount();
    const second = acceptingFetch();
    vi.stubGlobal('fetch', second);
    window.history.pushState({}, '', '/');
    render(<App />);

    expect(await screen.findByText('Saved and sent')).toBeTruthy();
    expect(postedPaths(second)).toHaveLength(0);
  });

  it('keeps the whole queue when the server refuses it — nothing is marked sent', async () => {
    cachedSession();
    seedCaptures();
    // The server rejects the first write (a 500). The flush stops and surfaces it.
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: false,
          status: 500,
          json: async () => ({ code: 'SERVER', message: 'boom' }),
        }) as unknown as Response,
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect(await screen.findByText('Not sent — will retry')).toBeTruthy();

    // The captures are untouched on the device, and NOTHING was recorded as sent — so the next
    // reconnect retries the lot. The queue is never discarded to make an error go away.
    expect(window.localStorage.getItem(`werf-herd:${FARM_ID}`)).toContain(ANIMAL_ID);
    expect(window.localStorage.getItem(`werf-weights:${FARM_ID}`)).toContain(WEIGHT_ID);
    expect(window.localStorage.getItem(`werf-sent:${FARM_ID}`)).toBeNull();
  });

  it('sets a refused capture aside and sends the rest — one bad record cannot strand a day of work', async () => {
    cachedSession();
    seedCaptures();
    // The weight is refused on its merits (409) and always will be. It sits between the animal
    // and the death in the send order, so before this was fixed the death — and every capture
    // made after it, for the rest of the phone's life — could never be sent.
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const refused = String(input).endsWith('/livestock/weights') && init?.method === 'POST';
      return refused
        ? ({
            ok: false,
            status: 409,
            json: async () => ({ code: 'CONFLICT', message: 'already recorded' }),
          } as unknown as Response)
        : ({ ok: true, status: 201, json: async () => ({}) } as unknown as Response);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    // The farmer is told the truth: one record needs them, and it does NOT claim a retry will fix
    // it, because it will not.
    expect(await screen.findByText('1 not sent — needs your attention')).toBeTruthy();

    // The death went up even though it queued BEHIND the refused weight.
    const paths = postedPaths(fetchMock);
    expect(paths.some((p) => p.endsWith('/livestock/deaths'))).toBe(true);

    // Nothing was discarded to achieve that: the refused weight is still on the device and still
    // absent from the sent-log, so it is re-tested on every future round.
    expect(window.localStorage.getItem(`werf-weights:${FARM_ID}`)).toContain(WEIGHT_ID);
    const sent = window.localStorage.getItem(`werf-sent:${FARM_ID}`) ?? '';
    expect(sent).toContain(ANIMAL_ID);
    expect(sent).toContain(DEATH_ID);
    expect(sent).not.toContain(WEIGHT_ID);
  });

  it('says WHICH capture the server refused and WHY, and never offers to delete it', async () => {
    // "1 not sent — needs your attention" with nowhere to look is a worry, not a task. The tag is
    // the commonest refusal in the product, and it has an answer nothing generic can give.
    cachedSession();
    seedCaptures();
    window.localStorage.setItem(
      `werf-identifiers:${FARM_ID}`,
      JSON.stringify([
        {
          id: '0190f3a0-0000-7000-8000-0000000000c1',
          farmId: FARM_ID,
          animalId: ANIMAL_ID,
          type: 'visual_tag',
          value: '0417',
          isPrimary: true,
          issuedAt: '2026-07-20T06:00:00.000Z',
        },
      ]),
    );
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const refused = String(input).endsWith('/livestock/identifiers') && init?.method === 'POST';
      return refused
        ? ({
            ok: false,
            status: 409,
            json: async () => ({ code: 'CONFLICT', message: 'already recorded' }),
          } as unknown as Response)
        : ({ ok: true, status: 201, json: async () => ({}) } as unknown as Response);
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('link', { name: /see what/i }));

    // The number on the animal's ear, not a uuid the farmer has never seen anywhere.
    expect(screen.getByText('0417')).toBeTruthy();
    expect(screen.getByText(/already on another animal/i)).toBeTruthy();
    // Nothing is lost, and the screen says so before it lists the problems.
    expect(screen.getByText(/nothing here is lost/i)).toBeTruthy();
    // ⛔ The queue is never discarded — not by the system, and not by a farmer on a bad afternoon.
    expect(screen.queryByRole('button', { name: /delete|discard|remove/i })).toBeNull();
    expect(window.localStorage.getItem(`werf-identifiers:${FARM_ID}`)).toContain('0417');
  });

  it('holds everything locally while offline and sends nothing', async () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
    cachedSession();
    seedCaptures();
    const fetchMock = acceptingFetch();
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    // The reassurance that keeps a farmer from reaching for a paper backup.
    expect(await screen.findByText('Offline — your work is saved')).toBeTruthy();
    expect(fetchMock.mock.calls.length).toBe(0);
    expect(window.localStorage.getItem(`werf-herd:${FARM_ID}`)).toContain(ANIMAL_ID);
  });

  it('shows how many captures are still waiting to be sent', async () => {
    // A session whose access token cannot be used to send yet: online, but the queue is held.
    // The count is real (three captures), not the Phase-1 stub of zero.
    cachedSession(false);
    seedCaptures();
    const fetchMock = acceptingFetch();
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect(await screen.findByText('3 to send')).toBeTruthy();
    expect(fetchMock.mock.calls.length).toBe(0);
  });
});
