/**
 * Settings → Language (FR-008). The switch itself, and the half that was missing until now: the
 * change reaching the ACCOUNT, so it is still there after a cold start instead of being reverted by
 * the boot path that re-adopts the stored locale.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { schemas } from '@werf/core';
import { LocaleProvider } from '../i18n/LocaleProvider';
import { AuthProvider } from '../auth/AuthProvider';
import { LanguageSettings } from './LanguageSettings';

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

function cachedSession(): void {
  const payload = {
    accessToken: 'access-token',
    expiresIn: 900,
    refreshToken: 'refresh-token',
    refreshExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    user: SESSION_USER,
    farms: [],
    activeFarmId: null,
    secondFactor: 'complete',
  };
  window.localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ payload, confirmedAt: new Date().toISOString() }),
  );
}

/** The locale the CACHED session carries — what the next cold start will adopt. */
function cachedLocale(): unknown {
  const raw = window.localStorage.getItem(SESSION_KEY);
  const stored = JSON.parse(raw ?? '{}') as { payload?: { user?: { locale?: unknown } } };
  return stored.payload?.user?.locale;
}

/** The screen lives behind the auth guard in the app, so it always has an auth context. */
const renderSettings = () =>
  render(
    <LocaleProvider>
      <AuthProvider>
        <LanguageSettings />
      </AuthProvider>
    </LocaleProvider>,
  );

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('lang');
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('LanguageSettings (FR-008)', () => {
  it('offers English and Afrikaans, each named in its own language', () => {
    renderSettings();
    expect(screen.getByRole('radio', { name: 'English' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Afrikaans' })).toBeTruthy();
  });

  it('switching to Afrikaans re-translates the screen live', () => {
    renderSettings();
    expect(screen.getByRole('heading', { name: 'Language' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Afrikaans' }));
    expect(screen.getByRole('heading', { name: 'Taal' })).toBeTruthy();
  });

  it('writes the choice back to the account, so a cold start keeps it', async () => {
    cachedSession();
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ ...SESSION_USER, locale: 'af-ZA' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    renderSettings();
    fireEvent.click(screen.getByRole('radio', { name: 'Afrikaans' }));

    // The account is told — language belongs to the person, not the phone.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/auth/profile');
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual({ locale: 'af-ZA' });

    // And the cached session is patched, which is the bit that makes it SURVIVE: the boot path
    // re-adopts this value, so a stale one here would silently undo the change on next open.
    await waitFor(() => expect(cachedLocale()).toBe('af-ZA'));
  });

  it('says the phone is switched but the account is not, when there is no signal', async () => {
    cachedSession();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    renderSettings();
    fireEvent.click(screen.getByRole('radio', { name: 'Afrikaans' }));

    // Not an error — the app IS in Afrikaans. It states what is true and what happens next.
    expect(screen.getByRole('heading', { name: 'Taal' })).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toMatch(/rekening sal bykom/i),
    );
  });
});
