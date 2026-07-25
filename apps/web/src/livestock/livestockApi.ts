/**
 * The livestock capture endpoints — the paths a QUEUED local capture is sent to, once there is a
 * signal. This is emphatically NOT the capture path: a farmer's Save writes to the local store with
 * no network in it (LocalHerd / LocalWeights / LocalLifecycle). These run LATER, in the background,
 * from the outbox flush. `sync/captureApi.ts` holds the transport and the error taxonomy every
 * capture client shares, and explains the at-least-once contract in full.
 */

import type { schemas } from '@werf/core';
import { postCapture as post } from '../sync/captureApi';
import type { StoredWeight } from './LocalWeights';
import type { StoredDeath, StoredSale } from './LocalLifecycle';

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

  /** Sent after its animal: an identifier references `animals(id)` (FR-109). */
  createIdentifier: (identifier: schemas.NewAnimalIdentifier, token: string): Promise<void> =>
    post('/livestock/identifiers', identifier, token),

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
