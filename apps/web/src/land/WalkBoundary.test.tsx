/**
 * Walking a camp's fence as a farmer does it (FR-150, § 4 B7): stand at each corner, mark it, and
 * save the shape — with no signal anywhere in the path, because GPS is a receiver and not a
 * connection.
 *
 * Like the other capture tests these seed `localStorage` and render the real `<App/>`, so the walk
 * is read back through the same boot path a cold start uses. The geolocation API is the one thing
 * stubbed, because jsdom has no GPS — and it is stubbed at the BROWSER boundary rather than by
 * mocking our own module, so everything from the screen down to the closed ring is the real code.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { schemas } from '@werf/core';
import { App } from '../App';
import { storedCaptures } from '../test-support/local-db';

const SESSION_KEY = 'werf-session';
const FARM_ID = '0190f3a0-0000-7000-8000-0000000000f1';
const CAMP_ID = '0190f3a0-0000-7000-8000-0000000000c3';
const LAND_KEY = `werf-land:${FARM_ID}`;
const WALKS_KEY = `werf-boundary-walks:${FARM_ID}`;
const DRAFT_KEY = `werf-walk-draft:${FARM_ID}:${CAMP_ID}`;

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

/** One camp already on the device, so the walk has ground to be about. */
function cachedCamp(): void {
  window.localStorage.setItem(
    LAND_KEY,
    JSON.stringify([
      {
        id: CAMP_ID,
        farmId: FARM_ID,
        kind: 'camp',
        code: 'Camp 3',
        name: null,
        enterpriseId: null,
        parentId: null,
        boundaryGeojson: null,
        hectares: null,
        carryingCapacityLsu: null,
        soilType: null,
        irrigation: null,
        attributes: {},
      },
    ]),
  );
}

/** The corners of a ~108 ha box, in the order a farmer would walk them. */
const BOX: Array<[number, number]> = [
  [26.2, -29.0],
  [26.21, -29.0],
  [26.21, -28.99],
  [26.2, -28.99],
];

/**
 * A GPS that hands out the next fix each time it is asked. Stubbed at `navigator.geolocation`, the
 * real browser boundary — nothing of ours is mocked.
 */
function stubGps(fixes: Array<[number, number]>, accuracyM = 5): void {
  let next = 0;
  Object.defineProperty(window.navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (onSuccess: (position: unknown) => void) => {
        const fix = fixes[Math.min(next, fixes.length - 1)]!;
        next += 1;
        onSuccess({ coords: { longitude: fix[0], latitude: fix[1], accuracy: accuracyM } });
      },
    },
  });
}

/** A GPS that always refuses, with the code the browser uses for a denied permission. */
function stubGpsDenied(): void {
  Object.defineProperty(window.navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (_ok: unknown, onError: (error: unknown) => void) => {
        onError({ code: 1, PERMISSION_DENIED: 1, TIMEOUT: 3 });
      },
    },
  });
}

function storedWalks(): Promise<readonly Record<string, unknown>[]> {
  return storedCaptures<Record<string, unknown>>(WALKS_KEY);
}

function storedDraft(): unknown[] {
  return JSON.parse(window.localStorage.getItem(DRAFT_KEY) ?? '[]') as unknown[];
}

/**
 * Mark `count` MORE corners, waiting for each to land before asking for the next. Counted from
 * whatever the draft already holds, so a test can mark two, check something, and mark a third.
 */
