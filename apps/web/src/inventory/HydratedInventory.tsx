/**
 * The down-sync half of inventory (Phase 4e, FR-501) — items, lots and movements another device
 * captured, already replicated to THIS device via PowerSync — read through the `@werf/sync`
 * adapter, never the SDK directly (ADR-0003). Same family as `livestock/HydratedLivestock.tsx` and
 * `land/HydratedLand.tsx`: a second, independent read of the canonical `inventory_items`/
 * `inventory_lots`/`events` tables PowerSync down-syncs into, farm-scoped so a multi-farm account's
 * other farms never leak in.
 *
 * Deliberately NOT a widening of `LocalInventory.tsx`, for the identical reason `HydratedLand.tsx`
 * documents: a hydrated row must never look like a pending local capture, or a device would re-POST
 * another device's already-landed work. `stock.ts`'s `useEffectiveInventoryLots` merges the two
 * explicitly for every READ path.
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createHydratedTableStore, type HydratedTableStore } from '@werf/sync';
import { isInventoryItemCategory } from '@werf/core';
import { useAuth } from '../auth/AuthProvider';
import { getLocalDatabase } from '../sync/local-db';
import type {
  StoredInventoryItem,
  StoredInventoryLot,
  StoredInventoryMovement,
} from './LocalInventory';

const INVENTORY_ITEMS_SQL =
  'SELECT id, farm_id, enterprise_id, category, name, unit FROM inventory_items ' +
  'WHERE farm_id = ? AND deleted_at IS NULL';

const INVENTORY_LOTS_SQL =
  'SELECT id, farm_id, inventory_item_id, batch, expiry_date, location, quantity_on_hand ' +
  'FROM inventory_lots WHERE farm_id = ? AND deleted_at IS NULL';

// `type = 'inventory_movement'` narrows the shared `events` table to exactly the rows
// `projectQuantityOnHand` folds — every other event type is invisible to this query by construction.
const INVENTORY_MOVEMENT_EVENTS_SQL =
  'SELECT id, farm_id, inventory_lot_id, occurred_at, payload FROM events ' +
  "WHERE farm_id = ? AND type = 'inventory_movement' AND deleted_at IS NULL";

/** Tolerant per row — a row written by a future schema version this build does not understand is
 *  skipped, not fatal, same philosophy as `HydratedLand.tsx`'s mapper. */
function mapHydratedInventoryItem(row: Record<string, unknown>): StoredInventoryItem | null {
  const id = row['id'];
  const farmId = row['farm_id'];
  const category = row['category'];
  const name = row['name'];
  const unit = row['unit'];
  if (
    typeof id !== 'string' ||
    typeof farmId !== 'string' ||
    typeof category !== 'string' ||
    !isInventoryItemCategory(category) ||
    typeof name !== 'string' ||
    typeof unit !== 'string'
  ) {
    return null;
  }
  const enterpriseId = row['enterprise_id'];
  return {
    id,
    farmId,
    enterpriseId: typeof enterpriseId === 'string' ? enterpriseId : null,
    category,
    name,
    unit,
  };
}

function mapHydratedInventoryLot(row: Record<string, unknown>): StoredInventoryLot | null {
  const id = row['id'];
  const farmId = row['farm_id'];
  const inventoryItemId = row['inventory_item_id'];
  if (typeof id !== 'string' || typeof farmId !== 'string' || typeof inventoryItemId !== 'string') {
    return null;
  }
  const str = (key: string): string | null =>
    typeof row[key] === 'string' ? (row[key] as string) : null;
  return {
    id,
    farmId,
    inventoryItemId,
    batch: str('batch'),
    expiryDate: str('expiry_date'),
    location: str('location'),
  };
}

/** Same tolerance, plus a `JSON.parse` of the event payload — the same shape
 *  `recordInventoryMovement` (`@werf/domain`) writes, read back rather than duplicated. */
function mapHydratedInventoryMovement(
  row: Record<string, unknown>,
): StoredInventoryMovement | null {
  const id = row['id'];
  const farmId = row['farm_id'];
  const inventoryLotId = row['inventory_lot_id'];
  const occurredAtRaw = row['occurred_at'];
  const payloadJson = row['payload'];
  if (
    typeof id !== 'string' ||
    typeof farmId !== 'string' ||
    typeof inventoryLotId !== 'string' ||
    typeof occurredAtRaw !== 'string' ||
    typeof payloadJson !== 'string'
  ) {
    return null;
  }
  const occurredAtDate = new Date(occurredAtRaw);
  if (Number.isNaN(occurredAtDate.getTime())) return null;

  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(payloadJson);
    if (typeof parsed !== 'object' || parsed === null) return null;
    payload = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  const reason = payload['reason'];
  if (reason !== 'received' && reason !== 'consumed' && reason !== 'counted') return null;
  const delta = typeof payload['delta'] === 'number' ? payload['delta'] : undefined;
  const countedQuantity =
    typeof payload['countedQuantity'] === 'number' ? payload['countedQuantity'] : undefined;
  // Never carried on a hydrated row: `quantity` is what the farmer TYPED, which the projection
  // never reads (only `delta`/`countedQuantity` are) — see `StoredInventoryMovement`'s own note.
  const quantity = reason === 'counted' ? (countedQuantity ?? 0) : Math.abs(delta ?? 0);

  return {
    id,
    farmId,
    inventoryLotId,
    occurredAt: occurredAtDate.toISOString(),
    reason,
    quantity,
    ...(delta === undefined ? {} : { delta }),
    ...(countedQuantity === undefined ? {} : { countedQuantity }),
  };
}

