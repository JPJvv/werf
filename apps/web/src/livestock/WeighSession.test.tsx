/**
 * Weighing in the crush, as a farmer does it: open the weigh session, type a number, "Save &
 * next", and the reading lands with nothing touching the network and is still there after the
 * phone is closed and reopened (FR-140/141/142, NFR-007). Like AddAnimal.test.tsx these seed
 * `localStorage` and render the real `<App/>`, so both the herd and the weight log are read
 * through the same boot path a cold start uses — a test that injected the stores would prove
 * nothing about durability offline.
 */

import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { schemas } from '@werf/core';
import { App } from '../App';
import { getCurrentFakeLocalDatabase } from '../test-support/local-db';

const SESSION_KEY = 'werf-session';
const FARM_ID = '0190f3a0-0000-7000-8000-0000000000f1';
const HERD_KEY = `werf-herd:${FARM_ID}`;
const WEIGHTS_KEY = `werf-weights:${FARM_ID}`;

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

/** Seed the local herd the way a prior capture would have left it — a bare array, capture order. */
function seedHerd(...animals: Array<Record<string, unknown>>): void {
  window.localStorage.setItem(HERD_KEY, JSON.stringify(animals));
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

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, '', '/');
});

afterEach(() => {
  window.localStorage.clear();
});

describe('the weigh session', () => {
  it('sends the farmer to record an animal first when the herd is empty', () => {
    cachedSession();
    window.history.pushState({}, '', '/weigh');
    render(<App />);

    expect(screen.getByText(/no animals to weigh yet/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /record an animal/i })).toBeTruthy();
  });

  it('captures a weight with no network in the path, and it survives a cold start', async () => {
    cachedSession();
    seedHerd(animal('a1'), animal('a2', { sex: 'male' }));
    const user = userEvent.setup();
    window.history.pushState({}, '', '/weigh');
    const { unmount } = render(<App />);

    // First animal of two, no reading yet.
    expect(await screen.findByText('1 of 2')).toBeTruthy();

    await user.type(screen.getByLabelText(/weight/i), '305');
    await user.click(screen.getByRole('button', { name: /save & next/i }));

    // The save advanced to the second animal — proof the reading committed.
    expect(screen.getByText('2 of 2')).toBeTruthy();

    // Close the phone and open it the next morning: localStorage is all it has, nothing was sent.
    unmount();
    window.history.pushState({}, '', '/weigh');
    render(<App />);

    // Back at the first animal, its saved weight is shown as context.
    expect(await screen.findByText(/last weight/i)).toBeTruthy();
    expect(screen.getByText('305')).toBeTruthy();
  });

  it('walks the whole herd, one animal per screen, to a weighed count', async () => {
    cachedSession();
    seedHerd(animal('a1'), animal('a2', { sex: 'male' }));
    const user = userEvent.setup();
    window.history.pushState({}, '', '/weigh');
    render(<App />);

    await user.type(await screen.findByLabelText(/weight/i), '300');
    await user.click(screen.getByRole('button', { name: /save & next/i }));

    await user.type(screen.getByLabelText(/weight/i), '310');
    await user.click(screen.getByRole('button', { name: /save & next/i }));

    // Past the last animal: the session is done and reports what was weighed.
    expect(screen.getByText('weighed')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('states the growth since the previous weight (ADG), a drought loss included', async () => {
    cachedSession();
    seedHerd(animal('a1'));
    // A reading from a week ago: 300 kg → 314 kg now is +2.00 kg/day over 7 days.
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    window.localStorage.setItem(
      WEIGHTS_KEY,
      JSON.stringify([
        {
          id: 'w1',
          farmId: FARM_ID,
          animalId: 'a1',
          kg: 300,
          method: 'scale',
          occurredAt: weekAgo,
        },
      ]),
    );
    const user = userEvent.setup();
    window.history.pushState({}, '', '/weigh');
    render(<App />);

    // The prior reading is shown as crush context before the new one is taken.
    expect(await screen.findByText('300')).toBeTruthy();

    await user.type(screen.getByLabelText(/weight/i), '314');
    await user.click(screen.getByRole('button', { name: /save & next/i }));

    const status = screen.getByText(/kg\/day/i);
    expect(status).toBeTruthy();
    expect(screen.getByText('+2.00')).toBeTruthy();
  });

  it('⭐ shows the growth since a reading taken on ANOTHER DEVICE, known only via hydration (phase-checklists.md 3e)', async () => {
    // The gap this closes: `useAnimalWeights` read only `LocalWeights` — a reading a co-worker took
    // and the server has replicated down was invisible here, so the "prior weight" crush context
    // and the ADG shown after save both silently ignored the animal's most recent real weigh.
    cachedSession();
    seedHerd(animal('a1'));
    const user = userEvent.setup();
    window.history.pushState({}, '', '/weigh');
    render(<App />);

    const fake = await getCurrentFakeLocalDatabase();
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    act(() => {
      fake.hydrateRow('events', {
        id: '0190f3a0-0000-7000-8000-00000000w099',
        farm_id: FARM_ID,
        animal_id: 'a1',
        type: 'weight',
        occurred_at: weekAgo,
        payload: JSON.stringify({ kg: 300, method: 'scale' }),
      });
    });

    expect(await screen.findByText('300')).toBeTruthy();

    await user.type(screen.getByLabelText(/weight/i), '314');
    await user.click(screen.getByRole('button', { name: /save & next/i }));

    expect(screen.getByText(/kg\/day/i)).toBeTruthy();
    expect(screen.getByText('+2.00')).toBeTruthy();
  });
});
