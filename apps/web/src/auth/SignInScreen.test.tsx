/**
 * Signing in, including the second-factor step.
 *
 * The API is stubbed at `fetch` — the network boundary — rather than by mocking our own
 * modules, so the client's request shape and its handling of real response bodies are both
 * under test. CLAUDE.md forbids mocking our own code; the browser's fetch is not ours.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../i18n/LocaleProvider';
import { AuthProvider } from './AuthProvider';
import { SignInScreen } from './SignInScreen';

const SESSION: Record<string, unknown> = {
  accessToken: 'access-token',
  expiresIn: 900,
  refreshToken: 'refresh-token',
  refreshExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  user: {
    id: '0190f3a0-0000-7000-8000-000000000001',
    email: 'thabo@rietfontein.test',
    phone: null,
    fullName: 'Thabo Mokoena',
    locale: 'en-ZA',
    theme: 'light',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
  },
  farms: [
    {
      id: '0190f3a0-0000-7000-8000-0000000000f1',
      name: 'Rietfontein',
      enterpriseTypes: ['beef_cattle'],
      role: 'owner',
    },
  ],
  activeFarmId: '0190f3a0-0000-7000-8000-0000000000f1',
  secondFactor: 'complete',
};

/** Queues responses in order, so a two-step flow can be scripted honestly. */
function stubFetch(...responses: { status: number; body: unknown }[]) {
  const calls: { url: string; body: unknown }[] = [];
  let index = 0;

  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      const next = responses[Math.min(index++, responses.length - 1)]!;
      return Promise.resolve({
        ok: next.status < 400,
        status: next.status,
        json: () => Promise.resolve(next.body),
      } as Response);
    }),
  );

  return calls;
}

function renderSignIn() {
  return render(
    <LocaleProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={['/sign-in']}>
          <Routes>
            <Route path="/sign-in" element={<SignInScreen />} />
            <Route path="/" element={<h1>Rietfontein</h1>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </LocaleProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('signing in with a password', () => {
  it('lands the farmer on their farm and remembers them for next time', async () => {
    stubFetch({ status: 200, body: SESSION });
    const user = userEvent.setup();
    renderSignIn();

    await user.type(screen.getByLabelText(/email address/i), 'thabo@rietfontein.test');
    await user.type(screen.getByLabelText(/password/i), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('heading', { name: 'Rietfontein' })).toBeTruthy();
    // Cached, so the next cold start needs no network at all (FR-006).
    expect(window.localStorage.getItem('werf-session')).toContain('Rietfontein');
  });

  it('says what to do about a wrong password, and does not cache anything', async () => {
    stubFetch({
      status: 401,
      body: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' },
    });
    const user = userEvent.setup();
    renderSignIn();

    await user.type(screen.getByLabelText(/email address/i), 'thabo@rietfontein.test');
    await user.type(screen.getByLabelText(/password/i), 'wrong password here');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/do not match/i);
    expect(window.localStorage.getItem('werf-session')).toBeNull();
  });

  it('states the situation when the server cannot be reached, without blaming anyone', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    const user = userEvent.setup();
    renderSignIn();

    await user.type(screen.getByLabelText(/email address/i), 'thabo@rietfontein.test');
    await user.type(screen.getByLabelText(/password/i), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    const alert = await screen.findByRole('alert');
    // Reassures them their saved work is fine — the anxiety that makes farmers keep a
    // paper backup and then abandon the app.
    expect(alert.textContent).toMatch(/saved work is safe/i);
    expect(alert.textContent).not.toMatch(/sorry/i);
  });
});

describe('when the account has a second factor', () => {
  const challenge = {
    status: 200,
    body: {
      secondFactorRequired: true,
      challengeToken: 'challenge-token',
      methods: ['totp', 'recovery_code'],
    },
  };

  it('asks for the code and does not treat the challenge as a session', async () => {
    stubFetch(challenge);
    const user = userEvent.setup();
    renderSignIn();

    await user.type(screen.getByLabelText(/email address/i), 'thabo@rietfontein.test');
    await user.type(screen.getByLabelText(/password/i), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('heading', { name: /one more step/i })).toBeTruthy();
    // The challenge is NOT a session and must never be cached as one.
    expect(window.localStorage.getItem('werf-session')).toBeNull();
  });

  it('completes the login when the code is right', async () => {
    const calls = stubFetch(challenge, { status: 200, body: SESSION });
    const user = userEvent.setup();
    renderSignIn();

    await user.type(screen.getByLabelText(/email address/i), 'thabo@rietfontein.test');
    await user.type(screen.getByLabelText(/password/i), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await screen.findByRole('heading', { name: /one more step/i });
    await user.type(screen.getByLabelText(/^code$/i), '123456');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByRole('heading', { name: 'Rietfontein' })).toBeTruthy();
    expect(calls[1]).toMatchObject({
      url: expect.stringContaining('/auth/2fa/verify'),
      body: { challengeToken: 'challenge-token', method: 'totp', code: '123456' },
    });
  });

  it('sends the farmer back to the password when the code is wrong', async () => {
    // The server spends the challenge on any attempt, right or wrong. Leaving them on the
    // code field would let them retype against a token that is already dead.
    stubFetch(challenge, {
      status: 401,
      body: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' },
    });
    const user = userEvent.setup();
    renderSignIn();

    await user.type(screen.getByLabelText(/email address/i), 'thabo@rietfontein.test');
    await user.type(screen.getByLabelText(/password/i), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await screen.findByRole('heading', { name: /one more step/i });
    await user.type(screen.getByLabelText(/^code$/i), '000000');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /sign in/i })).toBeTruthy();
    });
    expect(screen.getByRole('alert').textContent).toMatch(/every 30 seconds/i);
  });

  it('offers a recovery code for the phone at the bottom of a dam', async () => {
    stubFetch(challenge);
    const user = userEvent.setup();
    renderSignIn();

    await user.type(screen.getByLabelText(/email address/i), 'thabo@rietfontein.test');
    await user.type(screen.getByLabelText(/password/i), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await screen.findByRole('heading', { name: /one more step/i });
    await user.click(screen.getByRole('button', { name: /use a recovery code/i }));

    expect(screen.getByLabelText(/recovery code/i)).toBeTruthy();
    expect(screen.getByText(/put in the safe/i)).toBeTruthy();
  });
});
