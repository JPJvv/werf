/** Farmer-visible offline create/list journey for registered identification marks (FR-601). */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { schemas } from '@werf/core';
import { App } from '../App';
import { storedCaptures } from '../test-support/local-db';

const FARM_ID = '0190f3a0-0000-7000-8000-0000000000f1';
const BRANDING_KEY = `werf-branding:${FARM_ID}`;

function cachedSession(): void {
  const user: schemas.AuthSession['user'] = {
    id: '0190f3a0-0000-7000-8000-000000000001',
    email: 'owner@rietfontein.test',
    phone: null,
    fullName: 'Thabo Mokoena',
    locale: 'en-ZA',
    theme: 'light',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };
  const payload = {
    accessToken: 'access-token',
    expiresIn: 900,
    refreshToken: 'refresh-token',
    refreshExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    user,
    farms: [
      {
        id: FARM_ID,
        name: 'Rietfontein',
        enterpriseTypes: ['beef_cattle'],
        enterprises: [],
        role: 'owner',
      },
    ],
    activeFarmId: FARM_ID,
    secondFactor: 'complete',
  };
  window.localStorage.setItem(
    'werf-session',
    JSON.stringify({ payload, confirmedAt: new Date().toISOString() }),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, '', '/animals/brands');
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
});

afterEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
});

describe('branding register (FR-601)', () => {
  it('saves certificate details locally and lists them again after a cold start', async () => {
    cachedSession();
    const user = userEvent.setup();
    const app = render(<App />);

    await user.type(screen.getByLabelText(/^registered mark$/i), 'am7');
    await user.selectOptions(screen.getByLabelText(/marking method/i), 'hot_brand');
    await user.type(screen.getByLabelText(/body position/i), 'left hip');
    await user.type(screen.getByLabelText(/certificate reference/i), 'AIS-2026-0042');
    await user.type(screen.getByLabelText(/registration date/i), '2026-07-01');
    await user.click(screen.getByRole('button', { name: /save registered mark/i }));

    expect(screen.getByText(/saved — your work is saved/i)).toBeTruthy();
    const [stored] = await storedCaptures<schemas.NewBrandingRegister>(BRANDING_KEY);
    expect(stored).toMatchObject({
      mark: 'AM7',
      markType: 'hot_brand',
      species: ['cattle'],
      bodyPosition: 'left hip',
      certificateReference: 'AIS-2026-0042',
      registeredAt: '2026-07-01',
    });

    app.unmount();
    window.history.pushState({}, '', '/animals/brands');
    render(<App />);

    await waitFor(() => {
      const list = screen.getByRole('list', { name: /registered marks/i });
      expect(within(list).getByText('AM7')).toBeTruthy();
      expect(within(list).getByText(/AIS-2026-0042/)).toBeTruthy();
    });
  });
});
