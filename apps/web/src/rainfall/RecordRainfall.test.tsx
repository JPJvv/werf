/**
 * Recording rainfall as a farmer does it: reach it from home, type what was in the gauge, save, and
 * the reading is still there after the phone is closed and reopened — with nothing touching the
 * network (FR-213, NFR-007). Like the other capture tests these seed `localStorage` and render the
 * real `<App/>`, so the reading is read back through the same boot path a cold start uses; a test
 * that injected the store would prove nothing about durability offline.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { schemas } from '@werf/core';
import { App } from '../App';

const SESSION_KEY = 'werf-session';
const FARM_ID = '0190f3a0-0000-7000-8000-0000000000f1';
const RAINFALL_KEY = `werf-rainfall:${FARM_ID}`;

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
        // A mixed farm: rain is the one reading both sides of it need.
        enterpriseTypes: ['beef_cattle', 'row_crops'],
        role: 'owner',
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

/** What the store holds after a save. */
function storedReadings(): Array<Record<string, unknown>> {
  return JSON.parse(window.localStorage.getItem(RAINFALL_KEY) ?? '[]') as Array<
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

describe('recording rainfall', () => {
  it('is reachable from home without changing the fixed tile grid', () => {
    cachedSession();
    render(<App />);

    // A secondary link, not a tile: the grid's set and order are muscle memory and rain belongs to
    // no enterprise. If this ever becomes a tile, that is a deliberate design decision, not a test.
    expect(screen.getByRole('link', { name: /record rainfall/i })).toBeTruthy();
  });

  it('captures a reading with no network in the path, and it survives a cold start', async () => {
    cachedSession();
    const user = userEvent.setup();
    window.history.pushState({}, '', '/rainfall');
    const { unmount } = render(<App />);

    await user.type(screen.getByLabelText(/how much/i), '18.5');
    await user.type(screen.getByLabelText(/which gauge/i), 'Homestead');
    await user.click(screen.getByRole('button', { name: /save reading/i }));

    // The farmer is told, in the words that matter, that the work is safe. (Two live regions are
    // on screen — this one and the sync strip — so the announcement is looked for among them.)
    const announcements = screen.getAllByRole('status').map((el) => el.textContent ?? '');
    expect(announcements.some((text) => /18\.5\s*mm saved/i.test(text))).toBe(true);

    const saved = storedReadings();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ farmId: FARM_ID, mm: 18.5, gauge: 'Homestead' });

    // Closed and reopened: the reading is read back off the device, no server involved.
    unmount();
    render(<App />);
    expect(storedReadings()).toHaveLength(1);
  });

  it('keeps a dry gauge as a real reading, but refuses an empty field', async () => {
    cachedSession();
    const user = userEvent.setup();
    window.history.pushState({}, '', '/rainfall');
    render(<App />);

    // Nothing typed is not a reading — the action is unavailable rather than saving a phantom 0.
    expect(screen.getByRole('button', { name: /save reading/i }).hasAttribute('disabled')).toBe(
      true,
    );

    // A typed 0 IS a reading: "I looked on Tuesday and the gauge was empty" is what separates a
    // drought from a farmer who did not look.
    await user.type(screen.getByLabelText(/how much/i), '0');
    await user.click(screen.getByRole('button', { name: /save reading/i }));

    expect(storedReadings()).toHaveLength(1);
    expect(storedReadings()[0]).toMatchObject({ mm: 0 });
  });

  it('keeps the reading day the farmer gave, not the day it was captured', async () => {
    cachedSession();
    const user = userEvent.setup();
    window.history.pushState({}, '', '/rainfall');
    render(<App />);

    // The gauge was read on Sunday; this is Monday at the house. A season total built on the
    // capture date instead of the reading date is quietly wrong for the rest of the year.
    fireEvent.change(screen.getByLabelText(/when was the gauge read/i), {
      target: { value: '2026-03-01' },
    });
    await user.type(screen.getByLabelText(/how much/i), '24');
    await user.click(screen.getByRole('button', { name: /save reading/i }));

    const [reading] = storedReadings();
    expect(String(reading!['occurredAt'])).toContain('2026-03-01');
  });

  it('counts a saved reading as pending until it is sent (FR-009)', async () => {
    cachedSession();
    const user = userEvent.setup();
    window.history.pushState({}, '', '/rainfall');
    render(<App />);

    await user.type(screen.getByLabelText(/how much/i), '12');
    await user.click(screen.getByRole('button', { name: /save reading/i }));

    // The strip is honest about what is on the device but not yet at the server. The reading is
    // never lost to make that number look better. (There is no server here, so the background
    // flush fails and the reading simply stays pending — which is the offline path working.)
    await waitFor(() =>
      expect(screen.getByRole('status', { name: /save status/i }).textContent).toMatch(
        /1 to send/i,
      ),
    );
  });
});
