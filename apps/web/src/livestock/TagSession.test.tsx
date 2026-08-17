/**
 * Tagging as a farmer does it (FR-109): work down a race giving animals their numbers, offline, and
 * find those numbers still there — and used as the animal's NAME everywhere else — after the phone
 * is closed and reopened. Renders the real `<App/>` against a seeded `localStorage`, so the numbers
 * are read back through the same boot path a cold start uses.
 *
 * The case worth the most is the duplicate. In a crush a repeated number is nearly always a misread
 * digit, and the app must say so BEFORE the save rather than letting it sit in a queue that cannot
 * drain days later.
 */

import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { uuidv7, type schemas } from '@werf/core';
import { App } from '../App';
import { getCurrentFakeLocalDatabase, storedCaptures } from '../test-support/local-db';

const SESSION_KEY = 'werf-session';
const FARM_ID = '0190f3a0-0000-7000-8000-0000000000f1';
const HERD_KEY = `werf-herd:${FARM_ID}`;
const IDENTIFIERS_KEY = `werf-identifiers:${FARM_ID}`;

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

/** A herd of `count` untagged cattle already on the device. */
function seedHerd(count: number): string[] {
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
        mobId: null,
        landUnitId: null,
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

function storedIdentifiers(): Promise<readonly Record<string, unknown>[]> {
  return storedCaptures<Record<string, unknown>>(IDENTIFIERS_KEY);
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, '', '/');
});

afterEach(() => {
  window.localStorage.clear();
});

describe('tagging animals (FR-109)', () => {
  it('walks the untagged animals one at a time, saving each with no network in the path', async () => {
    cachedSession();
    seedHerd(2);
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/tag');
    render(<App />);

    expect(await screen.findByText(/1 of 2/i)).toBeTruthy();

    await user.type(screen.getByLabelText(/number/i), '4021');
    await user.click(screen.getByRole('button', { name: /save & next/i }));

    // Save advanced to the next animal without a round trip through a list.
    expect(screen.getByText(/2 of 2/i)).toBeTruthy();

    await user.type(screen.getByLabelText(/number/i), '4022');
    await user.click(screen.getByRole('button', { name: /save & next/i }));

    // Past the last untagged animal: the session is done and reports what it did.
    expect(screen.getByText('tagged')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();

    await waitFor(async () => {
      expect(await storedIdentifiers()).toHaveLength(2);
    });
    const saved = await storedIdentifiers();
    expect(saved.map((i) => i['value'])).toEqual(['4021', '4022']);
    // The first number an animal gets is the one it will be called by.
    expect(saved.every((i) => i['isPrimary'] === true)).toBe(true);
  });

  it('refuses a number already on another animal, before it is saved', async () => {
    cachedSession();
    seedHerd(2);
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/tag');
    render(<App />);

    await user.type(await screen.findByLabelText(/number/i), '4021');
    await user.click(screen.getByRole('button', { name: /save & next/i }));

    // The same number on the next animal — a misread digit, caught here rather than in a queue.
    await user.type(screen.getByLabelText(/number/i), '4021');
    expect(screen.getByText(/already on another animal/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /save & next/i }).hasAttribute('disabled')).toBe(
      true,
    );

    await waitFor(async () => {
      expect(await storedIdentifiers()).toHaveLength(1);
    });
  });

  it('⭐ refuses a number already tagged on ANOTHER DEVICE, known only via hydration (phase-checklists.md 3e)', async () => {
    // The gap this closes: `useTakenValues()` read only `LocalIdentifiers` — a tag another device
    // applied and the server has replicated down was invisible to this guard, so a misread digit
    // that happened to collide with a co-worker's already-sent tag would save locally and jam the
    // outbox days later with a refusal nothing on the phone explained.
    cachedSession();
    seedHerd(1);
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/tag');
    render(<App />);

    const fake = await getCurrentFakeLocalDatabase();
    act(() => {
      fake.hydrateRow('animal_identifiers', {
        id: '0190f3a0-0000-7000-8000-00000000i001',
        farm_id: FARM_ID,
        animal_id: '0190f3a0-0000-7000-8000-00000000a099',
        type: 'visual_tag',
        value: '4021',
        is_primary: 1,
        applied_at: null,
      });
    });

    await user.type(await screen.findByLabelText(/number/i), '4021');

    await waitFor(() => {
      expect(screen.getByText(/already on another animal/i)).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: /save & next/i }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(await storedIdentifiers()).toHaveLength(0);
  });

  it('makes the number the animal’s name on the list, and survives a cold start', async () => {
    cachedSession();
    seedHerd(1);
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/tag');
    const { unmount } = render(<App />);

    await user.type(await screen.findByLabelText(/number/i), '4021');
    await user.click(screen.getByRole('button', { name: /save & next/i }));

    // Closed and reopened, on the animals list: the animal is now called 4021, not "Cattle".
    unmount();
    window.history.pushState({}, '', '/animals');
    render(<App />);

    const row = within(await screen.findByRole('list', { name: /^animals$/i })).getByRole(
      'listitem',
    );
    expect(within(row).getByText('4021')).toBeTruthy();
  });

  it('says which animals still need a number, rather than showing a blank', async () => {
    cachedSession();
    seedHerd(1);
    window.history.pushState({}, '', '/animals');
    render(<App />);

    // "Which ones still need tagging" is a real question a farmer asks before opening the race.
    expect(await screen.findByText(/without a number/i)).toBeTruthy();
  });

  it('says so plainly when there is nothing left to tag', async () => {
    cachedSession();
    const [animalId] = seedHerd(1);
    window.localStorage.setItem(
      IDENTIFIERS_KEY,
      JSON.stringify([
        {
          id: uuidv7(),
          farmId: FARM_ID,
          animalId,
          type: 'visual_tag',
          value: '4021',
          isPrimary: true,
          appliedAt: null,
        },
      ]),
    );
    window.history.pushState({}, '', '/animals/tag');
    render(<App />);

    expect(await screen.findByText(/every animal already has a number/i)).toBeTruthy();
  });
});