async function markCorners(user: ReturnType<typeof userEvent.setup>, count: number): Promise<void> {
  const already = storedDraft().length;
  for (let i = 0; i < count; i += 1) {
    // findByRole rather than getByRole: the walk screen only renders once `units` (a SQLite-backed
    // capture store) has hydrated — a fresh render starts with zero units and shows the "add a camp
    // first" fallback for a moment first.
    await user.click(await screen.findByRole('button', { name: /mark this corner/i }));
    await waitFor(() => expect(storedDraft()).toHaveLength(already + i + 1));
  }
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, '', '/');
  cachedSession();
  cachedCamp();
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('walking a boundary (FR-150)', () => {
  it('turns four corners into a saved boundary with the network dead, not merely absent', async () => {
    stubGps(BOX);
    const user = userEvent.setup();
    window.history.pushState({}, '', `/land/walk?camp=${CAMP_ID}`);
    // Every request fails, the way they do in a dead zone. Offline is the default state, not the
    // error state: nothing below may await this, and the save must land regardless of it.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    render(<App />);

    await markCorners(user, 4);
    await user.click(screen.getByRole('button', { name: /save this camp’s boundary/i }));

    // append() commits to the in-memory snapshot synchronously (NFR-007), but persistence to the
    // SQLite-backed store is fire-and-forget — wait for it to land before reading it back.
    await waitFor(async () => {
      expect(await storedWalks()).toHaveLength(1);
    });
    const saved = await storedWalks();
    expect(saved[0]).toMatchObject({ farmId: FARM_ID, landUnitId: CAMP_ID });
    // The ring is closed by the app, so five coordinates come out of four corners walked.
    const ring = JSON.parse(String(saved[0]!['boundaryGeojson'])) as {
      type: string;
      coordinates: number[][][];
    };
    expect(ring.type).toBe('Polygon');
    expect(ring.coordinates[0]).toHaveLength(5);
    expect(Number(saved[0]!['areaHectares'])).toBeGreaterThan(107);
  });

  it('⭐ saves against a REAL camp when the link names one this phone does not hold', async () => {
    // An enabled Save that does nothing is the worst failure this product can have: an hour on the
    // fence, a button that looks like every other Save, and silence. A one-shot read of `?camp=`
    // let the id drift off `units` — a bookmarked link, a camp deleted since, or the farm switcher
    // in the shell header, which changes the farm WITHOUT navigating. The screen must land on a camp
    // it actually holds rather than accumulate corners against a phantom.
    stubGps(BOX);
    const user = userEvent.setup();
    window.history.pushState({}, '', '/land/walk?camp=0190f3a0-0000-7000-8000-00000000dead');
    render(<App />);

    await markCorners(user, 4);
    const save = screen.getByRole('button', { name: /save this camp’s boundary/i });
    expect(save.hasAttribute('disabled')).toBe(false);
    await user.click(save);

    // It saved, and it saved against the camp this device actually has.
    await waitFor(async () => {
      expect(await storedWalks()).toHaveLength(1);
    });
    const saved = await storedWalks();
    expect(saved[0]).toMatchObject({ farmId: FARM_ID, landUnitId: CAMP_ID });
  });

  it('⭐ keeps a half-walked fence through a cold start — an hour of walking is not a screen timeout', async () => {
    stubGps(BOX);
    const user = userEvent.setup();
    window.history.pushState({}, '', `/land/walk?camp=${CAMP_ID}`);
    const { unmount } = render(<App />);

    await markCorners(user, 2);

    // The phone locks and the tab is discarded halfway round the fence.
    unmount();
    window.history.pushState({}, '', `/land/walk?camp=${CAMP_ID}`);
    render(<App />);

    // Both corners are still there — the walk resumes rather than restarting. findByText rather
    // than getByText: `units` (a SQLite-backed capture store) starts empty on a fresh render and
    // hydrates asynchronously, so the screen shows its "add a camp first" fallback for a moment.
    expect(await screen.findByText(/2 corners/i)).toBeTruthy();
  });

  it('will not save a walk that is not yet a piece of ground', async () => {
    stubGps(BOX);
    const user = userEvent.setup();
    window.history.pushState({}, '', `/land/walk?camp=${CAMP_ID}`);
    render(<App />);

    const save = () => screen.getByRole('button', { name: /save this camp’s boundary/i });
    // findByRole rather than getByRole: `units` starts empty on a fresh render and hydrates
    // asynchronously, so the walk screen (and this button) is not there yet.
    expect(
      (await screen.findByRole('button', { name: /save this camp’s boundary/i })).hasAttribute(
        'disabled',
      ),
    ).toBe(true);

    await markCorners(user, 2);
    expect(save().hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/three corners make a boundary/i)).toBeTruthy();

    await markCorners(user, 1);
    expect(save().hasAttribute('disabled')).toBe(false);
    expect(await storedWalks()).toHaveLength(0);
  });

  it('tells the farmer at the fence that the line crosses itself, not days later', async () => {
    // The bowtie: corners marked in an order that makes a figure of eight. The refusal has to
    // happen HERE, standing on the ground, because a server saying so next week is useless.
    stubGps([
      [26.2, -29.0],
      [26.21, -28.99],
      [26.21, -29.0],
      [26.2, -28.99],
    ]);
    const user = userEvent.setup();
    window.history.pushState({}, '', `/land/walk?camp=${CAMP_ID}`);
    render(<App />);

    await markCorners(user, 4);

    expect(screen.getByText(/crosses itself/i)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /save this camp’s boundary/i }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('says how far out a poor fix could put the fence, and still lets it be saved', async () => {
    // The farmer standing at the corner knows things this screen does not. A boundary walked under
    // trees is worse than one walked in the open and far better than none at all.
    stubGps(BOX, 45);
    const user = userEvent.setup();
    window.history.pushState({}, '', `/land/walk?camp=${CAMP_ID}`);
    render(<App />);

    await markCorners(user, 4);

    expect(screen.getByText(/may be out by about/i)).toBeTruthy();
    expect(screen.getByText('45 m')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /save this camp’s boundary/i }).hasAttribute('disabled'),
    ).toBe(false);
  });

  it('names a denied location permission as itself, never as being offline', async () => {
    // "You are offline" would send a farmer walking somewhere with signal to fix a setting.
    stubGpsDenied();
    const user = userEvent.setup();
    window.history.pushState({}, '', `/land/walk?camp=${CAMP_ID}`);
    render(<App />);

    // findByRole rather than getByRole: `units` starts empty on a fresh render and hydrates
    // asynchronously, so the walk screen (and this button) is not there yet.
    await user.click(await screen.findByRole('button', { name: /mark this corner/i }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/not allowing the app to use its location/i)).toBeTruthy();
    expect(storedDraft()).toHaveLength(0);
  });

  it('drops the last corner without losing the rest', async () => {
    stubGps(BOX);
    const user = userEvent.setup();
    window.history.pushState({}, '', `/land/walk?camp=${CAMP_ID}`);
    render(<App />);

    await markCorners(user, 3);
    await user.click(screen.getByRole('button', { name: /undo last corner/i }));

    expect(screen.getByText(/2 corners/i)).toBeTruthy();
    expect(storedDraft()).toHaveLength(2);
  });

  it('clears the draft once the walk is a fact, so the next walk starts empty', async () => {
    stubGps(BOX);
    const user = userEvent.setup();
    window.history.pushState({}, '', `/land/walk?camp=${CAMP_ID}`);
    render(<App />);

    await markCorners(user, 4);
    await user.click(screen.getByRole('button', { name: /save this camp’s boundary/i }));

    // The corners are in the append-only log now. Leaving them in the draft too would let the same
    // fence be saved twice, as though it had been walked twice.
    await waitFor(async () => {
      expect(await storedWalks()).toHaveLength(1);
    });
    expect(storedDraft()).toHaveLength(0);
  });

  it('says a camp has no boundary yet, rather than saying nothing at all', async () => {
    window.history.pushState({}, '', '/land');
    render(<App />);

    // findByText rather than getByText: `units` starts empty on a fresh render and hydrates
    // asynchronously, so the land list shows its own empty state for a moment first.
    expect(await screen.findByText(/fence not walked yet/i)).toBeTruthy();
  });

  it('⭐ tells a TYPED boundary apart from no boundary at all — three states, not two', async () => {
    // §2m #3. A camp whose shape was typed in when it was created read exactly like one nobody has
    // ever mapped, because both fell through to "fence not walked yet". Two absences are two facts:
    // an absent WALK and an absent BOUNDARY are different absences, and only one of them means the
    // app knows nothing about where this ground is.
    const units = JSON.parse(window.localStorage.getItem(LAND_KEY) ?? '[]') as Array<
      Record<string, unknown>
    >;
    units[0]!['boundaryGeojson'] = '{"type":"Polygon","coordinates":[[]]}';
    window.localStorage.setItem(LAND_KEY, JSON.stringify(units));
    window.history.pushState({}, '', '/land');
    render(<App />);

    expect(await screen.findByText(/shape on file, fence not walked/i)).toBeTruthy();
    // And it must not ALSO claim there is nothing — the states are exclusive.
    expect(screen.queryByText(/^fence not walked yet$/i)).toBeNull();
  });

  it('shows the walked area on the land list, without touching the hectares the farmer declared', async () => {
    stubGps(BOX);
    const user = userEvent.setup();
    window.history.pushState({}, '', `/land/walk?camp=${CAMP_ID}`);
    const { unmount } = render(<App />);

    await markCorners(user, 4);
    await user.click(screen.getByRole('button', { name: /save this camp’s boundary/i }));

    unmount();
    window.history.pushState({}, '', '/land');
    render(<App />);

    expect(await screen.findByText(/walked/i)).toBeTruthy();
    expect(screen.queryByText(/fence not walked yet/i)).toBeNull();
  });

  it('warns that walking again REPLACES the boundary, and keeps the old walk in the record', async () => {
    stubGps(BOX);
    const user = userEvent.setup();
    window.history.pushState({}, '', `/land/walk?camp=${CAMP_ID}`);
    const { unmount } = render(<App />);
    await markCorners(user, 4);
    await user.click(screen.getByRole('button', { name: /save this camp’s boundary/i }));

    // Coming back to the same camp later — the fence has been moved.
    unmount();
    stubGps([
      [26.2, -29.0],
      [26.23, -29.0],
      [26.23, -28.99],
      [26.2, -28.99],
    ]);
    window.history.pushState({}, '', `/land/walk?camp=${CAMP_ID}`);
    render(<App />);

    expect(await screen.findByText(/saving a new walk replaces it/i)).toBeTruthy();

    await markCorners(user, 4);
    await user.click(screen.getByRole('button', { name: /save this camp’s boundary/i }));

    // ⭐ BOTH walks are kept. The boundary is the latest one; the earlier is a true fact about a
    // fence that really was there, and an append-only log does not lose it.
    await waitFor(async () => {
      expect(await storedWalks()).toHaveLength(2);
    });
  });

  it('⭐ shows the walk that HAPPENED last, not the one captured last', async () => {
    // Two phones, both offline. The 1 March walk was captured on this device SECOND — it is later in
    // the array and would win a last-captured-wins fold — but 10 March is the later FACT and must be
    // the shape shown. The same total order `(occurredAt, id)` the server folds on, run here so the
    // two sides cannot disagree about which shape a camp currently has.
    window.localStorage.setItem(
      WALKS_KEY,
      JSON.stringify([
        {
          id: '0190f3a0-0000-7000-8000-0000000000a1',
          farmId: FARM_ID,
          landUnitId: CAMP_ID,
          occurredAt: '2026-03-10T06:00:00.000Z',
          corners: [],
          boundaryGeojson: '{"type":"Polygon","coordinates":[[]]}',
          areaHectares: 325.4,
        },
        {
          id: '0190f3a0-0000-7000-8000-0000000000a2',
          farmId: FARM_ID,
          landUnitId: CAMP_ID,
          occurredAt: '2026-03-01T06:00:00.000Z',
          corners: [],
          boundaryGeojson: '{"type":"Polygon","coordinates":[[]]}',
          areaHectares: 108.1,
        },
      ]),
    );
    window.history.pushState({}, '', '/land');
    render(<App />);

    expect(await screen.findByText(/325\.4/)).toBeTruthy();
    expect(screen.queryByText(/108\.1/)).toBeNull();
  });

  it('breaks a same-instant tie by id, exactly as the server does', async () => {
    // Day-grained capture makes ties ordinary rather than exotic. `...a2` is the later UUIDv7, and
    // it is the later id on the server too — the ids are the same values on both sides.
    const sameInstant = '2026-03-02T12:00:00.000Z';
    // ⭐ The LOSER is seeded FIRST, and that is the whole test. Seeded the other way round, the
    // incumbent-wins fold returns 325.4 from array order alone and the assertion stays green with
    // the id comparison deleted — an assertion that cannot fail is not a test. The server's
    // equivalent inserts its loser first for exactly this reason.
    window.localStorage.setItem(
      WALKS_KEY,
      JSON.stringify([
        {
          id: '0190f3a0-0000-7000-8000-0000000000a1',
          farmId: FARM_ID,
          landUnitId: CAMP_ID,
          occurredAt: sameInstant,
          corners: [],
          boundaryGeojson: '{"type":"Polygon","coordinates":[[]]}',
          areaHectares: 108.1,
        },
        {
          id: '0190f3a0-0000-7000-8000-0000000000a2',
          farmId: FARM_ID,
          landUnitId: CAMP_ID,
          occurredAt: sameInstant,
          corners: [],
          boundaryGeojson: '{"type":"Polygon","coordinates":[[]]}',
          areaHectares: 325.4,
        },
      ]),
    );
    window.history.pushState({}, '', '/land');
    render(<App />);

    expect(await screen.findByText(/325\.4/)).toBeTruthy();
  });

  it('points a farmer with no camps at making one first', async () => {
    window.localStorage.removeItem(LAND_KEY);
    window.history.pushState({}, '', '/land/walk');
    render(<App />);

    expect(screen.getByText(/add a camp first/i)).toBeTruthy();
  });
});
