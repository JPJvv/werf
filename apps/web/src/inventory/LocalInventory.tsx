/**
 * The local inventory log (Phase 4e, FR-501) — items, lots and stock movements this device has
 * captured, read and written through the `@werf/sync` capture-store adapter, never a storage API
 * directly (ADR-0003). Three stores in one file, the same split `LocalMobs.tsx`/`LocalTallies.tsx`
 * draw: an item and a lot are simple entities (created once, never re-derived), and a movement is
 * the tally-shaped one — `inventory_lots.quantity_on_hand` is a PROJECTION of the movement log,
 * never a directly-edited field (see `@werf/domain`'s `projectQuantityOnHand`, and `stock.ts` in
 * this folder for the client-side fold that combines this store with the down-synced log).
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createSqliteCaptureStore, type CaptureStore } from '@werf/sync';
import { schemas, type InventoryItemCategory } from '@werf/core';
import { recordInventoryMovement } from '@werf/domain';
import { useAuth } from '../auth/AuthProvider';
import { getLocalDatabase } from '../sync/local-db';
import { useCloseCaptureStore } from '../sync/useCloseCaptureStore';

/** An inventory item as held locally — the farm's own catalogue entry ("our urea"). */
export interface StoredInventoryItem {
  readonly id: string;
  readonly farmId: string;
  readonly enterpriseId: string | null;
  readonly category: InventoryItemCategory;
  readonly name: string;
  readonly unit: string;
}

/** A lot as held locally — a physical batch of an item. `quantityOnHand` here is always what this
 *  capture started at (zero — a lot is created empty, see the module note); a screen reading the
 *  CURRENT quantity uses `useEffectiveInventoryLots` (`stock.ts`), never this field directly. */
export interface StoredInventoryLot {
  readonly id: string;
  readonly farmId: string;
  readonly inventoryItemId: string;
  readonly batch: string | null;
  readonly expiryDate: string | null;
  readonly location: string | null;
}

/** A stock movement as held locally. `quantity` is what the farmer typed and is what goes on the
 *  wire; `delta`/`countedQuantity` are what the projection reads — the identical split
 *  `StoredTally` draws between `count` and `delta`/`countedHead`, for the identical reason: the
 *  sign rule lives in exactly one place (the domain capture that produced this record). */
export interface StoredInventoryMovement {
  readonly id: string;
  readonly farmId: string;
  readonly inventoryLotId: string;
  /** ISO 8601. When it happened on the farm, not when it was captured. */
  readonly occurredAt: string;
  readonly reason: schemas.InventoryMovementReason;
  readonly quantity: number;
  readonly delta?: number;
  readonly countedQuantity?: number;
  readonly unitCostCents?: number;
  readonly enterpriseId?: string | null;
  readonly notes?: string | null;
}

export type InventoryItemStore = CaptureStore<StoredInventoryItem>;
export type InventoryLotStore = CaptureStore<StoredInventoryLot>;
export type InventoryMovementStore = CaptureStore<StoredInventoryMovement>;

export type InventoryItemStoreFactory = (key: string) => InventoryItemStore;
export type InventoryLotStoreFactory = (key: string) => InventoryLotStore;
export type InventoryMovementStoreFactory = (key: string) => InventoryMovementStore;

const defaultItemFactory: InventoryItemStoreFactory = (key) =>
  createSqliteCaptureStore<StoredInventoryItem>({
    database: getLocalDatabase,
    key,
    legacyStorage: window.localStorage,
  });

const defaultLotFactory: InventoryLotStoreFactory = (key) =>
  createSqliteCaptureStore<StoredInventoryLot>({
    database: getLocalDatabase,
    key,
    legacyStorage: window.localStorage,
  });

const defaultMovementFactory: InventoryMovementStoreFactory = (key) =>
  createSqliteCaptureStore<StoredInventoryMovement>({
    database: getLocalDatabase,
    key,
    legacyStorage: window.localStorage,
  });

const ItemStoreContext = createContext<InventoryItemStore | null>(null);
const LotStoreContext = createContext<InventoryLotStore | null>(null);
const MovementStoreContext = createContext<InventoryMovementStore | null>(null);

export interface LocalInventoryProviderProps {
  children: ReactNode;
  itemFactory?: InventoryItemStoreFactory;
  lotFactory?: InventoryLotStoreFactory;
  movementFactory?: InventoryMovementStoreFactory;
}

/**
 * One provider composing the three stores, so `AppShell.tsx`'s `CAPTURE_STORES` list gains a
 * single entry rather than three — the same reasoning that list's own header gives for staying
 * flat: nesting that carries no meaning is exactly what makes a dropped provider easy to miss.
 */
export function LocalInventoryProvider({
  children,
  itemFactory = defaultItemFactory,
  lotFactory = defaultLotFactory,
  movementFactory = defaultMovementFactory,
}: LocalInventoryProviderProps) {
  const { activeFarm } = useAuth();
  const farmId = activeFarm?.id ?? 'none';
  const itemStore = useMemo(
    () => itemFactory(`werf-inventory-items:${farmId}`),
    [itemFactory, farmId],
  );
  const lotStore = useMemo(() => lotFactory(`werf-inventory-lots:${farmId}`), [lotFactory, farmId]);
  const movementStore = useMemo(
    () => movementFactory(`werf-inventory-movements:${farmId}`),
    [movementFactory, farmId],
  );
  useCloseCaptureStore(itemStore);
  useCloseCaptureStore(lotStore);
  useCloseCaptureStore(movementStore);

  return (
    <ItemStoreContext.Provider value={itemStore}>
      <LotStoreContext.Provider value={lotStore}>
        <MovementStoreContext.Provider value={movementStore}>
          {children}
        </MovementStoreContext.Provider>
      </LotStoreContext.Provider>
    </ItemStoreContext.Provider>
  );
}

