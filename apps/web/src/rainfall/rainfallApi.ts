/**
 * The rainfall capture endpoint — where a QUEUED local reading is sent once there is a signal. Not
 * the capture path (see `sync/captureApi.ts` for the transport, the error taxonomy, and why every
 * endpoint here must be idempotent on the client id).
 */

import { postCapture } from '../sync/captureApi';
import type { StoredRainfall } from './LocalRainfall';

export const rainfallApi = {
  recordRainfall: (reading: StoredRainfall, token: string): Promise<void> =>
    postCapture(
      '/rainfall',
      {
        id: reading.id,
        farmId: reading.farmId,
        occurredAt: reading.occurredAt,
        mm: reading.mm,
        ...(reading.gauge === undefined ? {} : { gauge: reading.gauge }),
      },
      token,
    ),
};
