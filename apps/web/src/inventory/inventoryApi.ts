/**
 * Inventory capture endpoints (Phase 4e, FR-501) — where a QUEUED local item, lot or movement is
 * sent once there is a signal. Not the capture path (see `sync/captureApi.ts` for the transport,
 * the error taxonomy, and why every endpoint here must be idempotent on the client id).
 */

import { postCapture } from '../sync/captureApi';
import type {
  StoredInventoryItem,
  StoredInventoryLot,
  StoredInventoryMovement,
} from './LocalInventory';

export const inventoryApi = {
  recordItem: (item: StoredInventoryItem, token: string): Promise<void> =>
    postCapture(
      '/inventory/items',
      {
        id: item.id,
        farmId: item.farmId,
        enterpriseId: item.enterpriseId,
        category: item.category,
        name: item.name,
        unit: item.unit,
      },
      token,
    ),

  recordLot: (lot: StoredInventoryLot, token: string): Promise<void> =>
    postCapture(
      '/inventory/lots',
      {
        id: lot.id,
        farmId: lot.farmId,
        inventoryItemId: lot.inventoryItemId,
        batch: lot.batch,
        expiryDate: lot.expiryDate,
        location: lot.location,
      },
      token,
    ),

  recordMovement: (movement: StoredInventoryMovement, token: string): Promise<void> =>
    postCapture(
      '/inventory/movements',
      {
        id: movement.id,
        farmId: movement.farmId,
        inventoryLotId: movement.inventoryLotId,
        // The instant as the STORE holds it: a string, because JSON has no Date and this record
        // came back out of storage. `timestampSchema` parses it on the far side.
        occurredAt: movement.occurredAt,
        reason: movement.reason,
        quantity: movement.quantity,
        ...(movement.unitCostCents === undefined ? {} : { unitCostCents: movement.unitCostCents }),
        ...(movement.enterpriseId === undefined ? {} : { enterpriseId: movement.enterpriseId }),
        ...(movement.notes === undefined ? {} : { notes: movement.notes }),
      },
      token,
    ),
};