function useItemStore(): InventoryItemStore {
  const store = useContext(ItemStoreContext);
  if (!store) throw new Error('useInventoryItems must be used inside a LocalInventoryProvider');
  return store;
}

function useLotStore(): InventoryLotStore {
  const store = useContext(LotStoreContext);
  if (!store) throw new Error('useInventoryLots must be used inside a LocalInventoryProvider');
  return store;
}

function useMovementStore(): InventoryMovementStore {
  const store = useContext(MovementStoreContext);
  if (!store) {
    throw new Error('useInventoryMovements must be used inside a LocalInventoryProvider');
  }
  return store;
}

/** This device's own inventory items, reactive. */
export function useInventoryItems(): readonly StoredInventoryItem[] {
  const store = useItemStore();
  return useSyncExternalStore(store.subscribe, store.all);
}

export function useInventoryItemsSettled(): boolean {
  const store = useItemStore();
  return useSyncExternalStore(store.subscribe, store.settled);
}

export function useInventoryItemsHydrationFailed(): boolean {
  const store = useItemStore();
  return useSyncExternalStore(store.subscribe, store.hydrationFailed);
}

/** This device's own inventory lots, reactive. */
export function useInventoryLots(): readonly StoredInventoryLot[] {
  const store = useLotStore();
  return useSyncExternalStore(store.subscribe, store.all);
}

export function useInventoryLotsSettled(): boolean {
  const store = useLotStore();
  return useSyncExternalStore(store.subscribe, store.settled);
}

export function useInventoryLotsHydrationFailed(): boolean {
  const store = useLotStore();
  return useSyncExternalStore(store.subscribe, store.hydrationFailed);
}

/** This device's own stock movements, reactive. */
export function useInventoryMovements(): readonly StoredInventoryMovement[] {
  const store = useMovementStore();
  return useSyncExternalStore(store.subscribe, store.all);
}

export function useInventoryMovementsSettled(): boolean {
  const store = useMovementStore();
  return useSyncExternalStore(store.subscribe, store.settled);
}

export function useInventoryMovementsHydrationFailed(): boolean {
  const store = useMovementStore();
  return useSyncExternalStore(store.subscribe, store.hydrationFailed);
}

/**
 * Commit a new inventory item locally (Phase 4e, FR-501). Synchronous; never awaits the network
 * (NFR-007). No domain validation function exists for this — like `recordMob`, an item is a plain
 * entity with no derived state, so the FK/shape checks the wire schema runs on flush are the only
 * ones there are.
 */
export function useRecordInventoryItem(): (item: StoredInventoryItem) => Promise<void> {
  const store = useItemStore();
  return useCallback((item) => store.append(item), [store]);
}

/** Commit a new (empty) lot locally. See `useRecordInventoryItem`'s note — no domain function. */
export function useRecordInventoryLot(): (lot: StoredInventoryLot) => Promise<void> {
  const store = useLotStore();
  return useCallback((lot) => store.append(lot), [store]);
}

/** What a screen hands the recorder. The capture instant is a real Date at this boundary. */
export interface InventoryMovementCapture {
  readonly id: string;
  readonly farmId: string;
  readonly inventoryLotId: string;
  readonly occurredAt: Date;
  readonly reason: schemas.InventoryMovementReason;
  /** How much, as the farmer typed it — always non-negative. See `StoredInventoryMovement`. */
  readonly quantity: number;
  /** The lot's quantity right now (`useEffectiveInventoryLots`) — what the domain folds this
   *  movement onto. */
  readonly currentQuantity: number;
  readonly unitCostCents?: number;
  readonly enterpriseId?: string | null;
  readonly notes?: string | null;
}

/**
 * Commit a stock movement locally (Phase 4e, FR-501). Synchronous; never awaits the network.
 * Validated through the pure domain capture first — the sign rule and the zero-change rule — so a
 * bad capture throws here rather than entering the append-only log. ⛔ Unlike a tally, this never
 * throws for a `consumed` movement larger than the quantity on file — see `stock.ts` (@werf/domain).
 */
export function useRecordInventoryMovement(): (capture: InventoryMovementCapture) => Promise<void> {
  const store = useMovementStore();
  return useCallback(
    (capture) => {
      const { event } = recordInventoryMovement({
        id: capture.id,
        farmId: capture.farmId,
        inventoryLotId: capture.inventoryLotId,
        occurredAt: capture.occurredAt,
        reason: capture.reason,
        quantity: capture.quantity,
        currentQuantity: capture.currentQuantity,
        unitCostCents: capture.unitCostCents,
        enterpriseId: capture.enterpriseId,
        notes: capture.notes,
      });
      const payload = event.payload as { delta?: number; countedQuantity?: number };
      return store.append({
        id: capture.id,
        farmId: capture.farmId,
        inventoryLotId: capture.inventoryLotId,
        occurredAt: capture.occurredAt.toISOString(),
        reason: capture.reason,
        quantity: capture.quantity,
        ...(payload.delta === undefined ? {} : { delta: payload.delta }),
        ...(payload.countedQuantity === undefined
          ? {}
          : { countedQuantity: payload.countedQuantity }),
        ...(capture.unitCostCents === undefined ? {} : { unitCostCents: capture.unitCostCents }),
        ...(capture.enterpriseId === undefined ? {} : { enterpriseId: capture.enterpriseId }),
        ...(capture.notes === undefined ? {} : { notes: capture.notes }),
      });
    },
    [store],
  );
}
