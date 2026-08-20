/**
 * Moving animals (FR-103) as a farmer does it: open a gate, select what walked through, name where
 * they went — one action, offline. Renders the real `<App/>` against a seeded `localStorage`.
 *
 * The two assertions that carry the design: every animal gets its OWN event (the history is per
 * animal, because that is what a movement record has to be) tied together by ONE batch id (FR-112,
 * because it was one action); and a destination that was not named leaves that dimension alone,
 * rather than quietly clearing it.
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { uuidv7, type schemas } from '@werf/core';
import { App } from '../App';
import { getCurrentFakeLocalDatabase, storedCaptures } from '../test-support/local-db';

const SESSION_KEY = 'werf-session';
const FARM_ID = '0190f3a0-0000-7000-8000-0000000000f1';
const HERD_KEY = `werf-herd:${FARM_ID}`;
const LAND_KEY = `werf-land:${FARM_ID}`;
const MOBS_KEY = `werf-mobs:${FARM_ID}`;
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

function cachedSession(restPeriodDays: number | null = null): void {
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
        restPeriodDays,
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

function seedCamps(...codes: string[]): string[] {
  const ids = codes.map(() => uuidv7());
  window.localStorage.setItem(
    LAND_KEY,
    JSON.stringify(
      codes.map((code, i) => ({
        id: ids[i],
        farmId: FARM_ID,
        enterpriseId: null,
        parentId: null,
        kind: 'camp',
        code,
        name: null,
        boundaryGeojson: null,
        hectares: null,
        carryingCapacityLsu: null,
        soilType: null,
        irrigation: null,
        attributes: {},
      })),
    ),
  );
  return ids;
}

function seedMob(name: string): string {
  const id = uuidv7();
  window.localStorage.setItem(
    MOBS_KEY,
    JSON.stringify([
      {
        id,
        farmId: FARM_ID,
        enterpriseId: null,
        name,
        species: 'cattle',
        landUnitId: null,
        headCount: null,
      },
    ]),
  );
  return id;
}

/** `count` live cattle, all in `landUnitId` and (optionally) in a mob. */
function seedHerd(count: number, landUnitId: string | null, mobId: string | null = null): string[] {
  const ids = Array.from({ length: count }, () => uuidv7());
  window.localStorage.setItem(
    HERD_KEY,
    JSON.stringify(
      ids.map((id) => ({
        id,
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
        mobId,
        landUnitId,
        source: null,
        acquiredAt: null,
        brandId: null,
        brandAppliedAt: null,
        attributes: {},
        photoKey: null,
      })),
    ),
  );
  return ids;
}

function storedMoves(): Promise<readonly Record<string, unknown>[]> {
  return storedCaptures<Record<string, unknown>>(MOVES_KEY);
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, '', '/');
});

afterEach(() => {
  window.localStorage.clear();
});

