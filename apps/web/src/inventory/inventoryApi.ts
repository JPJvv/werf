/**
 * Inventory capture endpoints (Phase 4e, FR-501) — where a QUEUED local item, lot or movement is
 * sent once there is a signal. Not the capture path (see `sync/captureApi.ts` for the transport,
 * the error taxonomy, and why every endpoint here must be idempotent on the client id).
 *
 * `updateReorderPoint` (FR-503, 4e·5) is deliberately NOT a capture: it is a shared farm-config
 * edit, the same online-only shape `authApi.updateRestPeriodDays` uses for FR-152 and for the
 * identical reason (`stock.ts`'s `useSetReorderPoint` note) — so it is not routed through
 * `postCapture`/the outbox. Unlike `updateRestPeriodDays`, its caller has nothing to patch back
 * into local state with: the item list is a PowerSync-hydrated read (`HydratedInventory.tsx`), so
 * the response body is discarded and only success/failure matters.
 */

import { AuthApiError, NetworkUnavailableError } from '../auth/api';
import { postCapture } from '../sync/captureApi';
import type {
  StoredInventoryItem,
  StoredInventoryLot,
  StoredInventoryMovement,
} from './LocalInventory';

/** Where the API lives. Same origin in production; Vite proxies it in dev. Mirrors `auth/api.ts`
 *  and `sync/captureApi.ts`'s own copies of this constant. */
const API_BASE = (import.meta.env['VITE_API_URL'] as string | undefined) ?? '/api';

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
        registrationNumber: item.registrationNumber ?? null,
        activeIngredients: item.activeIngredients ?? null,
        phiDays: item.phiDays ?? null,
        reentryHours: item.reentryHours ?? null,
        meatWithdrawalDays: item.meatWithdrawalDays ?? null,
        milkWithdrawalHours: item.milkWithdrawalHours ?? null,
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

  updateReorderPoint: async (
    itemId: string,
    input: { farmId: string; reorderPoint: number | null },
    token: string,
  ): Promise<void> => {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}/inventory/items/${itemId}/reorder-point`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(input),
      });
    } catch {
      throw new NetworkUnavailableError();
    }
    if (response.ok) return;
    const payload: unknown = await response.json().catch(() => ({}));
    const { code, message } = payload as { code?: string; message?: string };
    throw new AuthApiError(
      code ?? 'UNKNOWN',
      message ?? 'Could not update reorder point',
      response.status,
    );
  },
};
