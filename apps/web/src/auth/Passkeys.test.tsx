/**
 * Passkeys end to end from the client (FR-014/014c, ADR-0007): enrolling one instead of TOTP,
 * signing in with it, and managing which devices can open the account.
 *
 * The API is stubbed at `fetch` — the network boundary — as everywhere else in this suite. The one
 * thing that IS module-mocked is `@simplewebauthn/browser`, which is not our code and wraps a
 * browser API jsdom does not implement at all: there is no authenticator to talk to, so the choice
 * is a mock or no coverage of this path.
 *
 * What the tests are really about is the failure taxonomy. A `DOMException` from an authenticator
 * says the same alarming, useless thing whether someone tapped cancel, ran out of time, or is on a
 * device that never could have done it — and those need three different screens.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../i18n/LocaleProvider';
import { AuthProvider } from './AuthProvider';
import { SignInScreen } from './SignInScreen';
import { SecondFactorEnrolmentScreen } from './SecondFactorEnrolmentScreen';
import { SecuritySettings } from '../settings/SecuritySettings';

const { startRegistration, startAuthentication } = vi.hoisted(() => ({
  startRegistration: vi.fn(),
  startAuthentication: vi.fn(),
}));

vi.mock('@simplewebauthn/browser', () => ({ startRegistration, startAuthentication }));

const USER = {
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

const FARMS = [
  {
    id: '0190f3a0-0000-7000-8000-0000000000f1',
    name: 'Rietfontein',
    enterpriseTypes: ['beef_cattle'],
    role: 'owner',
  },
];

function session(secondFactor: string): Record<string, unknown> {
  return {
    accessToken: 'access-token',
    expiresIn: 900,
    user: USER,
    farms: FARMS,
    activeFarmId: FARMS[0]!.id,
    secondFactor,
  };
}

const CREDENTIAL = {
  id: 'credential-id',
  rawId: 'credential-id',
  type: 'public-key',
  clientExtensionResults: {},
  response: { clientDataJSON: 'client-data', attestationObject: 'attestation' },
};

const ASSERTION = {
  id: 'credential-id',
  rawId: 'credential-id',
  type: 'public-key',
  clientExtensionResults: {},
  response: {
    clientDataJSON: 'client-data',
    authenticatorData: 'auth-data',
    signature: 'signature',
  },
};

/** One scripted response per request, matched on the path rather than on call order. */
type Route = { match: RegExp; method?: string; status: number; body: unknown };

function stubFetch(routes: Route[]) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      // A GET and a DELETE carry no body here, deliberately — parsing one would be asserting a
      // request shape the client must not send.
      const body = init.body === undefined ? undefined : JSON.parse(String(init.body));
      calls.push({ url, method, body });
      const route =
        routes.find((r) => r.match.test(url) && (r.method ?? method) === method) ??
        routes.find((r) => r.match.test(url));
      if (/\/auth\/refresh$/.test(url) && method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(session('complete')),
        } as Response);
      }
      if (!route) throw new Error(`No stubbed response for ${method} ${url}`);
      return Promise.resolve({
        ok: route.status < 400,
        status: route.status,
        json: () => Promise.resolve(route.body),
      } as Response);
    }),
  );
  return calls;
}

/** jsdom has no WebAuthn at all, so availability is stated rather than detected. */
function deviceCanDoPasskeys(can: boolean): void {
  if (can) {
    vi.stubGlobal('PublicKeyCredential', function PublicKeyCredential() {});
    Object.defineProperty(navigator, 'credentials', { value: {}, configurable: true });
  } else {
    vi.stubGlobal('PublicKeyCredential', undefined);
  }
}

function cacheSession(secondFactor: string): void {
  const { accessToken: _accessToken, expiresIn: _expiresIn, ...offline } = session(secondFactor);
  window.localStorage.setItem(
    'werf-session',
    JSON.stringify({ payload: offline, confirmedAt: new Date().toISOString() }),
  );
}