describe('moving animals (FR-103)', () => {
  it('walks a whole selection in one action, under one batch id', async () => {
    cachedSession();
    const [camp1, camp4] = seedCamps('Camp 1', 'Camp 4');
    seedHerd(3, camp1!);
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/move');
    const { unmount } = render(<App />);

    // The real-world action: everything in Camp 3 walks to Camp 4. The capture stores backing
    // this screen hydrate asynchronously even on this first render (phase-checklists.md 3c), so
    // the first data-dependent query waits for the seeded herd to land.
    await user.click(await screen.findByRole('button', { name: /select all shown/i }));
    await user.selectOptions(screen.getByLabelText(/move to which camp/i), camp4!);
    await user.click(screen.getByRole('button', { name: /move them/i }));

    // append() commits to the in-memory snapshot synchronously (NFR-007), but persistence to the
    // SQLite-backed store is fire-and-forget — wait for it to land before reading it back.
    let moves: readonly Record<string, unknown>[] = [];
    await waitFor(async () => {
      moves = await storedMoves();
      expect(moves).toHaveLength(3);
    });
    // Per animal: its own event. As a group: one batch id, because it was one action (FR-112).
    expect(new Set(moves.map((m) => m['id'])).size).toBe(3);
    expect(new Set(moves.map((m) => m['batchId'])).size).toBe(1);
    expect(moves.every((m) => m['toLandUnitId'] === camp4)).toBe(true);

    // Closed and reopened, the herd knows where they are now — no server involved. A fresh
    // render's capture stores start empty and hydrate asynchronously, so wait for the list to
    // reach its hydrated shape before reading it.
    unmount();
    window.history.pushState({}, '', '/animals/move');
    render(<App />);
    await waitFor(() => {
      expect(screen.getAllByRole('listitem')).toHaveLength(3);
    });
    const rows = screen.getAllByRole('listitem');
    expect(rows.every((row) => (row.textContent ?? '').includes('Camp 4'))).toBe(true);
  });

  it('⭐ offers a mob another device created, known only via hydration, as a move destination (phase-checklists.md 3e)', async () => {
    // The gap this closes: the destination-mob dropdown read `useMobs()` (local-only) instead of
    // `useEffectiveMobs()` — a mob created on another device and already replicated down did not
    // appear as somewhere a gate could walk animals into, even though the same screen's animal
    // picker (`useEffectiveAnimals()`) already saw hydrated animals correctly.
    cachedSession();
    const [camp1] = seedCamps('Camp 1');
    seedHerd(2, camp1!);
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/move');
    render(<App />);

    const fake = await getCurrentFakeLocalDatabase();
    const HYDRATED_MOB = '0190f3a0-0000-7000-8000-00000000b099';
    act(() => {
      fake.hydrateRow('mobs', {
        id: HYDRATED_MOB,
        farm_id: FARM_ID,
        enterprise_id: null,
        land_unit_id: null,
        name: 'Down-synced flock',
        species: 'cattle',
        head_count: null,
        initial_head_count: null,
      });
    });

    await user.click(await screen.findByRole('button', { name: /select all shown/i }));
    await user.selectOptions(screen.getByLabelText(/move into which group/i), HYDRATED_MOB);
    await user.click(screen.getByRole('button', { name: /move them/i }));

    let moves: readonly Record<string, unknown>[] = [];
    await waitFor(async () => {
      moves = await storedMoves();
      expect(moves).toHaveLength(2);
    });
    expect(moves.every((m) => m['toMobId'] === HYDRATED_MOB)).toBe(true);
  });

  it('leaves the group alone when only a camp is named', async () => {
    cachedSession();
    const [camp1, camp4] = seedCamps('Camp 1', 'Camp 4');
    const mobId = seedMob('Weaners');
    seedHerd(1, camp1!, mobId);
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/move');
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /select all shown/i }));
    await user.selectOptions(screen.getByLabelText(/move to which camp/i), camp4!);
    await user.click(screen.getByRole('button', { name: /move them/i }));

    // ABSENT, not null. Sending null would turn "walk them to Camp 4" into "and take them out of
    // their group" — the exact silent data loss the omit/null distinction exists to prevent.
    let moves: readonly Record<string, unknown>[] = [];
    await waitFor(async () => {
      moves = await storedMoves();
      expect(moves).toHaveLength(1);
    });
    const [move] = moves;
    expect(move).not.toHaveProperty('toMobId');
    expect(move!['toLandUnitId']).toBe(camp4);
  });

  it('will not record a move that moves nothing', async () => {
    cachedSession();
    const [camp1] = seedCamps('Camp 1', 'Camp 4');
    seedHerd(2, camp1!);
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/move');
    render(<App />);

    // Nothing selected yet. The button exists once the seeded herd has hydrated.
    expect(
      (await screen.findByRole('button', { name: /move them/i })).hasAttribute('disabled'),
    ).toBe(true);

    // Selected, but sent to the camp they are already in.
    await user.click(screen.getByRole('button', { name: /select all shown/i }));
    await user.selectOptions(screen.getByLabelText(/move to which camp/i), camp1!);
    expect(screen.getByRole('button', { name: /move them/i }).hasAttribute('disabled')).toBe(true);

    expect(await storedMoves()).toHaveLength(0);
  });

  it('says there is nowhere to move to, and offers the way out', async () => {
    cachedSession();
    seedHerd(1, null);
    window.history.pushState({}, '', '/animals/move');
    render(<App />);

    // An empty picker is a dead end; a farm with no camps needs to be told what to do next. The
    // seeded herd hydrates asynchronously, so this is the first data-dependent query in the render.
    expect(await screen.findByText(/no camps yet/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /add a camp/i })).toBeTruthy();
  });
});

