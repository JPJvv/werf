/** Sends queued farmer-owned harvest records. Interval reminders never alter the request. */

import { postCapture, readFromApi } from '../sync/captureApi';
import type { StoredHarvest } from './LocalHarvest';

/** One row of the farm's private interval-reminder list — the wire contract verbatim. No
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
      },
      token,
    ),

  listPhiRegister: (farmId: string, token: string): Promise<PhiFlagRow[]> =>
    readFromApi<PhiFlagRow[]>(
      `/crops/phi-register?farmId=${encodeURIComponent(farmId)}`,
      token,
      'Could not read the interval reminders',
    ),
};
