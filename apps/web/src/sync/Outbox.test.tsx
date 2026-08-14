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

import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { schemas } from '@werf/core';
import { App } from '../App';
import { getCurrentFakeLocalDatabase, storedCaptures } from '../test-support/local-db';
import { getCurrentFakeBlobStore } from '../test-support/blob-store';

const SESSION_KEY = 'werf-session';
const FARM_ID = '0190f3a0-0000-7000-8000-0000000000f1';
const ANIMAL_ID = '0190f3a0-0000-7000-8000-0000000000a1';
const WEIGHT_ID = '0190f3a0-0000-7000-8000-0000000000e1';
const DEATH_ID = '0190f3a0-0000-7000-8000-0000000000e2';
const MOB_ID = '0190f3a0-0000-7000-8000-0000000000b1';
const DIP_ID = '0190f3a0-0000-7000-8000-0000000000c1';
const TALLY_ID = '0190f3a0-0000-7000-8000-0000000000c2';
const MOVE_ID = '0190f3a0-0000-7000-8000-0000000000c3';
const SALE_ID = '0190f3a0-0000-7000-8000-0000000000e3';

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

/**
 * `capture_records` no longer lives in `window.localStorage` — captures persist through the
 * SQLite-backed store (`packages/sync/src/sqlite-capture-store.ts`, phase-checklists.md 3c), via
 * the fake `test-setup.ts` mocks `getLocalDatabase()` to. This reproduces the OLD
 * `window.localStorage.getItem(key)` value exactly (the same JSON-array-of-records shape), so
 * every `.toContain(id)` / `.toBe(before)` assertion below keeps its original meaning; only the
 * source of the string changes, and every call site is now `await`ed.
 */
