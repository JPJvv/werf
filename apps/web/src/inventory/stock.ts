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
 */

import { useMemo } from 'react';
import { projectQuantityOnHand } from '@werf/domain';
import { mergeById } from '../livestock/HydratedLivestock';
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

/** This device's own inventory items, merged with items another device created (`mergeById`, the
 *  local-wins fold — no field here changes after creation, so this is a straight dedupe). */
export function useEffectiveInventoryItems(): readonly StoredInventoryItem[] {
  const items = useInventoryItems();
  const hydrated = useHydratedInventoryItems();
  return useMemo(() => mergeById(items, hydrated), [items, hydrated]);
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