describe('rest-period warning on the destination camp (FR-152, 4e·2)', () => {
  it('warns, but does not block, when the destination has not rested the owner-set threshold', async () => {
    cachedSession(30);
    const [camp1, camp4] = seedCamps('Camp 1', 'Camp 4');
    const [animalId] = seedHerd(1, camp1!);
    // Camp 4's own history: this animal was there once, and left 10 days ago — inside a 30-day
    // threshold. Two moves, not one — see `MoveMob.test.tsx`'s identical note on why a departure
    // needs the arrival on the log too.
    window.localStorage.setItem(
      MOVES_KEY,
      JSON.stringify([
        {
          id: uuidv7(),
          farmId: FARM_ID,
          animalId,
          occurredAt: new Date(Date.now() - 40 * 86_400_000).toISOString(),
          batchId: null,
          toLandUnitId: camp4,
        },
        {
          id: uuidv7(),
          farmId: FARM_ID,
          animalId,
          occurredAt: new Date(Date.now() - 10 * 86_400_000).toISOString(),
          batchId: null,
          toLandUnitId: camp1,
        },
      ]),
    );
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/move');
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /select all shown/i }));
    await user.selectOptions(screen.getByLabelText(/move to which camp/i), camp4!);

    expect(await screen.findByText(/may not be fully rested yet/i)).toBeTruthy();
    // Advisory, never a block.
    expect(screen.getByRole('button', { name: /move them/i }).hasAttribute('disabled')).toBe(false);
  });

  it('says nothing when the owner has not set a threshold', async () => {
    cachedSession(null);
    const [camp1, camp4] = seedCamps('Camp 1', 'Camp 4');
    const [animalId] = seedHerd(1, camp1!);
    window.localStorage.setItem(
      MOVES_KEY,
      JSON.stringify([
        {
          id: uuidv7(),
          farmId: FARM_ID,
          animalId,
          occurredAt: new Date(Date.now() - 40 * 86_400_000).toISOString(),
          batchId: null,
          toLandUnitId: camp4,
        },
        {
          id: uuidv7(),
          farmId: FARM_ID,
          animalId,
          occurredAt: new Date(Date.now() - 10 * 86_400_000).toISOString(),
          batchId: null,
          toLandUnitId: camp1,
        },
      ]),
    );
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/move');
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /select all shown/i }));
    await user.selectOptions(screen.getByLabelText(/move to which camp/i), camp4!);

    expect(screen.queryByText(/may not be fully rested yet/i)).toBeNull();
  });

  it('says nothing until an animal is actually selected — naming a resting camp alone is not a move', async () => {
    // `MoveMobScreen.tsx` gates its destination warning on `wouldMove` (nothing to warn about until
    // there is a group to move); this screen gated only on "is a destination named", so picking a
    // resting camp with NO animal selected yet still rendered a warning for a move that cannot
    // happen — `wouldMove.length === 0` (blocked) but the panel showed anyway.
    cachedSession(30);
    const [camp1, camp4] = seedCamps('Camp 1', 'Camp 4');
    const [animalId] = seedHerd(1, camp1!);
    // Camp 4's own history: this animal was there once, and left 10 days ago — inside a 30-day
    // threshold. Two moves, not one — see the earlier test in this block for why a departure needs
    // the arrival on the log too.
    window.localStorage.setItem(
      MOVES_KEY,
      JSON.stringify([
        {
          id: uuidv7(),
          farmId: FARM_ID,
          animalId,
          occurredAt: new Date(Date.now() - 40 * 86_400_000).toISOString(),
          batchId: null,
          toLandUnitId: camp4,
        },
        {
          id: uuidv7(),
          farmId: FARM_ID,
          animalId,
          occurredAt: new Date(Date.now() - 10 * 86_400_000).toISOString(),
          batchId: null,
          toLandUnitId: camp1,
        },
      ]),
    );
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/move');
    render(<App />);

    // No animal selected — only the destination is named.
    await user.selectOptions(await screen.findByLabelText(/move to which camp/i), camp4!);

    expect(screen.getByRole('button', { name: /move them/i }).hasAttribute('disabled')).toBe(true);
    expect(screen.queryByText(/may not be fully rested yet/i)).toBeNull();
  });
});
