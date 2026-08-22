/** Sends a queued farmer-owned spray record. The server validates shape and tenancy, not legality. */

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
        productName: spray.productName,
        ...(spray.registrationNumber === undefined
          ? {}
          : { registrationNumber: spray.registrationNumber }),
        ...(spray.activeIngredients === undefined
          ? {}
          : { activeIngredients: spray.activeIngredients }),
        ...(spray.phiDays === undefined ? {} : { phiDays: spray.phiDays }),
        ...(spray.rateLPerHa === undefined ? {} : { rateLPerHa: spray.rateLPerHa }),
        ...(spray.waterLPerHa === undefined ? {} : { waterLPerHa: spray.waterLPerHa }),
        ...(spray.operator === undefined ? {} : { operator: spray.operator }),
        ...(spray.equipment === undefined ? {} : { equipment: spray.equipment }),
        ...(spray.windKph === undefined ? {} : { windKph: spray.windKph }),
        ...(spray.tempC === undefined ? {} : { tempC: spray.tempC }),
        ...(spray.targetPest === undefined ? {} : { targetPest: spray.targetPest }),
        ...(spray.inventoryLotId === undefined ? {} : { inventoryLotId: spray.inventoryLotId }),
      },
      token,
    ),
};
