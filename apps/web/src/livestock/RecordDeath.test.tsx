/**
 * Recording a loss, and the herd count finally going DOWN. A death is captured offline as a
 * lifecycle event, the projection folds it onto the herd through the domain state machine, and the
 * animal drops from the live count while staying in the list, marked — retained forever (FR-105,
 * FR-705, FR-017). Like the other capture journeys these seed `localStorage` and render the real
 * `<App/>`, so both the herd and the lifecycle log are read through the same boot path a cold start
 * uses; nothing touches the network.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { schemas } from '@werf/core';
import { App } from '../App';

const SESSION_KEY = 'werf-session';
const FARM_ID = '0190f3a0-0000-7000-8000-0000000000f1';
const HERD_KEY = `werf-herd:${FARM_ID}`;
const EVENTS_KEY = `werf-events:${FARM_ID}`;

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

function seedHerd(...animals: Array<Record<string, unknown>>): void {
  window.localStorage.setItem(HERD_KEY, JSON.stringify(animals));
}

function seedDeath(animalId: string): void {
  window.localStorage.setItem(
    EVENTS_KEY,
    JSON.stringify([
      {
        id: 'e1',
        farmId: FARM_ID,
        animalId,
        type: 'death',
        status: 'dead',
        occurredAt: new Date().toISOString(),
        cause: 'illness',
      },
    ]),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, '', '/');
});

afterEach(() => {
  window.localStorage.clear();
});

describe('recording a loss', () => {
  it('has nothing to record against when there are no live animals', () => {
    cachedSession();
    window.history.pushState({}, '', '/animals/loss');
    render(<App />);

    expect(screen.getByText(/no live animals to record a loss against/i)).toBeTruthy();
  });

  it('captures a death offline and takes the animal out of the live herd', async () => {
    cachedSession();
    seedHerd(animal('a1', { sex: 'female' }), animal('a2', { sex: 'male' }));
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/loss');
    render(<App />);

    // Pick the animal that died, give a cause, record it.
    await user.click(screen.getByRole('button', { name: /female/i }));
    await user.type(screen.getByLabelText(/cause/i), 'Snakebite');
    await user.click(screen.getByRole('button', { name: /record death/i }));

    expect(screen.getByText(/marked dead/i)).toBeTruthy();
    // The dead animal is gone from the live pick list — only the bull is left to record against.
    expect(screen.queryByRole('button', { name: /female/i })).toBeNull();
    expect(screen.getByRole('button', { name: /male/i })).toBeTruthy();
  });

  it('drops the home tile count when an animal is lost, and it survives a cold start', () => {
    cachedSession();
    seedHerd(animal('a1'), animal('a2'));
    seedDeath('a1');
    render(<App />);

    // Two animals recorded, one dead: the Herd tile reads one, folded on boot from the log.
    const herd = screen.getByRole('link', { name: /herd/i });
    expect(within(herd).getByText('1')).toBeTruthy();
  });

  it('keeps the dead animal in the list marked, and the weigh session skips it', () => {
    cachedSession();
    seedHerd(animal('a1', { sex: 'female' }), animal('a2', { sex: 'male' }));
    seedDeath('a1');

    window.history.pushState({}, '', '/animals');
    const { unmount } = render(<App />);
    // Retained, not erased: still listed, now marked.
    expect(screen.getByText(/dead/i)).toBeTruthy();
    unmount();

    window.history.pushState({}, '', '/weigh');
    render(<App />);
    // Only the live animal is offered in the crush.
    expect(screen.getByText('1 of 1')).toBeTruthy();
  });
});