async function storedBlob(key: string): Promise<string> {
  return JSON.stringify(await storedCaptures(key));
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
  return (
    fetchMock.mock.calls
      .filter((call) => (call[1] as RequestInit | undefined)?.method === 'POST')
      .map((call) => String(call[0]))
      // Refresh is session maintenance, not a capture being re-sent.
      .filter((path) => !path.endsWith('/auth/refresh'))
  );
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
  // Restore real timers unconditionally — a no-op if the test never faked them, but essential
  // for the one that does (the retry-interval test below): leaked fake timers would otherwise
  // silently break every subsequent test's own timing.
  vi.useRealTimers();
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

  it('⭐ waits for a slow-hydrating store before flushing ANY store, not just the slow one', async () => {
    // Pins the `allSettled` gate (Outbox.tsx) deterministically rather than relying on however
    // the fake database's promises happen to interleave — the ORIGINAL regression this gate fixed
    // (docs/04-delivery/phase-3-capture-migration-2026-08-09.md, "regression 1") was that `tallies`
    // hydrated and made `pendingCount > 0` while `health` was still mid-hydration, so the tally
    // posted BEFORE the dose it must be judged against, because an unhydrated store's empty
    // `all()` reads as "this farm has none of these" rather than "still finding out". Without the
    // gate, that same defect would resurface here: `health` is deliberately held open while every
    // OTHER seeded store (tallies, mobs, moves, herd, weights, events) hydrates and settles for
    // real — proven by reading `capture_records` back directly, not by trusting a UI label that
    // can only ever say "Sending…" while ungated. If the gate is gone, the tally goes up in that
    // window; if the gate holds, nothing does until `health` is released too.
    cachedSession();
    seedDoseThenDisposal();
    const fetchMock = acceptingFetch();
    vi.stubGlobal('fetch', fetchMock);

    const db = await getCurrentFakeLocalDatabase();
    const release = db.holdHydrationFor(`werf-health:${FARM_ID}`);

    render(<App />);

    // Every OTHER seeded store has actually finished hydrating and committed its migrated rows —
    // not just "some time has passed" — while `health` is still held.
    await waitFor(async () => {
      expect(await storedBlob(`werf-tallies:${FARM_ID}`)).toContain(TALLY_ID);
      expect(await storedBlob(`werf-moves:${FARM_ID}`)).toContain(MOVE_ID);
    });
    expect(postedPaths(fetchMock)).toEqual([]);
    expect(screen.queryByText('Saved and sent')).toBeNull();

    release();

    expect(await screen.findByText('Saved and sent')).toBeTruthy();
    const paths = postedPaths(fetchMock);
    const at = (suffix: string) => paths.findIndex((p) => p.endsWith(suffix));
    expect(at('/livestock/dips')).toBeGreaterThanOrEqual(0);
    expect(at('/livestock/dips')).toBeLessThan(at('/livestock/mob-tallies'));
  });

  it('⭐ holds EVERYTHING, not just its own captures, when a store fails to hydrate (sync-auditor Finding 1, 2026-08-09)', async () => {
    // The FAILURE counterpart to the test above: `health` does not merely hydrate slowly here, it
    // never hydrates at all — the fake database throws on every read for this one key, the way a
    // corrupted OPFS file or a row a future schema version wrote would. `settled()` alone cannot
    // tell this apart from "confirmed empty": the store still settles (on the failure), `all()`
    // still reads `[]`. Before `hydrationFailed()` existed, the flush would have gone ahead
    // believing no dose was outstanding — waving the tally through a guard that never actually
    // ran, exactly the SEV-1 shape the FK/`guardedBy` ordering exists to prevent. `anyHydrationFailed`
    // (Outbox.tsx) holds the WHOLE queue, not only what health's own captures would have been,
    // because an unverifiable store poisons every guard that reads it, not just its own kind.
    cachedSession();
    seedDoseThenDisposal();
    const fetchMock = acceptingFetch();
    vi.stubGlobal('fetch', fetchMock);

    const db = await getCurrentFakeLocalDatabase();
    db.failHydrationFor(`werf-health:${FARM_ID}`);

    render(<App />);

    // Every OTHER seeded store hydrated and settled for real, not just "some time has passed".
    await waitFor(async () => {
      expect(await storedBlob(`werf-tallies:${FARM_ID}`)).toContain(TALLY_ID);
      expect(await storedBlob(`werf-moves:${FARM_ID}`)).toContain(MOVE_ID);
    });
    // The strip tells the truth about a device that cannot currently verify what it holds — not
    // "sent" (a lie), and not silently "N to send" either (an undercount: health's own dip is
    // invisible to `pendingCount` too, same as everything else this store cannot confirm).
    expect(await screen.findByText('Not sent — will retry')).toBeTruthy();
    expect(screen.queryByText('Saved and sent')).toBeNull();
    expect(postedPaths(fetchMock)).toEqual([]);
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
    expect(await storedBlob(`werf-tallies:${FARM_ID}`)).toContain(TALLY_ID);
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
    expect(await storedBlob(`werf-tallies:${FARM_ID}`)).toContain(TALLY_ID);
  });

  it('⭐ holds a slaughter when the transfer that withholds its flock is known only by HYDRATION', async () => {
    // sync-auditor Finding 1 (2026-08-10), second call site. The test just above proves the taint
    // chain-walk when THIS device captured the transfer_in itself and it was refused this round.
    // The gap: a transfer another device captured, sent, and already landed — so it will never be
    // refused, it is simply invisible to `mobDisposalSubjects` unless the raw local tally log is
    // replaced with the local+hydrated fold. Here the SOURCE mob's own dip is what gets refused this
    // round; the only thing connecting the sale mob to that dip is a transfer this device never
    // captured. Without the fold, `mobDisposalSubjects` cannot walk from the sale mob to the dip
    // camp, so the refused dip's taint never reaches the slaughter — 201 for meat behind a dipped
    // transfer that arrived by down-sync rather than by this device's own capture.
    const SOURCE = '0190f3a0-0000-7000-8000-0000000000b5';
    const HYDRATED_TRANSFER_ID = '0190f3a0-0000-7000-8000-0000000000a8';
    cachedSession();
    window.localStorage.setItem(
      `werf-mobs:${FARM_ID}`,
      JSON.stringify([
        { id: SOURCE, farmId: FARM_ID, name: 'Dip camp', species: 'sheep', headCount: 200 },
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
      `werf-vet-products:${FARM_ID}`,
      JSON.stringify([
        {
          id: '0190f3a0-0000-7000-8000-0000000000d1',
          name: 'Tickaway',
          registrationNumber: 'G4321 Act 36/1947',
          species: ['sheep'],
          meatWithdrawalDays: 28,
          milkWithdrawalHours: null,
          route: 'topical',
        },
      ]),
    );
    // Local: the dip on the SOURCE mob (will be refused this round) and the slaughter on the SALE
    // mob. Nothing local names the transfer between them — that fact lives ONLY in `events`, the way
    // it would after arriving by down-sync rather than being captured on this device.
    window.localStorage.setItem(
      `werf-health:${FARM_ID}`,
      JSON.stringify([
        {
          id: DIP_ID,
          farmId: FARM_ID,
          animalId: null,
          mobId: SOURCE,
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

    // ⛔ Hydrated BEFORE the first render, not injected mid-test. The retry loop only re-flushes
    // every `RETRY_INTERVAL_MS` (90s); once the slaughter has SENT in round one it cannot be
    // un-sent, so the transfer must already be visible to `foldTallies` on that very first attempt —
    // exactly the state a device boots into after PowerSync has replicated it before the device was
    // ever opened, which is the ordinary case, not a race.
    const fake = await getCurrentFakeLocalDatabase();
    fake.hydrateRow('events', {
      id: HYDRATED_TRANSFER_ID,
      farm_id: FARM_ID,
      mob_id: MOB_ID,
      type: 'tally',
      occurred_at: '2026-07-22T12:00:00.000Z',
      payload: JSON.stringify({
        reason: 'transfer_in',
        delta: 40,
        counterpartMobId: SOURCE,
        carriedWithholdUntil: '2026-08-17',
      }),
    });

    render(<App />);
    // Held: the refused dip's taint must reach the slaughter through the hydrated transfer link.
    expect(await screen.findByText(/1 not sent — needs your attention/)).toBeTruthy();

    const sent = window.localStorage.getItem(`werf-sent:${FARM_ID}`) ?? '';
    expect(sent).not.toContain(TALLY_ID);
    expect(await storedBlob(`werf-tallies:${FARM_ID}`)).toContain(TALLY_ID);
  });

  it('⭐ holds an individual sale when the animal AND its mob membership are known only via HYDRATION', async () => {
    // The animals/moves/health hydration slice (phase-checklists.md 3e), the individual-animal
    // counterpart of the transfer-chain test above. `guardedByFor` for a lifecycle disposal used to
    // read `animals.find(...)` (local-only) to find `subject`, then `animalDisposalSubjects(subject,
    // moves)` (also local-only) for the mob-history subject set. An animal registered on ANOTHER
    // device — never captured here — made `subject` `undefined`, which fell through to
    // `guardedBy: nonNull(event.animalId)`: the animal's own id, with NO mob history. A refused dip
    // on a mob the animal stood in (known only because the hydrated animal row itself carries that
    // mob) then held nothing, and the sale posted anyway — 201 for meat inside an active
    // withholding, the one shape in this file where meat reaches a truck rather than a farmer being
    // blocked.
    cachedSession();
    // LOCAL: the dip on the mob (refused this round) and the sale event, naming an animal id this
    // device has no local herd row for at all.
    window.localStorage.setItem(
      `werf-vet-products:${FARM_ID}`,
      JSON.stringify([
        {
          id: '0190f3a0-0000-7000-8000-0000000000d2',
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
          productId: '0190f3a0-0000-7000-8000-0000000000d2',
          method: 'plunge',
        },
      ]),
    );
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

    // HYDRATED before the first render, same reasoning as the transfer-chain test: this device
    // boots into a world where the animal and its mob membership already arrived via down-sync.
    const fake = await getCurrentFakeLocalDatabase();
    fake.hydrateRow('animals', {
      id: ANIMAL_ID,
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
      // Standing in the dipped mob as first captured — the opening mob `mobMembership` reads,
      // no move event needed to establish it.
      mob_id: MOB_ID,
      land_unit_id: null,
      source: null,
      acquired_at: null,
      brand_id: null,
      brand_applied_at: null,
      attributes: '{}',
      photo_key: null,
      enterprise_id: null,
    });

    render(<App />);
    // Held: the refused dip's taint must reach the sale through the hydrated animal's mob history.
    expect(await screen.findByText(/1 not sent — needs your attention/)).toBeTruthy();

    const sent = window.localStorage.getItem(`werf-sent:${FARM_ID}`) ?? '';
    expect(sent).not.toContain(SALE_ID);
    expect(await storedBlob(`werf-events:${FARM_ID}`)).toContain(SALE_ID);
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
    const stored = await storedBlob(`werf-tallies:${FARM_ID}`);
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
    const stored = await storedBlob(`werf-tallies:${FARM_ID}`);
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

  describe('tripwire 3e (issue #8): a hydrated tally from ANOTHER device', () => {
    // ⛔ THE TENTH PASS'S TRIPWIRE, CLOSED. `landed()` used to be exactly `sentLog.has(id)` —
    // "did THIS DEVICE send it" — which is the same claim as "does the server hold it" only while
    // the device holds the whole log. Down-sync breaks that: an INCREASE another device captured
    // and sent lands on the server, is replicated back to THIS device via PowerSync, and — before
    // this fix — was invisible to `needsHead`'s fold. The fold then UNDER-counts the true head,
    // and a decrease that the server would happily accept looks like it would underflow locally —
    // held, every round, forever, with no refusal above it to ever clear it.
    //
    // The scenario below picks an INCREASE deliberately, not a decrease: a hidden DECREASE would
    // make the naive fold over-permissive (the server's own guard still catches that), but a
    // hidden INCREASE is what produces the silent, permanent, farmer-visible hold this tripwire
    // names — "1 to send" that never becomes "Synced" no matter how long the phone sits in range.

    const M = '0190f3a0-0000-7000-8000-0000000000e1';
    /** Device A's birth — landed on the server, replicated down, NEVER captured on this device. */
    const BIRTH = '0190f3a0-0000-7000-8000-0000000000e2';
    /** This device's own decrease, valid once the birth is counted, still unsent. */
    const DECREASE = '0190f3a0-0000-7000-8000-0000000000e3';

    function seedMobAndDecrease(): void {
      window.localStorage.setItem(
        `werf-mobs:${FARM_ID}`,
        JSON.stringify([
          {
            id: M,
            farmId: FARM_ID,
            name: 'Flock A',
            species: 'sheep',
            headCount: 260,
            initialHeadCount: 260,
          },
        ]),
      );
      window.localStorage.setItem(
        `werf-tallies:${FARM_ID}`,
        JSON.stringify([
          {
            id: DECREASE,
            farmId: FARM_ID,
            mobId: M,
            // After the birth, so the fold's `(occurredAt, id)` cut counts it — same shape every
            // other head-arithmetic test in this file already relies on.
            occurredAt: '2026-07-25T12:00:00.000Z',
            reason: 'death',
            count: 280,
            delta: -280,
          },
        ]),
      );
    }

    /** The birth as the canonical `events` row PowerSync would down-sync — the exact shape
     *  `recordMobTally` (`@werf/domain`) writes, read back rather than re-invented. */
    function hydratedBirthRow(farmId = FARM_ID) {
      return {
        id: BIRTH,
        farm_id: farmId,
        mob_id: M,
        type: 'tally',
        occurred_at: '2026-07-20T12:00:00.000Z',
        payload: JSON.stringify({ reason: 'birth', delta: 40 }),
      };
    }

    it('⭐⭐ sends the decrease once the hydrated birth funds it — not held forever', async () => {
      cachedSession();
      seedMobAndDecrease();
      const fetchMock = acceptingFetch();
      vi.stubGlobal('fetch', fetchMock);

      render(<App />);

      // BEFORE hydration: the MOB row sends (it is a plain, unguarded FlushItem — a foreign key,
      // not an arithmetic question), but 260 (baseline alone) cannot fund a 280 decrease, so the
      // TALLY specifically is held rather than refused. Waited for via the strip settling on
      // "pending" (proof the gate has run at least once), not by racing a timer.
      await screen.findByText(/1 to send/);
      expect(postedPaths(fetchMock).some((path) => path.includes('/mob-tallies'))).toBe(false);

      // Device A's birth lands. Nothing on THIS device captured it, sent it, or restarted for it —
      // it simply arrives, the way down-sync does.
      const fake = await getCurrentFakeLocalDatabase();
      act(() => {
        fake.hydrateRow('events', hydratedBirthRow());
      });

      // ⭐ THE ASSERTION THIS TEST EXISTS FOR. The fold can now see the head the birth funded
      // (260 + 40 − 280 = 20 ≥ 0), so the decrease sends on its own.
      await waitFor(() => {
        expect(postedPaths(fetchMock).some((path) => path.includes('/mob-tallies'))).toBe(true);
      });
      const sent = window.localStorage.getItem(`werf-sent:${FARM_ID}`) ?? '';
      expect(sent).toContain(DECREASE);
      // The hydrated birth itself is never POSTed — it is not this device's capture to send. Only
      // ONE tally request should ever have gone out, however many times the flush retried.
      expect(postedPaths(fetchMock).filter((path) => path.includes('/mob-tallies'))).toHaveLength(
        1,
      );
    });

    it('cross-farm hydrated rows never fund a decrease on this farm', async () => {
      cachedSession();
      seedMobAndDecrease();
      const fetchMock = acceptingFetch();
      vi.stubGlobal('fetch', fetchMock);

      render(<App />);
      await screen.findByText(/1 to send/);

      const fake = await getCurrentFakeLocalDatabase();
      act(() => {
        // Same mob id, same delta — but a DIFFERENT farm. If farm-scoping ever slipped, this
        // would fund the decrease exactly as the real birth does above.
        fake.hydrateRow('events', hydratedBirthRow('0190f3a0-0000-7000-8000-0000000000ff'));
      });

      // Held, still — nothing to observe (a negative assertion), so give the (non-)event a real
      // window rather than checking once immediately after the act().
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(postedPaths(fetchMock).some((path) => path.includes('/mob-tallies'))).toBe(false);
    });

    it('⭐ a hydrated RECOUNT still resets, and funds a decrease the created baseline alone could not', async () => {
      // Test 6 of the required matrix. `projectHeadCount` (@werf/domain) has always reset on a
      // recount — this is not new behaviour — but the merge feeding it hydrated rows must not
      // treat a hydrated recount as just another delta added on top of the baseline.
      const M2 = '0190f3a0-0000-7000-8000-0000000000e5';
      const RECOUNT = '0190f3a0-0000-7000-8000-0000000000e6';
      const DECREASE2 = '0190f3a0-0000-7000-8000-0000000000e7';
      cachedSession();
      window.localStorage.setItem(
        `werf-mobs:${FARM_ID}`,
        JSON.stringify([
          {
            id: M2,
            farmId: FARM_ID,
            name: 'Flock B',
            species: 'sheep',
            headCount: 260,
            initialHeadCount: 260,
          },
        ]),
      );
      window.localStorage.setItem(
        `werf-tallies:${FARM_ID}`,
        JSON.stringify([
          {
            id: DECREASE2,
            farmId: FARM_ID,
            mobId: M2,
            // The created baseline (260) alone cannot fund this; the recounted figure (500) can.
            occurredAt: '2026-07-26T12:00:00.000Z',
            reason: 'death',
            count: 450,
            delta: -450,
          },
        ]),
      );
      const fetchMock = acceptingFetch();
      vi.stubGlobal('fetch', fetchMock);

      render(<App />);
      await screen.findByText(/1 to send/);
      expect(postedPaths(fetchMock).some((path) => path.includes('/mob-tallies'))).toBe(false);

      const fake = await getCurrentFakeLocalDatabase();
      act(() => {
        fake.hydrateRow('events', {
          id: RECOUNT,
          farm_id: FARM_ID,
          mob_id: M2,
          type: 'tally',
          occurred_at: '2026-07-20T12:00:00.000Z',
          payload: JSON.stringify({ reason: 'recount', countedHead: 500 }),
        });
      });

      await waitFor(() => {
        expect(postedPaths(fetchMock).some((path) => path.includes('/mob-tallies'))).toBe(true);
      });
      expect(window.localStorage.getItem(`werf-sent:${FARM_ID}`) ?? '').toContain(DECREASE2);
    });

    it('⭐ test 5 of the required matrix: hydration arriving OUT OF chronological order projects the same result', async () => {
      const M3 = '0190f3a0-0000-7000-8000-0000000000e8';
      const RECOUNT3 = '0190f3a0-0000-7000-8000-0000000000e9';
      const BIRTH3 = '0190f3a0-0000-7000-8000-0000000000ea';
      const DECREASE3 = '0190f3a0-0000-7000-8000-0000000000eb';
      cachedSession();
      window.localStorage.setItem(
        `werf-mobs:${FARM_ID}`,
        JSON.stringify([
          {
            id: M3,
            farmId: FARM_ID,
            name: 'Flock C',
            species: 'sheep',
            headCount: 260,
            initialHeadCount: 260,
          },
        ]),
      );
      window.localStorage.setItem(
        `werf-tallies:${FARM_ID}`,
        JSON.stringify([
          {
            id: DECREASE3,
            farmId: FARM_ID,
            mobId: M3,
            // Only funded once BOTH the recount (500, on the 18th) and the birth (+50, on the
            // 19th) are counted: 550 total, 500 taken, 50 left.
            occurredAt: '2026-07-26T12:00:00.000Z',
            reason: 'death',
            count: 500,
            delta: -500,
          },
        ]),
      );
      const fetchMock = acceptingFetch();
      vi.stubGlobal('fetch', fetchMock);

      render(<App />);
      await screen.findByText(/1 to send/);

      const fake = await getCurrentFakeLocalDatabase();
      // Delivered in REVERSE of the order they happened on the farm — the later birth arrives
      // before the earlier recount. The total order the fold sorts by is `(occurredAt, id)`, not
      // arrival order, so the result must not depend on which one this device heard about first.
      act(() => {
        fake.hydrateRow('events', {
          id: BIRTH3,
          farm_id: FARM_ID,
          mob_id: M3,
          type: 'tally',
          occurred_at: '2026-07-19T12:00:00.000Z',
          payload: JSON.stringify({ reason: 'birth', delta: 50 }),
        });
      });
      act(() => {
        fake.hydrateRow('events', {
          id: RECOUNT3,
          farm_id: FARM_ID,
          mob_id: M3,
          type: 'tally',
          occurred_at: '2026-07-18T12:00:00.000Z',
          payload: JSON.stringify({ reason: 'recount', countedHead: 500 }),
        });
      });

      await waitFor(() => {
        expect(postedPaths(fetchMock).some((path) => path.includes('/mob-tallies'))).toBe(true);
      });
      expect(window.localStorage.getItem(`werf-sent:${FARM_ID}`) ?? '').toContain(DECREASE3);
    });

    it('a genuine hydration failure holds the queue, never drops it (never a lost capture)', async () => {
      cachedSession();
      seedMobAndDecrease();
      const fetchMock = acceptingFetch();
      vi.stubGlobal('fetch', fetchMock);

      const fake = await getCurrentFakeLocalDatabase();
      fake.failWatch('events');

      render(<App />);

      expect(await screen.findByText('Not sent — will retry')).toBeTruthy();
      expect(postedPaths(fetchMock)).toEqual([]);
      // Still in the local store, untouched — a down-sync failure is never a discard.
      const stillQueued = await storedCaptures<{ id: string }>(`werf-tallies:${FARM_ID}`);
      expect(stillQueued.map((t) => t.id)).toContain(DECREASE);
    });
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
    // The seeded ground truth. What migrates into the SQLite-backed store below must match this
    // structurally — window.localStorage itself is never touched again, so comparing against it
    // directly after render would trivially always pass and stop testing anything.
    const before = JSON.parse(
      window.localStorage.getItem(`werf-tallies:${FARM_ID}`) ?? '[]',
    ) as unknown[];

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

    // The capture store is structurally identical, nothing joined the sent-log, and the session
    // was not cleared out from under the queue.
    await waitFor(async () => {
      expect(await storedCaptures(`werf-tallies:${FARM_ID}`)).toEqual(before);
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
    expect(await storedBlob(`werf-herd:${FARM_ID}`)).toContain(ANIMAL_ID);
    expect(await storedBlob(`werf-weights:${FARM_ID}`)).toContain(WEIGHT_ID);
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
    expect(await storedBlob(`werf-weights:${FARM_ID}`)).toContain(WEIGHT_ID);
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
    expect(await storedBlob(`werf-identifiers:${FARM_ID}`)).toContain('0417');
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
    expect(await storedBlob(`werf-herd:${FARM_ID}`)).toContain(ANIMAL_ID);
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
    expect(postedPaths(fetchMock)).toHaveLength(0);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).endsWith('/auth/refresh'))).toBe(
      true,
    );
  });

  it('⭐ schedules a bounded retry after an aborted round, and the retry itself resumes the flush (sync-auditor Finding 2, 2026-08-09)', async () => {
    // A round aborts as transient whenever the server refuses in a way `isRefusal` does not treat
    // as a merits refusal — a 429 from the global per-IP throttle (app.module.ts's
    // `ThrottlerModule`) is the realistic case a large offline backlog draining at once can hit,
    // and db.md's "a 5xx is transient" rule is written to cover it too. Before this fix, NOTHING
    // re-triggered a flush after that: `errored` only changes inside `flush()` itself, so the
    // strip said "Not sent — will retry" with nothing actually scheduled to retry it, until the
    // farmer captured something new or restarted the app.
    //
    // Real timers throughout — `vi.useFakeTimers()` was tried here first and made React's own
    // scheduling hang under jsdom (no real `MessageChannel`/`requestIdleCallback` fallback to
    // fake against), so instead of simulating 90 real seconds passing, this captures the EXACT
    // callback `window.setInterval` was given and invokes it directly — proving both that a
    // bounded retry is genuinely scheduled AND that firing it resumes the flush for real, without
    // needing time itself to move.
    cachedSession();
    seedCaptures();
    let throttled = true;
    const fetchMock = vi.fn(async () =>
      throttled
        ? ({
            ok: false,
            status: 429,
            json: async () => ({ code: 'THROTTLED', message: 'too many requests' }),
          } as unknown as Response)
        : ({ ok: true, status: 201, json: async () => ({}) } as unknown as Response),
    );
    vi.stubGlobal('fetch', fetchMock);
    const setIntervalSpy = vi.spyOn(window, 'setInterval');

    render(<App />);

    expect(await screen.findByText('Not sent — will retry')).toBeTruthy();
    const attemptsBeforeRetry = fetchMock.mock.calls.length;
    expect(attemptsBeforeRetry).toBeGreaterThan(0);

    // A retry IS scheduled, at a bound (90s) that comfortably outlasts every `blockDuration` in
    // app.module.ts's throttler config and security/rate-limits.ts, so a throttle block has
    // always cleared server-side by the time a real device's timer fires.
    await waitFor(() => {
      expect(setIntervalSpy.mock.calls.some(([, delay]) => delay === 90_000)).toBe(true);
    });
    const scheduled = setIntervalSpy.mock.calls.find(([, delay]) => delay === 90_000);
    const retryCallback = scheduled?.[0] as (() => void) | undefined;
    expect(retryCallback).toBeDefined();

    // The throttle has cleared server-side; firing the exact scheduled callback must resume the
    // flush and actually send the backlog, with no new capture and no app restart in between.
    throttled = false;
    await act(async () => {
      retryCallback?.();
    });

    expect(await screen.findByText('Saved and sent')).toBeTruthy();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(attemptsBeforeRetry);
  });
});

describe('sending an attachment (phase-checklists.md 3i(c))', () => {
  const ATTACHMENT_ID = '0190f3a0-0000-7000-8000-0000000000f5';
  const UPLOAD_URL = 'https://minio.test/bucket/attachment-key?sig=abc';

  function seedAnimalAndAttachment(): void {
    const animal = schemas.newAnimalSchema.parse({
      id: ANIMAL_ID,
      farmId: FARM_ID,
      species: 'cattle',
      sex: 'female',
    });
    window.localStorage.setItem(`werf-herd:${FARM_ID}`, JSON.stringify([animal]));
    window.localStorage.setItem(
      `werf-attachments:${FARM_ID}`,
      JSON.stringify([
        {
          id: ATTACHMENT_ID,
          farmId: FARM_ID,
          subjectType: 'animal',
          subjectId: ANIMAL_ID,
          mimeType: 'image/jpeg',
          sizeBytes: 4,
          checksum: 'a'.repeat(64),
          occurredAt: '2026-07-20T06:00:00.000Z',
        },
      ]),
    );
  }

  /** A three-leg-aware fetch, so each test can choose how the ANIMAL leg and the FINALIZE leg
   *  behave without repeating the URL-branching every time. `create`/PUT always accept — no test
   *  below needs them to do otherwise. */
  function attachmentFetchMock(
    opts: {
      animal?: 'accept' | 'refuse' | 'networkFail';
      finalize?: 'accept' | 'networkFail';
    } = {},
  ) {
    const { animal = 'accept', finalize = 'accept' } = opts;
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method;
      if (url.endsWith('/livestock/animals') && method === 'POST') {
        if (animal === 'networkFail') throw new TypeError('Failed to fetch');
        if (animal === 'refuse') {
          return {
            ok: false,
            status: 409,
            json: async () => ({ code: 'CONFLICT', message: 'already recorded' }),
          } as unknown as Response;
        }
        return { ok: true, status: 201, json: async () => ({}) } as unknown as Response;
      }
      if (url.endsWith('/attachments') && method === 'POST') {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            attachmentId: ATTACHMENT_ID,
            uploadUrl: UPLOAD_URL,
            checksumHeaderValue: 'YWJjZA==',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          }),
        } as unknown as Response;
      }
      if (url === UPLOAD_URL && method === 'PUT') {
        return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
      }
      if (url.endsWith('/attachments/finalize') && method === 'POST') {
        if (finalize === 'networkFail') throw new TypeError('Failed to fetch');
        return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
      }
      // AuthProvider's boot effect refreshes on any mount whose in-memory session has no
      // access token — the ordinary shape of a "cold start", which the interruption test below
      // deliberately re-renders through. A generic `{}` fallback fails `adopt()`'s own shape
      // check and leaves the flush with no token to send anything, forever — this branch is what
      // every OTHER `acceptingFetch()`-style mock in this file gets for free by accepting
      // everything blindly, which this mock cannot do since it must also branch on the presigned
      // PUT going to a non-API host.
      if (url.endsWith('/auth/refresh') && method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            accessToken: 'refreshed-access-token',
            expiresIn: 900,
            user: SESSION_USER,
            farms: [
              { id: FARM_ID, name: 'Rietfontein', enterpriseTypes: ['beef_cattle'], role: 'owner' },
            ],
            activeFarmId: FARM_ID,
            secondFactor: 'complete',
          }),
        } as unknown as Response;
      }
      return { ok: true, status: 201, json: async () => ({}) } as unknown as Response;
    });
  }

  it('⭐ holds a photo behind a refused animal, and never attempts the upload', async () => {
    // The `animalrow:` subject (phase-checklists.md 3i(c)), the same taint shape `mobrow:` already
    // proves for a tally on a mob the server has not accepted: a refused animal must hold the
    // photo behind it rather than let it 404 individually for the same one cause.
    cachedSession();
    seedAnimalAndAttachment();
    await getCurrentFakeBlobStore().put(ATTACHMENT_ID, new Blob(['fake-jpeg']));
    const fetchMock = attachmentFetchMock({ animal: 'refuse' });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect(await screen.findByText(/^1 not sent — needs your attention/)).toBeTruthy();
    const paths = postedPaths(fetchMock);
    expect(paths.some((p) => p.endsWith('/livestock/animals'))).toBe(true);
    expect(paths.some((p) => p.endsWith('/attachments'))).toBe(false);
    // Held, not lost: the blob is untouched and the attachment never joined the sent-log.
    expect(getCurrentFakeBlobStore().has(ATTACHMENT_ID)).toBe(true);
    const sent = window.localStorage.getItem(`werf-sent:${FARM_ID}`) ?? '';
    expect(sent).not.toContain(ATTACHMENT_ID);
  });

  it('never attempts a photo when the animal ahead of it in the queue aborts the round', async () => {
    // FK ordering, not the taint mechanism this time: a transient failure on the animal aborts the
    // WHOLE round, so the attachment queued behind it (send order, `Outbox.tsx`'s FK comment) is
    // never even attempted this round — proving where the queue construction actually placed it.
    cachedSession();
    seedAnimalAndAttachment();
    await getCurrentFakeBlobStore().put(ATTACHMENT_ID, new Blob(['fake-jpeg']));
    const fetchMock = attachmentFetchMock({ animal: 'networkFail' });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/livestock/animals'))).toBe(
        true,
      );
    });
    expect(postedPaths(fetchMock).some((p) => p.endsWith('/attachments'))).toBe(false);
    expect(getCurrentFakeBlobStore().has(ATTACHMENT_ID)).toBe(true);
  });

  it('⭐ sends the whole three-leg upload once its animal has landed, and releases the blob', async () => {
    cachedSession();
    seedAnimalAndAttachment();
    // The animal is ALREADY sent — this device's own earlier round — so this round never attempts
    // it again; the attachment's `guardedBy` subject was simply never tainted.
    window.localStorage.setItem(`werf-sent:${FARM_ID}`, JSON.stringify([ANIMAL_ID]));
    await getCurrentFakeBlobStore().put(ATTACHMENT_ID, new Blob(['fake-jpeg']));
    const fetchMock = attachmentFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect(await screen.findByText('Saved and sent')).toBeTruthy();
    const calls = fetchMock.mock.calls.map(
      (c) => [String(c[0]), (c[1] as RequestInit | undefined)?.method] as const,
    );
    expect(calls.some(([u, m]) => u.endsWith('/attachments') && m === 'POST')).toBe(true);
    expect(calls.some(([u, m]) => u === UPLOAD_URL && m === 'PUT')).toBe(true);
    expect(calls.some(([u, m]) => u.endsWith('/attachments/finalize') && m === 'POST')).toBe(true);
    expect(calls.some(([u]) => u.endsWith('/livestock/animals'))).toBe(false);
    // Finalize genuinely returned, so the local blob is gone.
    expect(getCurrentFakeBlobStore().has(ATTACHMENT_ID)).toBe(false);
    const sent = window.localStorage.getItem(`werf-sent:${FARM_ID}`) ?? '';
    expect(sent).toContain(ATTACHMENT_ID);
  });

  it('⭐ keeps the blob through an interruption between a successful PUT and finalize, and completes on retry', async () => {
    // Design note (c), phase-checklists.md 3i(c): the local blob is released ONLY once finalize
    // returns, never on the PUT's own success — because a PUT can land while the app is killed
    // before finalize runs, and the retry needs the bytes still there to attempt that leg again.
    cachedSession();
    seedAnimalAndAttachment();
    window.localStorage.setItem(`werf-sent:${FARM_ID}`, JSON.stringify([ANIMAL_ID]));
    await getCurrentFakeBlobStore().put(ATTACHMENT_ID, new Blob(['fake-jpeg']));
    const fetchMock = attachmentFetchMock({ finalize: 'networkFail' });
    vi.stubGlobal('fetch', fetchMock);

    const { unmount } = render(<App />);

    // The PUT reached the object store; finalize's response never arrived (a network failure
    // aborts the round rather than refusing it). Waited out to the FINALIZE attempt, not just the
    // PUT — unmounting the instant the PUT call is observed would race the still-in-flight
    // `sendAttachment` continuation against the teardown below. The property under test: the blob
    // is STILL there once the whole interrupted attempt has genuinely settled.
    await waitFor(() => {
      const calls = fetchMock.mock.calls.map(
        (c) => [String(c[0]), (c[1] as RequestInit | undefined)?.method] as const,
      );
      expect(calls.some(([u, m]) => u.endsWith('/attachments/finalize') && m === 'POST')).toBe(
        true,
      );
    });
    expect(getCurrentFakeBlobStore().has(ATTACHMENT_ID)).toBe(true);

    // The app restarts — unmounted, then a fresh render against the SAME fake blob store (this
    // module's memoized-per-test singleton), the way `getCurrentFakeLocalDatabase` already models
    // a cold start elsewhere in this file.
    unmount();
    const resumedFetch = attachmentFetchMock();
    vi.stubGlobal('fetch', resumedFetch);
    render(<App />);

    expect(await screen.findByText('Saved and sent')).toBeTruthy();
    expect(getCurrentFakeBlobStore().has(ATTACHMENT_ID)).toBe(false);
    const sent = window.localStorage.getItem(`werf-sent:${FARM_ID}`) ?? '';
    expect(sent).toContain(ATTACHMENT_ID);
  });
});
