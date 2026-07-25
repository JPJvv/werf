/**
 * The local land register — the farm's camps and blocks as the device holds them, read and written
 * through the `@werf/sync` capture-store adapter, never a storage API directly (ADR-0003).
 *
 * Same family as `LocalHerd` and `LocalLifecycle`: append-only captured facts, reactive, farm-scoped
 * by key. It is the first store that is a PREREQUISITE for another capture rather than a record of
 * something that happened — an animal is put in a camp, an animal is moved to a camp — which is why
 * the outbox sends land units before animals: a herd row carrying `land_unit_id` would fail its
 * foreign key against ground the server has never seen.
 *
 * The boundary is held as GeoJSON text, never PostGIS. SQLite on the device has no notion of the
 * `geometry` type, so the client authors GeoJSON and the server derives the canonical geometry from
 * it (see `apps/api/src/land/land.service.ts`).
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createCaptureStore, type CaptureStore } from '@werf/sync';
import type { schemas } from '@werf/core';
import { useAuth } from '../auth/AuthProvider';

/** What the register holds: land units composed offline with a client UUIDv7 (the `new` shape). */
export type StoredLandUnit = schemas.NewLandUnit;
export type LandStore = CaptureStore<StoredLandUnit>;

/** Injectable so tests can back the register with in-memory storage instead of localStorage. */
export type LandStoreFactory = (key: string) => LandStore;

const defaultFactory: LandStoreFactory = (key) =>
  createCaptureStore<StoredLandUnit>({ storage: window.localStorage, key });

const LandStoreContext = createContext<LandStore | null>(null);

export interface LocalLandProviderProps {
  children: ReactNode;
  factory?: LandStoreFactory;
}

export function LocalLandProvider({ children, factory = defaultFactory }: LocalLandProviderProps) {
  const { activeFarm } = useAuth();
  const farmId = activeFarm?.id ?? 'none';
  const store = useMemo(() => factory(`werf-land:${farmId}`), [factory, farmId]);

  return <LandStoreContext.Provider value={store}>{children}</LandStoreContext.Provider>;
}

function useLandStore(): LandStore {
  const store = useContext(LandStoreContext);
  if (!store) throw new Error('useLandStore must be used inside a LocalLandProvider');
  return store;
}

/** The farm's camps and blocks, reactive: this re-renders when one is captured. */
export function useLandUnits(): readonly StoredLandUnit[] {
  const store = useLandStore();
  return useSyncExternalStore(store.subscribe, store.all);
}

/** Commit a camp/block to the local register. Synchronous; never awaits the network (NFR-007). */
export function useRecordLandUnit(): (unit: StoredLandUnit) => void {
  const store = useLandStore();
  return useCallback((unit) => store.append(unit), [store]);
}
