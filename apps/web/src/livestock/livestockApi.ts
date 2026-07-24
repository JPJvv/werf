/**
 * The livestock capture API client — how a QUEUED local capture reaches the server, once there
 * is a signal. This is emphatically NOT the capture path: a farmer's Save writes to the local
 * store with no network in it (LocalHerd / LocalWeights / LocalLifecycle). This client runs
 * LATER, in the background, from the outbox flush — a best-effort catch-up that sends what the
 * device already holds. Nothing a farmer does ever awaits it.
 *
 * It is a stand-in for the Phase 3 PowerSync uploader: the same "send local rows the server has
 * not seen" job, done by hand against the `apps/api` capture endpoints until the real replication
 * engine takes over. Because the flush is at-least-once (a lost 201 is retried on the next
 * reconnect) every endpoint here is idempotent on the client-generated id, so a re-send is a
 * server-side no-op, never a duplicate.
 *
 * Errors reuse the auth client's taxonomy so the flush can tell the three cases apart: a
 * transport failure (NetworkUnavailableError → still offline, leave it pending), a 401 (access
 * token expired after a long spell offline → refresh and retry), and any other refusal
 * (AuthApiError with a status → surface as "not sent").
 */

import type { schemas } from '@werf/core';
import { AuthApiError, NetworkUnavailableError } from '../auth/api';
import type { StoredWeight } from './LocalWeights';
import type { StoredDeath, StoredSale } from './LocalLifecycle';

/** Where the API lives. Same origin in production; Vite proxies it in dev. Mirrors auth/api.ts. */
const API_BASE = (import.meta.env['VITE_API_URL'] as string | undefined) ?? '/api';

async function post(path: string, body: unknown, accessToken: string): Promise<void> {
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
 * The capture endpoints, one per thing the client can compose offline. Each takes the stored
 * local record and the current access token, and resolves when the server has stored it (or
 * throws so the flush can decide what to do). The animal endpoint is sent FIRST by the flush:
 * a weight, death or sale event references `animals(id)`, and an event that arrived before its
 * animal would fail the foreign key.
 */
export const livestockApi = {
  createAnimal: (animal: schemas.NewAnimal, token: string): Promise<void> =>
    post('/livestock/animals', animal, token),

  recordWeight: (weight: StoredWeight, token: string): Promise<void> =>
    post(
      '/livestock/weights',
      {
        id: weight.id,
        farmId: weight.farmId,
        animalId: weight.animalId,
        occurredAt: weight.occurredAt,
        kg: weight.kg,
        method: weight.method,
      },
      token,
    ),

  recordDeath: (death: StoredDeath, token: string): Promise<void> =>
    post(
      '/livestock/deaths',
      {
        id: death.id,
        farmId: death.farmId,
        animalId: death.animalId,
        occurredAt: death.occurredAt,
        cause: death.cause,
      },
      token,
    ),

  recordSale: (sale: StoredSale, token: string): Promise<void> =>
    post(
      '/livestock/sales',
      {
        id: sale.id,
        farmId: sale.farmId,
        animalId: sale.animalId,
        occurredAt: sale.occurredAt,
        counterparty: sale.counterparty,
        priceCents: sale.priceCents,
        ...(sale.weightKg === undefined ? {} : { weightKg: sale.weightKg }),
      },
      token,
    ),
};
