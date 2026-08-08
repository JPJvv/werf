/**
 * How a QUEUED local capture reaches the server, once there is a signal — shared by every capture
 * client (livestock, rainfall, and whatever the crop and labour phases add).
 *
 * This is emphatically NOT the capture path: a farmer's Save writes to a local store with no
 * network in it. This runs LATER, in the background, from the outbox flush — a best-effort catch-up
 * that sends what the device already holds. Nothing a farmer does ever awaits it. It is the
 * stand-in for the Phase 3 PowerSync uploader, so every endpoint it posts to is idempotent on the
 * client-generated id: the flush is at-least-once, and a re-send must be a server-side no-op.
 *
 * Errors reuse the auth client's taxonomy so the flush can tell the three cases apart: a transport
 * failure (NetworkUnavailableError → still offline, leave it pending), a 401 (access token expired
 * after a long spell offline → refresh and retry), and any other refusal (AuthApiError with a
 * status → surface as "not sent").
 */

import { AuthApiError, NetworkUnavailableError } from '../auth/api';

/** Where the API lives. Same origin in production; Vite proxies it in dev. Mirrors auth/api.ts. */
const API_BASE = (import.meta.env['VITE_API_URL'] as string | undefined) ?? '/api';

export async function postCapture(path: string, body: unknown, accessToken: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    // A transport failure — no signal after all. Not an error to show; the record stays pending
    // and the next reconnect tries again. This is the offline-first path, working as intended.
    throw new NetworkUnavailableError();
  }

  if (response.ok) return;

  const payload: unknown = await response.json().catch(() => ({}));
  const { code, message } = payload as { code?: string; message?: string };
  throw new AuthApiError(code ?? 'UNKNOWN', message ?? 'Capture was not accepted', response.status);
}

/**
 * The INBOUND direction, with the same error taxonomy — the reference registers the crush needs
 * offline, and the residue register the server derives.
 *
 * It is called opportunistically by a cache provider, never from a capture path: a farmer's Save
 * must not wait on it, and a failure here is an older list rather than an error. It lives beside
 * `postCapture` because it is the same transport and the same three error cases, and a second
 * hand-written copy of them in another file would drift the way every duplicate in this repo has.
 */
export async function readFromApi<T>(
  path: string,
  accessToken: string,
  whatFailed: string,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new NetworkUnavailableError();
  }
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => ({}));
    const { code, message } = payload as { code?: string; message?: string };
    throw new AuthApiError(code ?? 'UNKNOWN', message ?? whatFailed, response.status);
  }
  return (await response.json()) as T;
}
