/**
 * Moving a group (FR-151) as a farmer does it: pick the flock, name the camp it walked to. Renders
 * the real `<App/>` against a seeded `localStorage`.
 *
 * The design point under test: a group-only flock had no way to record a camp move at all before
 * this screen (`phase-checklists.md` 4e·1) — `mobs.land_unit_id` was written once, at creation, and
 * never again. So the assertion that matters most here is not just "the capture is stored", but
 * that the SCREEN's own list reflects the new camp immediately, offline, from the just-captured
 * local move — the same "not stale until reconnect" property `MoveAnimals.test.tsx` proves for an
 * individual animal's walk (`herd.ts`'s `positionByMob`).
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { uuidv7, type schemas } from '@werf/core';
import { App } from '../App';
import { storedCaptures } from '../test-support/local-db';

const SESSION_KEY = 'werf-session';
const FARM_ID = '0190f3a0-0000-7000-8000-0000000000f2';
const LAND_KEY = `werf-land:${FARM_ID}`;
const MOBS_KEY = `werf-mobs:${FARM_ID}`;
const MOB_MOVES_KEY = `werf-mob-moves:${FARM_ID}`;

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
        enterpriseTypes: ['sheep_wool'],
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

function seedMob(name: string, landUnitId: string | null): string {
  const id = uuidv7();
  window.localStorage.setItem(
    MOBS_KEY,
    JSON.stringify([
      {
        id,
        farmId: FARM_ID,
        enterpriseId: null,
        name,
        species: 'sheep',
        landUnitId,
        headCount: 300,
        initialHeadCount: 300,
      },
    ]),
  );
  return id;
}

function storedMobMoves(): Promise<readonly Record<string, unknown>[]> {
  return storedCaptures<Record<string, unknown>>(MOB_MOVES_KEY);
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, '', '/');
});

afterEach(() => {
  window.localStorage.clear();
});

describe('moving a group (FR-151)', () => {
  it('walks a flock to another camp, and the list reflects it immediately, offline', async () => {
    cachedSession();
    const [camp1, camp4] = seedCamps('Camp 1', 'Camp 4');
    seedMob('Flock A', camp1!);
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/groups/move');
    const { unmount } = render(<App />);

    await user.click(await screen.findByRole('button', { name: /Flock A/ }));
    await user.selectOptions(screen.getByLabelText(/move to which camp/i), camp4!);
    await user.click(screen.getByRole('button', { name: /move them/i }));

    // append() commits to the in-memory snapshot synchronously (NFR-007), but persistence to the
    // SQLite-backed store is fire-and-forget — wait for it to land before reading it back.
    let moves: readonly Record<string, unknown>[] = [];
    await waitFor(async () => {
      moves = await storedMobMoves();
      expect(moves).toHaveLength(1);
    });
    expect(moves[0]!['toLandUnitId']).toBe(camp4);
    expect(moves[0]).not.toHaveProperty('animalId');

    // The SAME render, no reload: the picker's own row must already read the new camp — proving
    // `herd.ts`'s `positionByMob` fold, not just that the capture landed in the store.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Flock A/ }).textContent).toContain('Camp 4');
    });

    // Closed and reopened, offline, it is still there — no server involved.
    unmount();
    window.history.pushState({}, '', '/animals/groups/move');
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Flock A/ }).textContent).toContain('Camp 4');
    });
  });

  it('refuses a move that leaves the flock in the same camp', async () => {
    cachedSession();
    const [camp1] = seedCamps('Camp 1');
    seedMob('Flock A', camp1!);
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/groups/move');
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /Flock A/ }));
    await user.selectOptions(screen.getByLabelText(/move to which camp/i), camp1!);
    expect(screen.getByRole('button', { name: /move them/i }).hasAttribute('disabled')).toBe(true);

    expect(await storedMobMoves()).toHaveLength(0);
  });

  it('says there is nowhere to move to, and offers the way out', async () => {
    cachedSession();
    seedMob('Flock A', null);
    window.history.pushState({}, '', '/animals/groups/move');
    render(<App />);

    expect(await screen.findByText(/no camps yet/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /add a camp/i })).toBeTruthy();
  });

  it('says there are no groups yet, when there is nothing to move', async () => {
    cachedSession();
    seedCamps('Camp 1');
    window.history.pushState({}, '', '/animals/groups/move');
    render(<App />);

    expect(await screen.findByText(/no groups to move yet/i)).toBeTruthy();
  });
});
