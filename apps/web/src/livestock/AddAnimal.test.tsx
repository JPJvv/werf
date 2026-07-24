/**
 * Capturing an animal, as a farmer meets it: tap through to "Record an animal", save, and the
 * home tile's head count moves — with nothing touching the network, and still there after the
 * app is closed and reopened. This is the offline-first promise for a capture (FR-101, FR-017,
 * FR-705, NFR-007) proved end to end.
 *
 * Like App.test.tsx, these seed `localStorage` and render the real `<App/>` rather than
 * injecting a store: the local herd is read through the same boot path a reload uses, so a
 * test that bypassed it would prove nothing about a cold start. If any assertion here ever
 * needs a server, the offline promise has been broken.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { schemas } from '@werf/core';
import { App } from '../App';

const SESSION_KEY = 'werf-session';

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

/** Signs in a cattle farm (so the animals tile reads "Herd") with no signal, via cached state. */
function cachedSession(enterpriseTypes: string[] = ['beef_cattle']): void {
  const payload = {
    accessToken: 'access-token',
    expiresIn: 900,
    refreshToken: 'refresh-token',
    refreshExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    user: SESSION_USER,
    farms: [
      {
        id: '0190f3a0-0000-7000-8000-0000000000f1',
        name: 'Rietfontein',
        enterpriseTypes,
        role: 'owner',
      },
    ],
    activeFarmId: '0190f3a0-0000-7000-8000-0000000000f1',
    secondFactor: 'complete',
  };
  window.localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ payload, confirmedAt: new Date().toISOString() }),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, '', '/');
});

afterEach(() => {
  window.localStorage.clear();
});

describe('recording an animal', () => {
  it('starts a new farm at zero head, honestly', () => {
    cachedSession();
    render(<App />);

    const herd = screen.getByRole('link', { name: /herd/i });
    expect(within(herd).getByText('0')).toBeTruthy();
  });

  it('counts a captured animal on the home tile, with no network in the path', async () => {
    cachedSession();
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/new');
    render(<App />);

    // Species is pre-set to the farm's one species (cattle); sex defaults. Just save.
    await user.click(screen.getByRole('button', { name: /save animal/i }));

    // The confirmation the farmer needs to see — never the word "sync", always "saved". (Its
    // full text distinguishes it from the shell's save-status strip, also a live region.)
    expect(screen.getByText(/saved — your work is saved/i)).toBeTruthy();

    // Through the list…
    await user.click(screen.getByRole('link', { name: /done/i }));
    expect(screen.getByText('Cattle')).toBeTruthy();

    // …and home, where the Herd tile now reads one.
    await user.click(screen.getByRole('link', { name: /back to home/i }));
    const herd = screen.getByRole('link', { name: /herd/i });
    expect(within(herd).getByText('1')).toBeTruthy();
  });

  it('keeps the captured animal after the app is closed and reopened (offline durability)', async () => {
    cachedSession();
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/new');
    const { unmount } = render(<App />);
    await user.click(screen.getByRole('button', { name: /save animal/i }));

    // Tear the whole app down and boot it fresh — a phone closed in the veld and opened the
    // next morning. localStorage is all it has; nothing was ever sent anywhere.
    unmount();
    window.history.pushState({}, '', '/');
    render(<App />);

    const herd = screen.getByRole('link', { name: /herd/i });
    expect(within(herd).getByText('1')).toBeTruthy();
  });

  it('offers only the species the farm actually runs', () => {
    cachedSession(['sheep']);
    window.history.pushState({}, '', '/animals/new');
    render(<App />);

    const species = within(screen.getByLabelText(/species/i)).getAllByRole('option');
    expect(species.map((o) => o.textContent)).toEqual(['Sheep']);
  });
});
