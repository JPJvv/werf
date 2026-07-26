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

import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { schemas } from '@werf/core';
import { App } from '../App';

const SESSION_KEY = 'werf-session';
const FARM_ID = '0190f3a0-0000-7000-8000-0000000000f1';
const ANIMAL_ID = '0190f3a0-0000-7000-8000-0000000000a1';
const WEIGHT_ID = '0190f3a0-0000-7000-8000-0000000000e1';
const DEATH_ID = '0190f3a0-0000-7000-8000-0000000000e2';

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
