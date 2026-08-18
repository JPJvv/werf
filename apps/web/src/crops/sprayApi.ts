/**
 * The spray capture endpoint — where a QUEUED local spray is sent once there is a signal. Not the
 * capture path (see `sync/captureApi.ts` for the transport, the error taxonomy, and why every
 * endpoint here must be idempotent on the client id). Sends exactly the wire contract's fields —
 * never `activeIngredients`/`phiDays`/`earliestHarvestDate`, which a local capture never holds
 * (`LocalSprays.tsx`'s module note) and which the server resolves and refuses to take from a client
 * regardless (`recordSprayRequestSchema`). `phiOverride`, when present, carries only the `reason`
 * the farmer typed — never `by`, which the server resolves from the session, the identical
 * discipline `harvestApi.ts` applies to its own field of the same name.
 */

import { postCapture } from '../sync/captureApi';
import type { StoredSpray } from './LocalSprays';

export const sprayApi = {
  recordSpray: (spray: StoredSpray, token: string): Promise<void> =>
    postCapture(
      '/crops/sprays',
      {
        id: spray.id,
        farmId: spray.farmId,
        landUnitId: spray.landUnitId,
        occurredAt: spray.occurredAt,
        sprayedOn: spray.sprayedOn,
        productId: spray.productId,
        ...(spray.rateLPerHa === undefined ? {} : { rateLPerHa: spray.rateLPerHa }),
        ...(spray.waterLPerHa === undefined ? {} : { waterLPerHa: spray.waterLPerHa }),
        ...(spray.operator === undefined ? {} : { operator: spray.operator }),
        ...(spray.equipment === undefined ? {} : { equipment: spray.equipment }),
        ...(spray.windKph === undefined ? {} : { windKph: spray.windKph }),
        ...(spray.tempC === undefined ? {} : { tempC: spray.tempC }),
        ...(spray.targetPest === undefined ? {} : { targetPest: spray.targetPest }),
        ...(spray.phiOverride === undefined
          ? {}
          : { phiOverride: { reason: spray.phiOverride.reason } }),
      },
      token,
    ),
};
