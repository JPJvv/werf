/**
 * Effective inventory reads (Phase 4e, FR-501) — this device's own captures MERGED with what
 * another device sent and the server has already replicated down, the identical shape
 * `herd.ts`'s `projectMobs` draws for mobs/tallies one domain over.
 *
 * ⭐ A lot's `quantityOnHand` is never read off the merged row directly. `mergeById` keeps
 * whichever copy of a lot it saw first (local-wins) and does not touch its OTHER fields, but
 * `quantity_on_hand` is not a static field the way `batch`/`location` are — it changes every time
 * a movement lands, on this device or another one, so trusting either copy's snapshot would go
 * stale the moment a movement is captured. The quantity is instead PROJECTED fresh from the merged
 * movement log for that lot, exactly as `mobs.head_count` is folded from the tally log rather than
 * read off either copy of the mob row.
 *
 * ⭐ Items use `mergeByIdPreferHydrated`, NOT `mergeById` — the one deliberate divergence from
 * lots/movements, because `reorderPoint` (FR-503, 4e·5) broke the "no field here changes after
 * creation" premise `mergeById` relied on. It is set later, server-side, by
 * `updateReorderPoint` — a client-absent-then-server-enriched field, `grazing.ts`'s own precedent
 * for why local-wins would shadow the enrichment forever: this device's own locally-created copy
 * (which never carries a reorder point — see `LocalInventory.tsx`'s module note) would otherwise
 * permanently mask the value an owner/manager set from ANY device, including this one.
 */

import { useCallback, useMemo } from 'react';
import { projectQuantityOnHand } from '@werf/domain';
import { mergeById, mergeByIdPreferHydrated } from '../livestock/HydratedLivestock';
import { useAuth } from '../auth/AuthProvider';
import { inventoryApi } from './inventoryApi';
import {
  useInventoryItems,
  useInventoryLots,
  useInventoryMovements,
  type StoredInventoryItem,
  type StoredInventoryLot,
  type StoredInventoryMovement,
} from './LocalInventory';
import {
  useHydratedInventoryItems,
  useHydratedInventoryLots,
  useHydratedInventoryMovements,
} from './HydratedInventory';

/** A lot as a screen reads it: its identity, plus the quantity PROJECTED from the movement log. */
export interface EffectiveInventoryLot extends StoredInventoryLot {
  readonly quantityOnHand: number;
}

/** This device's own inventory items, merged with items another device created — hydrated-wins,
 *  see the module note. */
export function useEffectiveInventoryItems(): readonly StoredInventoryItem[] {
  const items = useInventoryItems();
  const hydrated = useHydratedInventoryItems();
  return useMemo(() => mergeByIdPreferHydrated(items, hydrated), [items, hydrated]);
}

/** Every lot this device knows about, each carrying its CURRENT quantity on hand — see the module
 *  note for why that field is projected rather than read off either copy of the row. */
export function useEffectiveInventoryLots(): readonly EffectiveInventoryLot[] {
  const lots = useInventoryLots();
  const hydratedLots = useHydratedInventoryLots();
  const movements = useInventoryMovements();
  const hydratedMovements = useHydratedInventoryMovements();
  const mergedLots = useMemo(() => mergeById(lots, hydratedLots), [lots, hydratedLots]);
  const mergedMovements = useMemo(
    () => mergeById(movements, hydratedMovements),
    [movements, hydratedMovements],
  );
  return useMemo(
    () => projectInventoryLots(mergedLots, mergedMovements),
    [mergedLots, mergedMovements],
  );
}

/** The current quantity for ONE lot, or zero when this device has no record of any movement yet —
 *  the honest starting answer for a lot that has just been created and never received into. */
export function useCurrentQuantity(inventoryLotId: string): number {
  const lots = useEffectiveInventoryLots();
  return lots.find((lot) => lot.id === inventoryLotId)?.quantityOnHand ?? 0;
}

