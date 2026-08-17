/**
 * The planting capture endpoint — where a QUEUED local planting is sent once there is a signal. Not
 * the capture path (see `sync/captureApi.ts` for the transport, the error taxonomy, and why every
 * endpoint here must be idempotent on the client id).
 */

import { postCapture } from '../sync/captureApi';
import type { StoredPlanting } from './LocalPlantings';

export const cropsApi = {
  recordPlanting: (planting: StoredPlanting, token: string): Promise<void> =>
    postCapture(
      '/crops/plantings',
      {
        id: planting.id,
        farmId: planting.farmId,
        landUnitId: planting.landUnitId,
        // The instant as the STORE holds it: a string, because JSON has no Date and this record
        // came back out of storage. `timestampSchema` parses it on the far side.
        occurredAt: planting.occurredAt,
        crop: planting.crop,
        ...(planting.cultivar === undefined ? {} : { cultivar: planting.cultivar }),
        ...(planting.density === undefined ? {} : { density: planting.density }),
        ...(planting.seedSource === undefined ? {} : { seedSource: planting.seedSource }),
        ...(planting.expectedHarvestDate === undefined
          ? {}
          : { expectedHarvestDate: planting.expectedHarvestDate }),
      },
      token,
    ),
};
