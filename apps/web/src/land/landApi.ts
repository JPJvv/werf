/**
 * The land capture endpoint — where a QUEUED local camp/block is sent once there is a signal. Not
 * the capture path: a farmer's Save writes to `LocalLand` with no network in it. `sync/captureApi.ts`
 * holds the transport and the error taxonomy every capture client shares.
 */

import type { schemas } from '@werf/core';
import { postCapture as post } from '../sync/captureApi';

export const landApi = {
  /**
   * Sent BEFORE animals by the flush: a herd row can carry `land_unit_id`, and an animal that
   * arrived before its camp would fail the foreign key against ground the server has never seen.
   */
  createLandUnit: (unit: schemas.NewLandUnit, token: string): Promise<void> =>
    post('/land-units', unit, token),
};
