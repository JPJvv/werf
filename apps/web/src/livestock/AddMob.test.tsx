/**
 * Recording a group (FR-102) as a smallholder does it: name the flock, say how many head, save —
 * and the farm's live total moves, with no individual animal rows anywhere and no network in the
 * path. Renders the real `<App/>` against a seeded `localStorage`, so the group is read back
 * through the same boot path a cold start uses.
 *
 * The assertion that matters most is the home tile. A farm running 300 sheep as one flock has 300
 * head; a tile that said 0 because there are no `animals` rows would be telling the user this app
 * was not built for them.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { schemas } from '@werf/core';
import { App } from '../App';

const SESSION_KEY = 'werf-session';
const FARM_ID = '0190f3a0-0000-7000-8000-0000000000f1';
const MOBS_KEY = `werf-mobs:${FARM_ID}`;

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

function storedMobs(): Array<Record<string, unknown>> {
  return JSON.parse(window.localStorage.getItem(MOBS_KEY) ?? '[]') as Array<
    Record<string, unknown>
  >;
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, '', '/');
});

afterEach(() => {
  window.localStorage.clear();
});

describe('recording a group (FR-102)', () => {
  it('is a complete record with no individual animals, and it moves the live total', async () => {
    cachedSession();
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/groups/new');
    const { unmount } = render(<App />);

    // One herd, so the farm is asked nothing about which — it is stated instead.
    expect(screen.getByText(/dorper flock/i)).toBeTruthy();

    await user.type(screen.getByLabelText(/what do you call this group/i), 'Flock A');
    await user.type(screen.getByLabelText(/how many head/i), '300');
    await user.click(screen.getByRole('button', { name: /save group/i }));

    const saved = storedMobs();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      farmId: FARM_ID,
      name: 'Flock A',
      // The species follows from the herd, exactly as it does when recording an animal.
      species: 'sheep',
      headCount: 300,
      enterpriseId: FLOCK.id,
    });

    // The home tile counts them. This is the whole point: 300 head, zero animal rows.
    unmount();
    window.history.pushState({}, '', '/');
    render(<App />);
    expect(screen.getByText('300')).toBeTruthy();
  });

  it('does not tell a farm running one flock that it has recorded nothing', async () => {
    cachedSession();
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/groups/new');
    const { unmount } = render(<App />);

    await user.type(screen.getByLabelText(/what do you call this group/i), 'Flock A');
    await user.type(screen.getByLabelText(/how many head/i), '300');
    await user.click(screen.getByRole('button', { name: /save group/i }));

    unmount();
    window.history.pushState({}, '', '/animals');
    render(<App />);

    expect(screen.queryByText(/no animals recorded yet/i)).toBeNull();
    expect(screen.getByText('Flock A')).toBeTruthy();
  });

  it('will not save a group with no name or a head count that is not a whole number', async () => {
    cachedSession();
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/groups/new');
    render(<App />);

    expect(screen.getByRole('button', { name: /save group/i }).hasAttribute('disabled')).toBe(true);

    await user.type(screen.getByLabelText(/what do you call this group/i), 'Flock A');
    await user.type(screen.getByLabelText(/how many head/i), '300.5');
    // Half a sheep is not a head count.
    expect(screen.getByRole('button', { name: /save group/i }).hasAttribute('disabled')).toBe(true);

    expect(storedMobs()).toHaveLength(0);
  });
});
