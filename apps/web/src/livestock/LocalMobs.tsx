/**
 * The local mob register — the farm's flocks and groups as the device holds them, read and written
 * through the `@werf/sync` capture-store adapter, never a storage API directly (ADR-0003).
 *
 * A mob is the GROUP-ONLY model (FR-102): "Flock A: 300 head" is a complete record with no
 * individual animal rows behind it. It is a peer of `LocalHerd`, not a child of it — the summary
 * adds mob head to animal head to get the number a farmer would give if you asked how many they
 * have, and for most South African smallholders the mob is the whole answer.
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

/** What the register holds: mobs composed offline with a client UUIDv7 (the `new` shape). */
export type StoredMob = schemas.NewMob;
export type MobStore = CaptureStore<StoredMob>;

/** Injectable so tests can back the register with in-memory storage instead of localStorage. */
export type MobStoreFactory = (key: string) => MobStore;

const defaultFactory: MobStoreFactory = (key) =>
  createCaptureStore<StoredMob>({ storage: window.localStorage, key });

const MobStoreContext = createContext<MobStore | null>(null);

export interface LocalMobsProviderProps {
  children: ReactNode;
  factory?: MobStoreFactory;
}

export function LocalMobsProvider({ children, factory = defaultFactory }: LocalMobsProviderProps) {
  const { activeFarm } = useAuth();
  const farmId = activeFarm?.id ?? 'none';
  const store = useMemo(() => factory(`werf-mobs:${farmId}`), [factory, farmId]);

  return <MobStoreContext.Provider value={store}>{children}</MobStoreContext.Provider>;
}

function useMobStore(): MobStore {
  const store = useContext(MobStoreContext);
  if (!store) throw new Error('useMobStore must be used inside a LocalMobsProvider');
  return store;
}

/** The farm's mobs, reactive: this re-renders when one is captured. */
export function useMobs(): readonly StoredMob[] {
  const store = useMobStore();
  return useSyncExternalStore(store.subscribe, store.all);
}

/** Commit a mob to the local register. Synchronous; never awaits the network (NFR-007). */
export function useRecordMob(): (mob: StoredMob) => void {
  const store = useMobStore();
  return useCallback((mob) => store.append(mob), [store]);
}