/** Pure: fold the merged movement log onto each lot. Exported for tests. */
export function projectInventoryLots(
  lots: readonly StoredInventoryLot[],
  movements: readonly StoredInventoryMovement[],
): readonly EffectiveInventoryLot[] {
  const byLot = new Map<string, StoredInventoryMovement[]>();
  for (const movement of movements) {
    const held = byLot.get(movement.inventoryLotId);
    if (held) held.push(movement);
    else byLot.set(movement.inventoryLotId, [movement]);
  }
  return lots.map((lot) => ({
    ...lot,
    quantityOnHand: projectQuantityOnHand(
      (byLot.get(lot.id) ?? []).map((movement) => ({
        id: movement.id,
        inventoryLotId: movement.inventoryLotId,
        occurredAt: movement.occurredAt,
        reason: movement.reason,
        delta: movement.delta,
        countedQuantity: movement.countedQuantity,
      })),
    ),
  }));
}

/** FR-503's low-stock warning (4e·5): one item is low. */
export interface LowStockWarning {
  readonly inventoryItemId: string;
  /** Summed across EVERY lot of this item — see the module note on why a threshold is per-item
   *  but never per-lot: a single low batch is normal, an item's stock running out is the warning. */
  readonly quantityOnHand: number;
  readonly reorderPoint: number;
}

/**
 * Pure: which items are at or below their own reorder point (4e·2's `restPeriodWarning` shape —
 * `null`-shaped absence, never a guessed threshold). An item with no `reorderPoint` set never
 * appears here — "unset" means no warning, not "warn at zero" (owner decision precedent, 4e·2).
 */
export function lowStockWarnings(
  items: readonly StoredInventoryItem[],
  lots: readonly EffectiveInventoryLot[],
): readonly LowStockWarning[] {
  const totalByItem = new Map<string, number>();
  for (const lot of lots) {
    totalByItem.set(
      lot.inventoryItemId,
      (totalByItem.get(lot.inventoryItemId) ?? 0) + lot.quantityOnHand,
    );
  }
  const warnings: LowStockWarning[] = [];
  for (const item of items) {
    const reorderPoint = item.reorderPoint;
    if (reorderPoint === undefined || reorderPoint === null) continue;
    const quantityOnHand = totalByItem.get(item.id) ?? 0;
    if (quantityOnHand <= reorderPoint) {
      warnings.push({ inventoryItemId: item.id, quantityOnHand, reorderPoint });
    }
  }
  return warnings;
}

/**
 * Pure: FR-503's expiry warning (4e·5) — "expired" only this slice (owner decision), so this
 * needs no threshold to guess: a lot's own recorded `expiryDate` against `today` (`farmToday()`,
 * injected by the caller — never `toISOString().slice(0,10)`) is an objective fact, not a
 * judgement call the way a low-stock reorder point or a rest-period day count is.
 */
export function isExpired(lot: Pick<StoredInventoryLot, 'expiryDate'>, today: string): boolean {
  return lot.expiryDate !== null && lot.expiryDate < today;
}

/**
 * FR-503 (4e·5): set or clear an item's reorder point. Online-only, like `saveRestPeriodDays`
 * (FR-152, 4e·2) — a shared farm-configuration edit, not a farmer's captured work, so it resolves
 * `false` rather than queuing (CLAUDE.md's write-queue rule protects captured work, not a
 * preference toggle). Lives here rather than on `AuthProvider` because nothing about `activeFarm`
 * changes — the write lands through PowerSync's normal replication and `useEffectiveInventoryItems`
 * picks it up reactively once it round-trips, the same way any other device's edit would.
 */
export function useSetReorderPoint(): (
  itemId: string,
  reorderPoint: number | null,
) => Promise<boolean> {
  const { activeFarm, session } = useAuth();
  const accessToken = session?.accessToken;
  return useCallback(
    async (itemId, reorderPoint) => {
      if (!activeFarm || !accessToken) return false;
      try {
        await inventoryApi.updateReorderPoint(
          itemId,
          { farmId: activeFarm.id, reorderPoint },
          accessToken,
        );
        return true;
      } catch {
        return false;
      }
    },
    [activeFarm, accessToken],
  );
}
