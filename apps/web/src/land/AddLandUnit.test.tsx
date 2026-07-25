/**
 * Adding a camp as a farmer does it (FR-150): follow the first-run guide's own link, name the
 * ground, save, and it is still there after the phone is closed and reopened — with nothing
 * touching the network (NFR-007). Like the other capture tests these seed `localStorage` and render
 * the real `<App/>`, so the camp is read back through the same boot path a cold start uses.
 *
 * The terminology cases are the ones worth the most here. A camp and a block are the same row
 * wearing different words, and the whole point of the terminology layer is that a vineyard owner is
 * never told to add a camp. That is a per-farm assertion, not a per-screen one, so it is tested by
 * rendering two different farms rather than by calling `landTerm` directly.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { schemas } from '@werf/core';
import { App } from '../App';

const SESSION_KEY = 'werf-session';
const FARM_ID = '0190f3a0-0000-7000-8000-0000000000f1';
const LAND_KEY = `werf-land:${FARM_ID}`;

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

function cachedSession(enterpriseTypes: string[] = ['beef_cattle']): void {
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
        enterpriseTypes,
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

/** What the local land register holds after a save. */
function storedUnits(): Array<Record<string, unknown>> {
  return JSON.parse(window.localStorage.getItem(LAND_KEY) ?? '[]') as Array<
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

describe('adding a camp (FR-150)', () => {
  it('is where the first-run guide has been pointing all along', async () => {
    cachedSession();
    const user = userEvent.setup();
    render(<App />);

    // The guide's land step. Following it used to land on a placeholder.
    await user.click(screen.getByRole('link', { name: /add your first camp/i }));

    expect(screen.getByRole('link', { name: /add a camp/i })).toBeTruthy();
  });

  it('captures a camp with no network in the path, and it survives a cold start', async () => {
    cachedSession();
    const user = userEvent.setup();
    window.history.pushState({}, '', '/land/new');
    const { unmount } = render(<App />);

    await user.type(screen.getByLabelText(/camp name or number/i), 'Camp 3');
    await user.type(screen.getByLabelText(/description/i), 'Fonteinkamp');
    await user.type(screen.getByLabelText(/hectares/i), '42.5');
    await user.type(screen.getByLabelText(/grazing capacity/i), '18');
    await user.click(screen.getByRole('button', { name: /save camp/i }));

    const announcements = screen.getAllByRole('status').map((el) => el.textContent ?? '');
    expect(announcements.some((text) => /Camp 3 saved/i.test(text))).toBe(true);

    const saved = storedUnits();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      farmId: FARM_ID,
      kind: 'camp',
      code: 'Camp 3',
      name: 'Fonteinkamp',
      hectares: 42.5,
      carryingCapacityLsu: 18,
    });

    // Closed and reopened: the camp is read back off the device, no server involved.
    unmount();
    window.history.pushState({}, '', '/land');
    render(<App />);
    expect(screen.getByText('Camp 3')).toBeTruthy();
  });

  it('speaks the farm’s own word for a piece of ground, and asks a vineyard nothing about grazing', async () => {
    cachedSession(['vineyards']);
    const user = userEvent.setup();
    window.history.pushState({}, '', '/land/new');
    render(<App />);

    expect(screen.getByLabelText(/block name or number/i)).toBeTruthy();
    // Large stock units mean nothing on a vineyard, so the question is not asked at all.
    expect(screen.queryByLabelText(/grazing capacity/i)).toBeNull();

    await user.type(screen.getByLabelText(/block name or number/i), 'B12');
    await user.click(screen.getByRole('button', { name: /save block/i }));

    expect(storedUnits()[0]).toMatchObject({ kind: 'block', code: 'B12' });
  });

  it('refuses a name the farm already uses, and says what to do instead', async () => {
    cachedSession();
    const user = userEvent.setup();
    window.history.pushState({}, '', '/land/new');
    render(<App />);

    await user.type(screen.getByLabelText(/camp name or number/i), 'Camp 3');
    await user.click(screen.getByRole('button', { name: /save camp/i }));

    // The same name again. Caught HERE, against what the device already holds, rather than days
    // later when the queue finally reaches a server and cannot drain.
    await user.type(screen.getByLabelText(/camp name or number/i), 'camp 3');
    expect(screen.getByText(/already has a camp with that name/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /save camp/i }).hasAttribute('disabled')).toBe(true);

    expect(storedUnits()).toHaveLength(1);
  });

  it('will not save nothing, and will not save a measurement that is not a number', async () => {
    cachedSession();
    const user = userEvent.setup();
    window.history.pushState({}, '', '/land/new');
    render(<App />);

    // A camp with no name is not a camp.
    expect(screen.getByRole('button', { name: /save camp/i }).hasAttribute('disabled')).toBe(true);

    await user.type(screen.getByLabelText(/camp name or number/i), 'Camp 4');
    await user.type(screen.getByLabelText(/hectares/i), 'about forty');
    expect(screen.getByRole('button', { name: /save camp/i }).hasAttribute('disabled')).toBe(true);

    expect(storedUnits()).toHaveLength(0);
  });
});
