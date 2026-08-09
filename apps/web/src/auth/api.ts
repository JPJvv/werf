/**
 * The auth API client.
 *
 * This is the ONE place in the client that talks to the NestJS API over the network, and
 * it is deliberately the only path allowed to: everything server-authoritative (payroll,
 * compliance, PDF export) goes through the API, everything else goes through the local
 * database via the sync adapter. Auth is server-authoritative by definition — the client
 * cannot decide whether a password is right.
 *
 * Note what is NOT here: no retry-forever loop, no queueing. This path is genuinely
 * online-only, and it is the one legitimate place for a "no connection" error in the whole
 * product (`OfflineUnavailableError`). Capture paths must never look like this.
 */

import { schemas } from '@werf/core';

/** Where the API lives. Same origin in production; Vite proxies it in dev. */
const API_BASE = import.meta.env['VITE_API_URL'] ?? '/api';

/**
 * A failure the UI can say something useful about. `code` is the server's stable error
 * code, so screens branch on it rather than on a message string that translation breaks.
 */
export class AuthApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AuthApiError';
  }
}

/** No network at all — distinct from the server refusing us, and worded differently to a farmer. */
export class NetworkUnavailableError extends Error {
  constructor() {
    super('Could not reach the server');
    this.name = 'NetworkUnavailableError';
  }
}

async function post<T>(path: string, body: unknown, accessToken?: string): Promise<T> {
  return send('POST', path, body, accessToken);
}

async function send<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body: unknown,
  accessToken?: string,
): Promise<T> {
  // A GET carries no body — `fetch` throws outright if given one — and a DELETE that names its
  // subject in the path has nothing to put in one either.
  const hasBody = method !== 'GET' && method !== 'DELETE';
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      // The persistent credential is a same-origin HttpOnly cookie. Keep this explicit so a
      // future API URL change cannot silently alter whether the browser sends it.
      credentials: 'same-origin',
      headers: {
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      ...(hasBody ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    // `fetch` rejects only on a transport failure. Signing in genuinely requires a
    // network, so this is honest rather than a bug — but the copy must say "we could not
    // reach the server", never blame the farmer's connection.
    throw new NetworkUnavailableError();
  }

  if (response.status === 204) return undefined as T;

  const payload: unknown = await response.json().catch(() => ({}));

  if (!response.ok) {
    const { code, message } = payload as { code?: string; message?: string };
    throw new AuthApiError(code ?? 'UNKNOWN', message ?? 'Something went wrong', response.status);
  }

  return payload as T;
}

export const authApi = {
  /** FR-001/FR-002: business, first farm, its enterprise types, and the owner, in one call. */
  register: (input: schemas.RegisterRequest): Promise<schemas.BrowserAuthSession> =>
    post('/auth/register', input),

  login: (
    input: schemas.LoginRequest,
  ): Promise<schemas.BrowserAuthSession | schemas.SecondFactorRequired> =>
    post('/auth/login', input),

  /** Completes a login that stopped at the second factor, with a typed code (FR-014). */
  verifySecondFactor: (
    input: schemas.VerifySecondFactorRequest,
  ): Promise<schemas.BrowserAuthSession> => post('/auth/2fa/verify', input),

  refresh: (): Promise<schemas.BrowserAuthSession> => post('/auth/refresh', {}),

  logout: (): Promise<void> => post('/auth/logout', {}),

  /** Starts TOTP enrolment. The response carries the seed — the only one that ever does. */
  beginTotpEnrolment: (accessToken: string): Promise<schemas.TotpEnrolmentStartResponse> =>
    post('/auth/2fa/totp', {}, accessToken),

  /** Confirms enrolment with a code from the app, and returns the recovery codes ONCE. */
  confirmTotpEnrolment: (
    accessToken: string,
    code: string,
  ): Promise<schemas.TotpEnrolmentConfirmResponse> =>
    post('/auth/2fa/totp/confirm', { code }, accessToken),

  /**
   * Passkey enrolment (FR-014/014c) — ADR-0007's PREFERRED factor, and the reason it is preferred
   * is worth restating here: a passkey works with no signal, cannot be SIM-swapped, and there is
   * nothing to type in a crush. The server generates the creation options; the browser does the
   * ceremony; the attestation comes back to be verified against OUR challenge, never the client's.
   */
  beginPasskeyEnrolment: (accessToken: string): Promise<schemas.PasskeyCeremonyOptions> =>
    post('/auth/2fa/passkey', {}, accessToken),

  /** Completes enrolment. Returns the recovery codes ONCE, and only for a FIRST factor. */
  confirmPasskeyEnrolment: (
    accessToken: string,
    input: schemas.PasskeyRegistrationRequest,
  ): Promise<schemas.TotpEnrolmentConfirmResponse> =>
    post('/auth/2fa/passkey/confirm', input, accessToken),

  /** The keys that can open this account, so a lost phone can be revoked (FR-014c). */
  listPasskeys: (accessToken: string): Promise<schemas.PasskeySummary[]> =>
    send('GET', '/auth/2fa/passkey', undefined, accessToken),

  /** Revoke one key. The server refuses to remove the LAST factor — that is its rule, not ours. */
  revokePasskey: (accessToken: string, passkeyId: string): Promise<void> =>
    send('DELETE', `/auth/2fa/passkey/${passkeyId}`, undefined, accessToken),

  /**
   * Begins a passkey login for a half-authenticated session. The challenge token is what the
   * password step returned; nothing here takes an email, deliberately — a request keyed on an
   * address would answer "which passkeys does this address have?", which is an enumeration oracle.
   */
  passkeyChallenge: (challengeToken: string): Promise<schemas.PasskeyCeremonyOptions> =>
    post('/auth/2fa/passkey/challenge', { challengeToken }),

  /** Completes a passkey login, returning the real session. */
  passkeyVerify: (
    input: schemas.PasskeyAuthenticationRequest,
  ): Promise<schemas.BrowserAuthSession> => post('/auth/2fa/passkey/verify', input),

  /**
   * Writes a preference back to the ACCOUNT (FR-008), returning the account as it now stands.
   * Language belongs to the person, so it has to reach the user row — a device-only change is
   * undone by the next cold start, which re-adopts the stored locale.
   */
  updateProfile: (
    accessToken: string,
    input: schemas.UpdateProfileRequest,
  ): Promise<schemas.AuthSession['user']> => send('PATCH', '/auth/profile', input, accessToken),

  /**
   * FR-004: point the SERVER-side session at a different farm. The device has already switched —
   * this is the catch-up, so the next refresh (or another device) agrees. Best-effort by design:
   * a farmer standing in a camp with no signal must still be able to change which farm they are
   * looking at.
   */
  switchActiveFarm: (accessToken: string, farmId: string): Promise<void> =>
    send('POST', '/farms/active', { farmId }, accessToken),

  /** FR-004: another farm under a business the caller owns. */
  createFarm: (
    accessToken: string,
    input: schemas.CreateFarmRequest,
  ): Promise<schemas.SessionFarm> => send('POST', '/farms', input, accessToken),
};
