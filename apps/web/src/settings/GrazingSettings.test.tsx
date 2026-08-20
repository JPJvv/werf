/**
 * Settings → Grazing (FR-152, 4e·2). The owner-set rest-period warning threshold: reading what is
 * on the farm, writing a change back to the SERVER (never just the device — `GrazingSettings.tsx`'s
 * own module note on why this is `updateEnterpriseTypes`'s shape, not `saveLocale`'s), and the two
 * refusals a farmer can hit: not the owner, and no connection.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { schemas } from '@werf/core';
import { LocaleProvider } from '../i18n/LocaleProvider';
import { AuthProvider } from '../auth/AuthProvider';
import { App } from '../App';
import { GrazingSettings } from './GrazingSettings';

const SESSION_KEY = 'werf-session';
const FARM_ID = '0190f3a0-0000-7000-8000-0000000000f1';
const OTHER_FARM_ID = '0190f3a0-0000-7000-8000-0000000000f2';

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

function farm(over: Record<string, unknown> = {}) {
  return {
    id: FARM_ID,
    businessId: '0190f3a0-0000-7000-8000-0000000000b1',
    name: 'Rietfontein',
    enterpriseTypes: ['beef_cattle'],
    enterprises: [],
    restPeriodDays: null,
    role: 'owner',
    ...over,
  };
}

function cachedSession(
  farmRow: Record<string, unknown>,
  activeFarmId: string | null = farmRow['id'] as string,
): void {
  const payload = {
    accessToken: 'access-token',
    expiresIn: 900,
    refreshToken: 'refresh-token',
    refreshExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    user: SESSION_USER,
    farms: [farmRow],
    activeFarmId,
    secondFactor: 'complete',
  };
  window.localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ payload, confirmedAt: new Date().toISOString() }),
  );
}

function cachedMultiFarmSession(farms: Array<Record<string, unknown>>): void {
  const payload = {
    accessToken: 'access-token',
    expiresIn: 900,
    refreshToken: 'refresh-token',
    refreshExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    user: SESSION_USER,
    farms,
    activeFarmId: farms[0]!['id'],
    secondFactor: 'complete',
  };
  window.localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ payload, confirmedAt: new Date().toISOString() }),
  );
}

const renderSettings = () =>
  render(
    <LocaleProvider>
      <AuthProvider>
        <GrazingSettings />
      </AuthProvider>
    </LocaleProvider>,
  );

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
});

describe('GrazingSettings (FR-152, 4e·2)', () => {
  it('shows the threshold already on the farm', () => {
    cachedSession(farm({ restPeriodDays: 45 }));
    renderSettings();
    expect(screen.getByLabelText(/rest-period warning threshold/i)).toHaveProperty('value', '45');
  });

  it('writes a new threshold to the server and to the cached session', async () => {
    cachedSession(farm());
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => farm({ restPeriodDays: 30 }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    renderSettings();
    fireEvent.change(screen.getByLabelText(/rest-period warning threshold/i), {
      target: { value: '30' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain(`/farms/${FARM_ID}/rest-period-days`);
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual({ restPeriodDays: 30 });

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Saved'));

    const stored = JSON.parse(window.localStorage.getItem(SESSION_KEY) ?? '{}') as {
      payload?: { farms?: Array<{ restPeriodDays?: unknown }> };
    };
    expect(stored.payload?.farms?.[0]?.restPeriodDays).toBe(30);
  });

  it('writes to the FARM ACTUALLY SHOWN, even when the cached session has no activeFarmId set', async () => {
    // The regression this pins: `AuthProvider`'s `activeFarm` context value falls back to
    // `farms[0]` when `activeFarmId` is null (a session cached before it existed, or one that
    // never explicitly switched) — this screen shows that farm's threshold. `saveRestPeriodDays`
    // read `activeFarmId` directly and bailed on the null, so the save silently failed against a
    // live connection while the screen displayed and let the owner edit a real farm's setting.
    cachedSession(farm(), null);
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => farm({ restPeriodDays: 30 }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    renderSettings();
    fireEvent.change(screen.getByLabelText(/rest-period warning threshold/i), {
      target: { value: '30' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]![0]).toContain(`/farms/${FARM_ID}/rest-period-days`);
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Saved'));
  });

  it('clears the threshold — a real choice the schema must accept, not a blank the form refuses', async () => {
    cachedSession(farm({ restPeriodDays: 30 }));
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => farm({ restPeriodDays: null }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    renderSettings();
    fireEvent.change(screen.getByLabelText(/rest-period warning threshold/i), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toEqual({
      restPeriodDays: null,
    });
  });

  it('is read-only for a member who is not the owner', () => {
    cachedSession(farm({ role: 'manager', restPeriodDays: 30 }));
    renderSettings();

    expect(screen.queryByLabelText(/rest-period warning threshold/i)).toBeNull();
    expect(screen.getByText(/only the farm owner/i)).toBeTruthy();
  });

  it('refuses to save with no connection, and never calls fetch', async () => {
    cachedSession(farm());
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderSettings();
    expect(screen.getByText(/changing this setting needs a connection/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/rest-period warning threshold/i), {
      target: { value: '30' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('clears a "Saved" banner left over from a DIFFERENT farm after switching, through the real shell', async () => {
    // Advisor-caught residue: the effect that re-seeds `days` on a farm switch must not also be
    // the one that clears `saved`/`failed` — that effect ALSO fires on this device's own
    // successful save (which patches `activeFarm.restPeriodDays`), so folding the two together
    // would either race the confirmation away on a real save or leave it stuck after a real
    // switch. Proven through the real shell/`FarmSwitcher`, not the standalone component, because
    // the switch itself lives there.
    cachedMultiFarmSession([
      farm({ name: 'Rietfontein' }),
      farm({ id: OTHER_FARM_ID, name: 'Kudu Ranch', restPeriodDays: 15 }),
    ]);
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => farm({ restPeriodDays: 30 }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    window.history.pushState({}, '', '/settings/grazing');
    render(<App />);

    fireEvent.change(await screen.findByLabelText(/rest-period warning threshold/i), {
      target: { value: '30' },
    });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    // Exact match, not a role query: the shell's own `SyncStatusStrip` is ALSO `role="status"` on
    // every route, so a role-only query here would be ambiguous — "Saved" (this banner) vs. "Saved
    // and sent" (the strip) are deliberately distinct strings for exactly this reason.
    await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy());

    await user.selectOptions(screen.getByRole('combobox', { name: /farm/i }), OTHER_FARM_ID);

    expect(screen.queryByText('Saved')).toBeNull();
    expect(screen.getByLabelText(/rest-period warning threshold/i)).toHaveProperty('value', '15');
  });
});
