/**
 * The land capture endpoint — where a QUEUED local camp/block is sent once there is a signal. Not
 * the capture path: a farmer's Save writes to `LocalLand` with no network in it. `sync/captureApi.ts`
 * holds the transport and the error taxonomy every capture client shares.
 */

import type { schemas } from '@werf/core';
import { postCapture as post } from '../sync/captureApi';
import type { StoredBoundaryWalk } from './LocalLand';

export const landApi = {
  /**
   * Sent BEFORE animals by the flush: a herd row can carry `land_unit_id`, and an animal that
   * arrived before its camp would fail the foreign key against ground the server has never seen.
   */
  createLandUnit: (unit: schemas.NewLandUnit, token: string): Promise<void> =>
    post('/land-units', unit, token),

  /**
   * A completed GPS boundary walk (FR-150). Sent AFTER its camp, which it references — the same
   * foreign-key reason land units go before animals.
   *
   * ⭐ Only the CORNERS go up. The ring the device drew and the area it measured stay local: the
   * server rebuilds both from these fixes with the same domain function, so there is no way for a
   * shape and the evidence behind it to disagree on the wire. The device's copies are a preview,
   * which is why they are kept locally at all — a farmer offline must still see the camp they
   * walked.
   */
  recordBoundaryWalk: (walk: StoredBoundaryWalk, token: string): Promise<void> =>
    post(
      '/land-units/boundary-walks',
      {
        id: walk.id,
        farmId: walk.farmId,
        landUnitId: walk.landUnitId,
        // The instant as the STORE holds it: a string, because JSON has no Date and this record
        // came back out of localStorage. `timestampSchema` parses it on the far side.
        occurredAt: walk.occurredAt,
        corners: [...walk.corners],
      },
      token,
    ),
};
