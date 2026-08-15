/**
 * The farm's registered identification marks (FR-601), captured locally before they are sent.
 * A mark is an FK root for an animal carrying it, so this store is separate from the herd and the
 * outbox sends it first. The list combines these pending rows with the canonical rows PowerSync
 * has already hydrated; a hydrated row is never put back into the upload queue.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { schemas } from '@werf/core';
import { createSqliteCaptureStore, type CaptureStore } from '@werf/sync';
import { useAuth } from '../auth/AuthProvider';
import { getLocalDatabase } from '../sync/local-db';
import { useCloseCaptureStore } from '../sync/useCloseCaptureStore';
import { mergeById, useHydratedBrandingRegisters } from './HydratedLivestock';

export type StoredBrandingRegister = schemas.NewBrandingRegister;
export type BrandingStore = CaptureStore<StoredBrandingRegister>;
export type BrandingStoreFactory = (key: string) => BrandingStore;

const defaultFactory: BrandingStoreFactory = (key) =>
  createSqliteCaptureStore<StoredBrandingRegister>({
    database: getLocalDatabase,
    key,
    legacyStorage: window.localStorage,
  });

const BrandingStoreContext = createContext<BrandingStore | null>(null);

export function LocalBrandingProvider({
  children,
  factory = defaultFactory,
}: {
  children: ReactNode;
  factory?: BrandingStoreFactory;
}) {
  const { activeFarm } = useAuth();
  const farmId = activeFarm?.id ?? 'none';
  const store = useMemo(() => factory(`werf-branding:${farmId}`), [factory, farmId]);
  useCloseCaptureStore(store);
  return <BrandingStoreContext.Provider value={store}>{children}</BrandingStoreContext.Provider>;
}

function useBrandingStore(): BrandingStore {
  const store = useContext(BrandingStoreContext);
  if (!store) throw new Error('useBrandingStore must be used inside a LocalBrandingProvider');
  return store;
}

/** Pending rows from this device only — this is the upload queue's source. */
export function useBrandingRegisters(): readonly StoredBrandingRegister[] {
  const store = useBrandingStore();
  return useSyncExternalStore(store.subscribe, store.all);
}

/** Every mark this device knows, without double-counting a local row after its hydrated echo. */
export function useEffectiveBrandingRegisters(): readonly StoredBrandingRegister[] {
  const local = useBrandingRegisters();
  const hydrated = useHydratedBrandingRegisters();
  return useMemo(() => mergeById(local, hydrated), [local, hydrated]);
}

export function useBrandingRegistersSettled(): boolean {
  const store = useBrandingStore();
  return useSyncExternalStore(store.subscribe, store.settled);
}

export function useBrandingRegistersHydrationFailed(): boolean {
  const store = useBrandingStore();
  return useSyncExternalStore(store.subscribe, store.hydrationFailed);
}

/** Commits locally and never waits on a connection. */
export function useRecordBrandingRegister(): (register: StoredBrandingRegister) => Promise<void> {
  const store = useBrandingStore();
  return useCallback((register) => store.append(register), [store]);
}
