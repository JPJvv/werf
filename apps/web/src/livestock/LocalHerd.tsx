/**
 * The local herd — the client's own copy of the farm's animals, read and written through the
 * `@werf/sync` capture-store adapter, never a storage API directly (ADR-0003).
 *
 * This is the Phase 2 stand-in for what becomes a PowerSync watched query in Phase 3:
 * `useAnimals` subscribes to the store and re-renders when a capture lands, so a tile's live
 * number moves the instant the farmer taps Save — offline, with no network in the path. When
 * the backing store swaps to OPFS/SQLite in Phase 3, this file and its consumers do not change.
 *
 * The store is scoped by the active farm's id: switching farms reads a different herd, and one
 * farm's animals can never surface on another's — the client mirror of the RLS boundary.
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
import type { schemas } from '@werf/core';
import { useAuth } from '../auth/AuthProvider';
import { getLocalDatabase } from '../sync/local-db';
import { useCloseCaptureStore } from '../sync/useCloseCaptureStore';

/** What the local herd holds: animals composed offline with a client UUIDv7 (the `new` shape). */
export type StoredAnimal = schemas.NewAnimal;
export type HerdStore = CaptureStore<StoredAnimal>;

/** Injectable so tests can back the herd with in-memory storage instead of localStorage. */
export type HerdStoreFactory = (key: string) => HerdStore;

const defaultFactory: HerdStoreFactory = (key) =>
  createSqliteCaptureStore<StoredAnimal>({
    database: getLocalDatabase(),
    key,
    legacyStorage: window.localStorage,
  });

const HerdStoreContext = createContext<HerdStore | null>(null);

export interface LocalHerdProviderProps {
  children: ReactNode;
  /** Defaults to a localStorage-backed store; tests pass an in-memory factory. */
  factory?: HerdStoreFactory;
}

export function LocalHerdProvider({ children, factory = defaultFactory }: LocalHerdProviderProps) {
  const { activeFarm } = useAuth();
  // 'none' is a safe placeholder: the provider sits inside the authenticated shell where a farm
  // always exists, but a keyless store would still be harmless (it just holds nothing).
  const farmId = activeFarm?.id ?? 'none';
  const store = useMemo(() => factory(`werf-herd:${farmId}`), [factory, farmId]);
  useCloseCaptureStore(store);

  return <HerdStoreContext.Provider value={store}>{children}</HerdStoreContext.Provider>;
}

function useHerdStore(): HerdStore {
  const store = useContext(HerdStoreContext);
  if (!store) throw new Error('useHerdStore must be used inside a LocalHerdProvider');
  return store;
}

/** The farm's animals, reactive: this re-renders when a capture is appended. */
export function useAnimals(): readonly StoredAnimal[] {
  const store = useHerdStore();
  return useSyncExternalStore(store.subscribe, store.all);
}

/** Whether this store's initial hydration attempt is over (`CaptureStore.settled()`) — the
 *  Outbox flush must not act on `useAnimals()` until this is true. */
export function useAnimalsSettled(): boolean {
  const store = useHerdStore();
  return useSyncExternalStore(store.subscribe, store.settled);
}

/** Whether this store's hydration ATTEMPT ended in a genuine failure
 *  (`CaptureStore.hydrationFailed()`) — the Outbox flush must hold, not treat `useAnimals()` as
 *  confirmed empty, when this is true. */
export function useAnimalsHydrationFailed(): boolean {
  const store = useHerdStore();
  return useSyncExternalStore(store.subscribe, store.hydrationFailed);
}

/** Commit an animal to the local herd. Synchronous; never awaits the network (NFR-007). */
export function useRecordAnimal(): (animal: StoredAnimal) => void {
  const store = useHerdStore();
  return useCallback((animal) => store.append(animal), [store]);
}
