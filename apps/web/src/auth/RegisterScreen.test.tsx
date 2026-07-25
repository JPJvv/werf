/**
 * The onboarding journey the Phase 1 exit gate names: register → choose enterprises →
 * enrol the second factor → reach the adaptive grid.
 *
 * Nothing here seeds a session. That matters: an earlier version of these tests proved the
 * grid by writing `secondFactor: 'complete'` straight into localStorage, which fabricated
 * the one state the real register flow could not produce — and hid the fact that a newly
 * registered owner was confined to a dead-end screen.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';

const OWNER = {
  id: '0190f3a0-0000-7000-8000-000000000001',
  email: 'thabo@rietfontein.test',
  phone: null,
  fullName: 'Thabo Mokoena',
  locale: 'en-ZA',
  theme: 'light',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  deletedAt: null,
};

const FARM = {
  id: '0190f3a0-0000-7000-8000-0000000000f1',
  name: 'Rietfontein',
  enterpriseTypes: ['beef_cattle', 'row_crops'],
  role: 'owner',
};

function session(secondFactor: 'required' | 'complete') {
  return {
    accessToken: 'access-token',
    expiresIn: 900,
    refreshToken: `refresh-${secondFactor}`,
    refreshExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    user: OWNER,
    farms: [FARM],
    activeFarmId: FARM.id,
    secondFactor,
  };
}

/** Routes by URL, the way the real API does — the flow calls four different endpoints. */
function stubApi() {
  const calls: { url: string; body: unknown }[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });

      const reply = (body: unknown, status = 200) =>
        Promise.resolve({
          ok: status < 400,
          status,
          json: () => Promise.resolve(body),
        } as Response);

      // A freshly registered owner ALWAYS owes an enrolment — mandatory for owners
      // (FR-014), enforced by the API guard.
      if (url.endsWith('/auth/register')) return reply(session('required'));
      if (url.endsWith('/auth/2fa/totp')) {
        return reply({ secret: 'GEZDGNBVGY3TQOJQ', uri: 'otpauth://totp/Werf:thabo' });
      }
      if (url.endsWith('/auth/2fa/totp/confirm')) {
        return reply({
          recoveryCodes: Array.from({ length: 10 }, (_, i) => `AAAA${i}-BBBB${i}`),
        });
      }
      // After enrolment the account's posture has changed; refresh re-reads it.
      if (url.endsWith('/auth/refresh')) return reply(session('complete'));

      return reply({ code: 'UNKNOWN', message: 'unexpected call' }, 500);
    }),
  );

  return calls;
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, '', '/register');
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

async function fillRegistration(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/business name/i), 'Rietfontein Boerdery');
  await user.type(screen.getByLabelText(/farm name/i), 'Rietfontein');
  await user.click(screen.getByRole('checkbox', { name: /beef cattle/i }));
  await user.click(screen.getByRole('checkbox', { name: /row crops/i }));
  await user.type(screen.getByLabelText(/your full name/i), 'Thabo Mokoena');
  await user.type(screen.getByLabelText(/email address/i), 'thabo@rietfontein.test');
  await user.type(screen.getByLabelText(/password/i), 'correct horse battery staple');
}

describe('onboarding in Afrikaans (FR-008)', () => {
  it('lets a farmer choose their language BEFORE signing in, and creates the account in it', async () => {
    // The remainder Phase 1 named: the language control sat behind the auth guard, so a farmer on
    // a fresh device could only ever submit the default. An Afrikaans farmer could not create an
    // Afrikaans account, and the first thing the product said to them was in the wrong language.
    const calls = stubApi();
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Afrikaans' }));

    // The form itself is now Afrikaans — proven by filling it in with Afrikaans labels.
    await user.type(screen.getByLabelText('Besigheidsnaam'), 'Rietfontein Boerdery');
    await user.type(screen.getByLabelText('Plaasnaam'), 'Rietfontein');
    await user.click(screen.getByRole('checkbox', { name: /beef cattle/i }));
    await user.type(screen.getByLabelText('Jou volle naam'), 'Thabo Mokoena');
    await user.type(screen.getByLabelText('E-posadres'), 'thabo@rietfontein.test');
    await user.type(screen.getByLabelText('Wagwoord'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: 'Skep my plaas' }));

    const register = calls.find((call) => call.url.endsWith('/auth/register'));
    const body = register?.body as { owner?: { locale?: string } };
    // The ACCOUNT is Afrikaans, not just this phone — so it follows them onto a borrowed tablet.
    expect(body.owner?.locale).toBe('af-ZA');
  });
});

describe('registering a farm business', () => {
  it('walks register → enrol → the adaptive grid, with no session hand-seeded', async () => {
    const calls = stubApi();
    const user = userEvent.setup();
    render(<App />);

    await fillRegistration(user);
    await user.click(screen.getByRole('button', { name: /create my farm/i }));

    // Registration lands on enrolment, because an owner must have a second factor.
    expect(await screen.findByRole('heading', { name: /protect this account/i })).toBeTruthy();

    // `find`, not `get`: the heading is present while the seed is still being fetched, so
    // asserting the link synchronously races the request that produces it.
    expect(await screen.findByRole('link', { name: /open my authenticator app/i })).toBeTruthy();
    expect(screen.getByText(/GEZD/)).toBeTruthy();

    await user.type(screen.getByLabelText(/^code$/i), '123456');
    await user.click(screen.getByRole('button', { name: /confirm/i }));

    // Recovery codes, shown once (FR-014a).
    expect(await screen.findByRole('heading', { name: /write these down/i })).toBeTruthy();
    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(10);
    expect(screen.getByText(/only time these are shown/i)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /i have saved them/i }));

    // And finally the grid, adapted to the enterprises chosen at onboarding (FR-002).
    expect(await screen.findByRole('heading', { name: 'Rietfontein' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /herd/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /blocks/i })).toBeTruthy();

    // The enterprise choice really was sent, not just rendered locally.
    expect(calls[0]!.body).toMatchObject({
      farm: { enterpriseTypes: ['beef_cattle', 'row_crops'] },
    });
  });

  it('will not submit without an enterprise type, and says why', async () => {
    stubApi();
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText(/business name/i), 'Rietfontein Boerdery');
    await user.type(screen.getByLabelText(/farm name/i), 'Rietfontein');
    await user.type(screen.getByLabelText(/your full name/i), 'Thabo Mokoena');
    await user.type(screen.getByLabelText(/email address/i), 'thabo@rietfontein.test');
    await user.type(screen.getByLabelText(/password/i), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: /create my farm/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/adapts to what you farm/i);
  });

  it('tells a returning farmer to sign in instead of registering twice', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 409,
          json: () => Promise.resolve({ code: 'CONFLICT', message: 'already registered' }),
        } as Response),
      ),
    );
    const user = userEvent.setup();
    render(<App />);

    await fillRegistration(user);
    await user.click(screen.getByRole('button', { name: /create my farm/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/already has an account/i);
  });
});