function renderAt(path: string, element: React.ReactElement) {
  return render(
    <LocaleProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={path} element={element} />
            <Route path="/" element={<h1>Rietfontein</h1>} />
            {path !== '/sign-in' && <Route path="/sign-in" element={<h1>Sign in again</h1>} />}
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </LocaleProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  startRegistration.mockReset();
  startAuthentication.mockReset();
  deviceCanDoPasskeys(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('enrolling a second factor (FR-014)', () => {
  it('offers the passkey first, because that is the factor that works with no signal', () => {
    cacheSession('required');
    renderAt('/security/second-factor', <SecondFactorEnrolmentScreen />);

    expect(screen.getByRole('button', { name: /use this phone as the key/i })).toBeTruthy();
    // TOTP is still one tap away — it is the universal fallback, not a hidden option.
    expect(screen.getByRole('button', { name: /use an authenticator app instead/i })).toBeTruthy();
  });

  it('⭐ goes straight to the authenticator app on a device that cannot do a passkey', async () => {
    // A mandatory-2FA screen that offered only a factor this browser cannot produce would be a
    // dead end for someone with no other route into their own account.
    deviceCanDoPasskeys(false);
    cacheSession('required');
    stubFetch([
      {
        match: /2fa\/totp$/,
        status: 200,
        body: { secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://x' },
      },
    ]);
    renderAt('/security/second-factor', <SecondFactorEnrolmentScreen />);

    expect(await screen.findByLabelText(/code/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /use this phone as the key/i })).toBeNull();
  });

  it('enrols the passkey and shows the recovery codes exactly once (FR-014a)', async () => {
    cacheSession('required');
    startRegistration.mockResolvedValue(CREDENTIAL);
    const calls = stubFetch([
      { match: /2fa\/passkey\/confirm$/, status: 200, body: { recoveryCodes: ['AAAA-1111'] } },
      { match: /2fa\/passkey$/, status: 200, body: { options: { challenge: 'abc' } } },
    ]);
    const user = userEvent.setup();
    renderAt('/security/second-factor', <SecondFactorEnrolmentScreen />);

    await user.click(screen.getByRole('button', { name: /use this phone as the key/i }));

    expect(await screen.findByText('AAAA-1111')).toBeTruthy();
    const confirm = calls.find((c) => c.url.endsWith('/passkey/confirm'));
    expect(confirm?.body).toMatchObject({ credential: { id: 'credential-id' } });
    // ⭐ A passkey-only owner whose phone drowns has no other way back in, which is exactly why
    // the codes are minted on THIS path and not only alongside TOTP.
    expect(screen.getByText(/safe/i)).toBeTruthy();
  });

  it('sends a stale session through a full sign-in before starting enrolment', async () => {
    cacheSession('required');
    stubFetch([
      {
        match: /2fa\/passkey$/,
        status: 403,
        body: {
          code: 'STEP_UP_REQUIRED',
          message: 'Sign in again before changing sign-in methods',
        },
      },
      { match: /auth\/logout$/, status: 204, body: {} },
    ]);
    const user = userEvent.setup();
    renderAt('/security/second-factor', <SecondFactorEnrolmentScreen />);

    await user.click(screen.getByRole('button', { name: /use this phone as the key/i }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/sign in again/i);
    await user.click(screen.getByRole('button', { name: /^sign in again$/i }));
    expect(await screen.findByRole('heading', { name: /sign in again/i })).toBeTruthy();
  });

  it('treats a cancelled prompt as unfinished, not as an error', async () => {
    // The spec returns NotAllowedError both for "dismissed" and "timed out" and withholds which,
    // so a red panel here would be scolding someone who tapped the wrong thing.
    cacheSession('required');
    startRegistration.mockRejectedValue(
      Object.assign(new Error('nope'), { name: 'NotAllowedError' }),
    );
    stubFetch([{ match: /2fa\/passkey$/, status: 200, body: { options: {} } }]);
    const user = userEvent.setup();
    renderAt('/security/second-factor', <SecondFactorEnrolmentScreen />);

    await user.click(screen.getByRole('button', { name: /use this phone as the key/i }));

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getByRole('button', { name: /use this phone as the key/i })).toBeTruthy();
  });

  it('says a device is already set up rather than calling it a failure', async () => {
    cacheSession('required');
    startRegistration.mockRejectedValue(
      Object.assign(new Error('excluded'), { name: 'InvalidStateError' }),
    );
    stubFetch([{ match: /2fa\/passkey$/, status: 200, body: { options: {} } }]);
    const user = userEvent.setup();
    renderAt('/security/second-factor', <SecondFactorEnrolmentScreen />);

    await user.click(screen.getByRole('button', { name: /use this phone as the key/i }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/already set up as a key/i);
  });
});

describe('signing in with a passkey (FR-014)', () => {
  it('signs the challenge and lands the farmer on their farm, with nothing typed', async () => {
    const calls = stubFetch([
      {
        match: /auth\/login$/,
        status: 200,
        body: {
          secondFactorRequired: true,
          challengeToken: 'challenge-1',
          methods: ['passkey', 'totp'],
        },
      },
      { match: /passkey\/challenge$/, status: 200, body: { options: { challenge: 'xyz' } } },
      { match: /passkey\/verify$/, status: 200, body: session('complete') },
    ]);
    startAuthentication.mockResolvedValue(ASSERTION);
    const user = userEvent.setup();
    renderAt('/sign-in', <SignInScreen />);

    await user.type(screen.getByLabelText(/email address/i), 'thabo@rietfontein.test');
    await user.type(screen.getByLabelText(/password/i), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    await user.click(await screen.findByRole('button', { name: /use this phone/i }));

    expect(await screen.findByRole('heading', { name: 'Rietfontein' })).toBeTruthy();
    const verify = calls.find((c) => c.url.endsWith('/passkey/verify'));
    expect(verify?.body).toMatchObject({
      challengeToken: 'challenge-1',
      credential: { id: 'credential-id' },
    });
  });

  it('does not offer a passkey when the ACCOUNT has none, even on a device that could', async () => {
    stubFetch([
      {
        match: /auth\/login$/,
        status: 200,
        body: { secondFactorRequired: true, challengeToken: 'challenge-1', methods: ['totp'] },
      },
    ]);
    const user = userEvent.setup();
    renderAt('/sign-in', <SignInScreen />);

    await user.type(screen.getByLabelText(/email address/i), 'thabo@rietfontein.test');
    await user.type(screen.getByLabelText(/password/i), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(await screen.findByLabelText(/code/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /use this phone/i })).toBeNull();
  });

  it('⭐ keeps the challenge alive when the prompt is cancelled', async () => {
    // The challenge is spent by an ATTEMPT. Dismissing a prompt is not one, and sending someone
    // back to the password screen for it would be losing them a token they never spent.
    stubFetch([
      {
        match: /auth\/login$/,
        status: 200,
        body: {
          secondFactorRequired: true,
          challengeToken: 'challenge-1',
          methods: ['passkey', 'totp'],
        },
      },
      { match: /passkey\/challenge$/, status: 200, body: { options: {} } },
    ]);
    startAuthentication.mockRejectedValue(
      Object.assign(new Error('nope'), { name: 'NotAllowedError' }),
    );
    const user = userEvent.setup();
    renderAt('/sign-in', <SignInScreen />);

    await user.type(screen.getByLabelText(/email address/i), 'thabo@rietfontein.test');
    await user.type(screen.getByLabelText(/password/i), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));
    await user.click(await screen.findByRole('button', { name: /use this phone/i }));

    // Still on the second-factor step, still able to try again or type a code.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /use this phone/i })).toBeTruthy(),
    );
    expect(screen.getByLabelText(/code/i)).toBeTruthy();
  });
});

describe('managing the keys that can open this account (FR-014c)', () => {
  const KEY = {
    id: '0190f3a0-0000-7000-8000-00000000d001',
    deviceLabel: 'iPhone',
    createdAt: new Date('2026-07-01T08:00:00Z').toISOString(),
    lastUsedAt: new Date('2026-07-20T05:30:00Z').toISOString(),
  };

  it('announces a reduced-motion-safe skeleton while the device list is loading', async () => {
    cacheSession('complete');
    let finish!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (/\/auth\/refresh$/.test(url)) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(session('complete')),
          } as Response);
        }
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      }),
    );

    renderAt('/settings/security', <SecuritySettings />);

    const loading = screen.getByRole('status');
    expect(loading.getAttribute('aria-busy')).toBe('true');
    expect(loading.textContent).toMatch(/reading your keys/i);

    await waitFor(() => expect(typeof finish).toBe('function'));
    finish({
      ok: true,
      status: 200,
      json: () => Promise.resolve([KEY]),
    } as Response);
    expect(await screen.findByText('iPhone')).toBeTruthy();
  });

  it('lists the devices by their label and when each was last used', async () => {
    cacheSession('complete');
    stubFetch([{ match: /2fa\/passkey$/, status: 200, body: [KEY] }]);
    renderAt('/settings/security', <SecuritySettings />);

    expect(await screen.findByText('iPhone')).toBeTruthy();
    expect(screen.getByRole('button', { name: /remove/i })).toBeTruthy();
  });

  it('says a key has never been used rather than showing an empty date', async () => {
    cacheSession('complete');
    stubFetch([{ match: /2fa\/passkey$/, status: 200, body: [{ ...KEY, lastUsedAt: null }] }]);
    renderAt('/settings/security', <SecuritySettings />);

    expect(await screen.findByText(/not yet/i)).toBeTruthy();
  });

  it('adds another device, which is what makes the preferred factor safe to prefer', async () => {
    // An owner with one passkey on one phone has an account that dies with the phone.
    cacheSession('complete');
    startRegistration.mockResolvedValue(CREDENTIAL);
    stubFetch([
      { match: /2fa\/passkey\/confirm$/, status: 200, body: { recoveryCodes: null } },
      { match: /2fa\/passkey$/, method: 'GET', status: 200, body: [KEY] },
      { match: /2fa\/passkey$/, method: 'POST', status: 200, body: { options: {} } },
    ]);
    const user = userEvent.setup();
    renderAt('/settings/security', <SecuritySettings />);

    await user.click(await screen.findByRole('button', { name: /add this phone as a key/i }));

    expect((await screen.findByRole('status')).textContent).toMatch(/can now open the account/i);
  });

  it('⭐ names the last-factor refusal as the action it needs, not as a failure', async () => {
    // The server refuses to remove the only way in. "Add another first" is the answer, and the
    // generic failure line does not say it.
    cacheSession('complete');
    stubFetch([
      { match: /2fa\/passkey\/[0-9a-f-]+$/, status: 409, body: { code: 'CONFLICT' } },
      { match: /2fa\/passkey$/, status: 200, body: [KEY] },
    ]);
    const user = userEvent.setup();
    renderAt('/settings/security', <SecuritySettings />);

    await user.click(await screen.findByRole('button', { name: /remove/i }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/add another key/i);
  });

  it('says plainly that removing a key needs a signal, instead of failing quietly', async () => {
    cacheSession('complete');
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: RequestInit = {}) => {
        if (/\/auth\/refresh$/.test(url)) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(session('complete')),
          } as Response);
        }
        if ((init.method ?? 'GET') === 'GET') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve([KEY]),
          } as Response);
        }
        return Promise.reject(new TypeError('offline'));
      }),
    );
    const user = userEvent.setup();
    renderAt('/settings/security', <SecuritySettings />);

    await user.click(await screen.findByRole('button', { name: /remove/i }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/has to be done with a signal/i);
  });
});