interface HydratedInventoryValue {
  readonly items: HydratedTableStore<StoredInventoryItem>;
  readonly lots: HydratedTableStore<StoredInventoryLot>;
  readonly movements: HydratedTableStore<StoredInventoryMovement>;
}

/** Permanently unsettled, no subscription to close — see `HydratedLivestock.tsx`'s identical
 *  helper for the full StrictMode rationale. */
function emptyHydratedTableStore<T>(): HydratedTableStore<T> {
  const empty: readonly T[] = [];
  return {
    all: () => empty,
    subscribe: () => () => {},
    settled: () => false,
    hydrationFailed: () => false,
    close: () => {},
  };
}

const HydratedInventoryContext = createContext<HydratedInventoryValue | null>(null);

export function HydratedInventoryProvider({ children }: { children: ReactNode }) {
  const { activeFarm } = useAuth();
  const farmId = activeFarm?.id ?? 'none';
  const [value, setValue] = useState<HydratedInventoryValue>(() => ({
    items: emptyHydratedTableStore<StoredInventoryItem>(),
    lots: emptyHydratedTableStore<StoredInventoryLot>(),
    movements: emptyHydratedTableStore<StoredInventoryMovement>(),
  }));

  // Construction lives INSIDE the effect, not a `useMemo` above it — `HydratedLivestock.tsx`'s
  // StrictMode finding applies identically here.
  useEffect(() => {
    const set: HydratedInventoryValue = {
      items: createHydratedTableStore({
        database: getLocalDatabase(),
        sql: INVENTORY_ITEMS_SQL,
        params: [farmId],
        mapRow: mapHydratedInventoryItem,
      }),
      lots: createHydratedTableStore({
        database: getLocalDatabase(),
        sql: INVENTORY_LOTS_SQL,
        params: [farmId],
        mapRow: mapHydratedInventoryLot,
      }),
      movements: createHydratedTableStore({
        database: getLocalDatabase(),
        sql: INVENTORY_MOVEMENT_EVENTS_SQL,
        params: [farmId],
        mapRow: mapHydratedInventoryMovement,
      }),
    };
    setValue(set);
    return () => {
      set.items.close();
      set.lots.close();
      set.movements.close();
    };
  }, [farmId]);

  return (
    <HydratedInventoryContext.Provider value={value}>{children}</HydratedInventoryContext.Provider>
  );
}

function useHydratedInventory(): HydratedInventoryValue {
  const ctx = useContext(HydratedInventoryContext);
  if (!ctx) throw new Error('useHydrated* must be used inside a HydratedInventoryProvider');
  return ctx;
}

/** Items another device created and the server has replicated to this one. */
export function useHydratedInventoryItems(): readonly StoredInventoryItem[] {
  const { items } = useHydratedInventory();
  return useSyncExternalStore(items.subscribe, items.all);
}

export function useHydratedInventoryItemsSettled(): boolean {
  const { items } = useHydratedInventory();
  return useSyncExternalStore(items.subscribe, items.settled);
}

export function useHydratedInventoryItemsHydrationFailed(): boolean {
  const { items } = useHydratedInventory();
  return useSyncExternalStore(items.subscribe, items.hydrationFailed);
}

/** Lots another device created and the server has replicated to this one. */
export function useHydratedInventoryLots(): readonly StoredInventoryLot[] {
  const { lots } = useHydratedInventory();
  return useSyncExternalStore(lots.subscribe, lots.all);
}

export function useHydratedInventoryLotsSettled(): boolean {
  const { lots } = useHydratedInventory();
  return useSyncExternalStore(lots.subscribe, lots.settled);
}

export function useHydratedInventoryLotsHydrationFailed(): boolean {
  const { lots } = useHydratedInventory();
  return useSyncExternalStore(lots.subscribe, lots.hydrationFailed);
}

/** Movements another device sent and the server has replicated to this one. */
export function useHydratedInventoryMovements(): readonly StoredInventoryMovement[] {
  const { movements } = useHydratedInventory();
  return useSyncExternalStore(movements.subscribe, movements.all);
}

export function useHydratedInventoryMovementsSettled(): boolean {
  const { movements } = useHydratedInventory();
  return useSyncExternalStore(movements.subscribe, movements.settled);
}

export function useHydratedInventoryMovementsHydrationFailed(): boolean {
  const { movements } = useHydratedInventory();
  return useSyncExternalStore(movements.subscribe, movements.hydrationFailed);
}
