/**
 * The local mob-move log (FR-151) — where a GROUP has been walked, as the device holds it.
 *
 * A sibling of `LocalMoves.tsx`, not an extension of it: a mob move has one subject (the mob) and
 * one dimension (the camp), never the animal/mob pair an individual walk carries, and giving it its
 * own store keeps `StoredMove`'s shape from growing a case that does not apply to it. Append-only,
 * destination-only, for the identical reason `LocalMoves.tsx` documents — the mob already knows
 * where it is, so the "from" side is never captured here.
 *
 * `occurredAt` is an ISO string, since the event envelope's Date does not round-trip localStorage
 * across a cold start; that conversion lives at this boundary, as it does for every other log.
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
import { useAuth } from '../auth/AuthProvider';
import { getLocalDatabase } from '../sync/local-db';
import { useCloseCaptureStore } from '../sync/useCloseCaptureStore';

/** A mob's walk, as held locally. */
export interface StoredMobMove {
  readonly id: string;
  readonly farmId: string;
  readonly mobId: string;
  /** ISO 8601. When the mob was walked, on the farm. */
  readonly occurredAt: string;
  /** Destination camp. A real target — `null` takes the mob off a mapped camp. */
  readonly toLandUnitId: string | null;
  /**
   * The camp the mob was in immediately BEFORE this move — present ONLY on a hydrated move
   * (`HydratedLivestock.tsx`'s `mapHydratedMobMove`, reading `events.payload`'s own
   * `fromLandUnitId`). A LOCAL capture never carries this: the server derives the FROM side from
   * the mob's own row at write time (`movement.ts`'s `recordMobMove`), so a local `StoredMobMove`
   * genuinely does not know its own origin.
   */
  readonly fromLandUnitId?: string | null;
}

export type MobMoveStore = CaptureStore<StoredMobMove>;
export type MobMoveStoreFactory = (key: string) => MobMoveStore;

const defaultFactory: MobMoveStoreFactory = (key) =>
  createSqliteCaptureStore<StoredMobMove>({
    database: getLocalDatabase,
    key,
    legacyStorage: window.localStorage,
  });

const MobMoveStoreContext = createContext<MobMoveStore | null>(null);

export interface LocalMobMovesProviderProps {
  children: ReactNode;
  factory?: MobMoveStoreFactory;
}

export function LocalMobMovesProvider({
  children,
  factory = defaultFactory,
}: LocalMobMovesProviderProps) {
  const { activeFarm } = useAuth();
  const farmId = activeFarm?.id ?? 'none';
  const store = useMemo(() => factory(`werf-mob-moves:${farmId}`), [factory, farmId]);
  useCloseCaptureStore(store);

  return <MobMoveStoreContext.Provider value={store}>{children}</MobMoveStoreContext.Provider>;
}

function useMobMoveStore(): MobMoveStore {
  const store = useContext(MobMoveStoreContext);
  if (!store) throw new Error('useMobMoveStore must be used inside a LocalMobMovesProvider');
  return store;
}

/** Every mob move, reactive: this re-renders when one is captured. */
export function useMobMoves(): readonly StoredMobMove[] {
  const store = useMobMoveStore();
  return useSyncExternalStore(store.subscribe, store.all);
}

/** Whether this store's initial hydration attempt is over (`CaptureStore.settled()`) — the
 *  Outbox flush must not act on `useMobMoves()` until this is true. */
export function useMobMovesSettled(): boolean {
  const store = useMobMoveStore();
  return useSyncExternalStore(store.subscribe, store.settled);
}

/** Whether this store's hydration ATTEMPT ended in a genuine failure
 *  (`CaptureStore.hydrationFailed()`) — the Outbox flush must hold, not treat `useMobMoves()` as
 *  confirmed empty, when this is true. */
export function useMobMovesHydrationFailed(): boolean {
  const store = useMobMoveStore();
  return useSyncExternalStore(store.subscribe, store.hydrationFailed);
}

/** Record a walk for a mob. Synchronous; never awaits the network (NFR-007). */
export function useRecordMobMove(): (move: StoredMobMove) => Promise<void> {
  const store = useMobMoveStore();
  return useCallback((move) => store.append(move), [store]);
}
