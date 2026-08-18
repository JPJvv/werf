/**
 * The harvest capture endpoint — where a QUEUED local harvest is sent once there is a signal. Not
 * the capture path (see `sync/captureApi.ts` for the transport, the error taxonomy, and why every
 * endpoint here must be idempotent on the client id). `phiOverride`, when present, carries only the
 * `reason` the farmer typed — never `by`, which the server resolves from the session
 * (`recordHarvestRequestSchema`'s own module note).
 */

import { postCapture, readFromApi } from '../sync/captureApi';
import type { StoredHarvest } from './LocalHarvest';

/** One row of the server's PHI compliance register (4d·6) — the wire contract verbatim. No
 *  `@werf/core` schema backs this (the server route returns a plain TS shape, the same convention
 *  `HarvestHistoryRow`/`SprayHistoryRow` already use), so it is restated here rather than shared. */
export interface PhiFlagRow {
  readonly eventId: string;
  readonly landUnitId: string;
  readonly harvestedOn: string;
  readonly productId: string;
  readonly sprayedOn: string;
  readonly earliestHarvestDate: string;
}

export const harvestApi = {
  recordHarvest: (harvest: StoredHarvest, token: string): Promise<void> =>
    postCapture(
      '/crops/harvests',
      {
        id: harvest.id,
        farmId: harvest.farmId,
        landUnitId: harvest.landUnitId,
        occurredAt: harvest.occurredAt,
        harvestedOn: harvest.harvestedOn,
        quantity: harvest.quantity,
        unit: harvest.unit,
        ...(harvest.grade === undefined ? {} : { grade: harvest.grade }),
        ...(harvest.destination === undefined ? {} : { destination: harvest.destination }),
        ...(harvest.phiOverride === undefined
          ? {}
          : { phiOverride: { reason: harvest.phiOverride.reason } }),
      },
      token,
    ),

  listPhiRegister: (farmId: string, token: string): Promise<PhiFlagRow[]> =>
    readFromApi<PhiFlagRow[]>(
      `/crops/phi-register?farmId=${encodeURIComponent(farmId)}`,
      token,
      'Could not read the PHI compliance register',
    ),
};
