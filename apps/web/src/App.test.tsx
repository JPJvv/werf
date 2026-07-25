/**
 * The shell as a farmer meets it: signed out you get a way in, signed in you get your
 * farm — and the signed-in case must work with the network off, from what is already on
 * the device (FR-006).
 *
 * These seed `localStorage` directly rather than injecting a store, because that IS the
 * boot path: the provider reads the real storage during its first render, and a test that
 * bypassed it would prove nothing about a cold start.
 */

import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { schemas } from '@werf/core';
import { App } from './App';

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

function cachedSession(overrides: Partial<schemas.AuthSession> = {}): void {
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
        enterpriseTypes: ['beef_cattle', 'row_crops'],
        role: 'owner',
      },
    ],
    activeFarmId: '0190f3a0-0000-7000-8000-0000000000f1',
    secondFactor: 'complete',
    ...overrides,
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

describe('arriving signed out', () => {
  it('offers a way in rather than an empty shell', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: /sign in/i })).toBeTruthy();
    expect(screen.getByLabelText(/email address/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /register/i })).toBeTruthy();
  });

  it('does not leak the farm behind the guard', () => {
    render(<App />);
    expect(screen.queryByRole('link', { name: /herd/i })).toBeNull();
  });
});

describe('arriving signed in, with no signal', () => {
  it('renders the active farm from what is already on the device', () => {
    // Nothing here touches the network. If this test ever needs a server, the offline
    // promise in FR-006 has been broken.
    cachedSession();
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Rietfontein' })).toBeTruthy();
  });

  it('shows the enterprise-adapted grid — a mixed farm has Herd and Blocks, never Camps', () => {
    cachedSession();
    render(<App />);

    expect(screen.getByRole('link', { name: /herd/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /blocks/i })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /camps/i })).toBeNull();
  });

  it('adapts to the farm in the session, not to a hardcoded one', () => {
    // The regression this pins: the demo farm that used to live in HomeScreen. A vineyard
    // must never see Herd, and it only does if the grid reads the real session.
    cachedSession({
      farms: [
        {
          id: '0190f3a0-0000-7000-8000-0000000000f2',
          name: 'Vinkel Lande',
          enterpriseTypes: ['vineyards'],
          enterprises: [],
          role: 'owner',
        },
      ],
      activeFarmId: '0190f3a0-0000-7000-8000-0000000000f2',
    });
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Vinkel Lande' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /blocks/i })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /herd/i })).toBeNull();
  });

  it('guides the first run in the same words the grid uses (FR-010)', () => {
    cachedSession();
    render(<App />);

    // The regression this pins: the guide used to re-derive the land word and told a
    // mixed farm to "add your first camp" directly beneath a tile labelled "Blocks".
    // Both now come from the terminology layer, so a mixed farm says "block" in both places.
    expect(screen.getByRole('link', { name: /blocks/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /add your first block/i })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /add your first camp/i })).toBeNull();

    // What goes ON the land keeps the animal vocabulary — an animal is what a mixed
    // farmer captures first and most often.
    expect(screen.getByRole('link', { name: /first animal/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /first employee/i })).toBeTruthy();
  });

  it('uses camp vocabulary on a farm with no crops at all', () => {
    cachedSession({
      farms: [
        {
          id: '0190f3a0-0000-7000-8000-0000000000f3',
          name: 'Kudu Ranch',
          enterpriseTypes: ['beef_cattle'],
          enterprises: [],
          role: 'owner',
        },
      ],
      activeFarmId: '0190f3a0-0000-7000-8000-0000000000f3',
    });
    render(<App />);

    expect(screen.getByRole('link', { name: /camps/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /add your first camp/i })).toBeTruthy();
  });
});

describe('the language on a borrowed device (FR-008)', () => {
  it('follows the account, not the tablet it is opened on', () => {
    // The scenario: a farmer who chose Afrikaans signs in on the bakkie's tablet, which
    // has never been told anything. Locale lives on the USER row, so it travels with them.
    cachedSession({ user: { ...SESSION_USER, locale: 'af-ZA' } });
    render(<App />);

    expect(screen.getByRole('link', { name: 'Instellings' })).toBeTruthy();
    expect(document.documentElement.getAttribute('lang')).toBe('af-ZA');
  });

  it('falls back to the device preference before anyone is signed in', () => {
    window.localStorage.setItem('werf-locale', 'af-ZA');
    render(<App />);

    // Signed out there is no user to ask, so the device's choice is the best guess.
    expect(screen.getByRole('heading', { name: /meld aan/i })).toBeTruthy();
  });
});

describe('a session older than the offline window', () => {
  it('asks for a sign-in rather than opening on stale data', () => {
    cachedSession();
    const stored = JSON.parse(window.localStorage.getItem(SESSION_KEY)!) as {
      payload: unknown;
    };
    window.localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        payload: stored.payload,
        confirmedAt: new Date(Date.now() - 40 * 86_400_000).toISOString(),
      }),
    );

    render(<App />);

    expect(screen.getByRole('heading', { name: /sign in/i })).toBeTruthy();
  });
});

describe('an owner who still owes a second factor', () => {
  it('is sent to enrolment, because the server refuses everything else', () => {
    cachedSession({ secondFactor: 'required' });
    render(<App />);

    expect(screen.getByRole('heading', { name: /protect this account/i })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /herd/i })).toBeNull();
  });
});
