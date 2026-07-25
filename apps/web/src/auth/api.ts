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
  method: 'POST' | 'PATCH',
  path: string,
  body: unknown,
  accessToken?: string,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(body),
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
  register: (input: schemas.RegisterRequest): Promise<schemas.AuthSession> =>
    post('/auth/register', input),

  login: (input: schemas.LoginRequest): Promise<schemas.LoginResponse> =>
    post('/auth/login', input),

  /** Completes a login that stopped at the second factor, with a typed code (FR-014). */
  verifySecondFactor: (input: schemas.VerifySecondFactorRequest): Promise<schemas.AuthSession> =>
    post('/auth/2fa/verify', input),

  refresh: (refreshToken: string): Promise<schemas.AuthSession> =>
    post('/auth/refresh', { refreshToken }),

  logout: (refreshToken: string): Promise<void> => post('/auth/logout', { refreshToken }),

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
