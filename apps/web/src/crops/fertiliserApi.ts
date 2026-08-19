/**
 * The fertiliser-application capture endpoint — where a QUEUED local application is sent once
 * there is a signal. Not the capture path (see `sync/captureApi.ts` for the transport, the error
 * taxonomy, and why every endpoint here must be idempotent on the client id).
 */

import { postCapture } from '../sync/captureApi';
import type { StoredFertiliser } from './LocalFertiliser';

export const fertiliserApi = {
  recordFertiliser: (application: StoredFertiliser, token: string): Promise<void> =>
    postCapture(
      '/crops/fertiliser-applications',
      {
        id: application.id,
        farmId: application.farmId,
        landUnitId: application.landUnitId,
        // The instant as the STORE holds it: a string, because JSON has no Date and this record
        // came back out of storage. `timestampSchema` parses it on the far side.
        occurredAt: application.occurredAt,
        product: application.product,
        method: application.method,
        ...(application.rate === undefined ? {} : { rate: application.rate }),
        ...(application.operator === undefined ? {} : { operator: application.operator }),
        ...(application.inventoryLotId === undefined
          ? {}
          : { inventoryLotId: application.inventoryLotId }),
      },
      token,
    ),
};
