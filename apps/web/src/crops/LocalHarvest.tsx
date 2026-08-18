/**
 * The local harvest log (FR-207) — this device's own captured harvests, read and written through
 * the `@werf/sync` capture-store adapter, never a storage API directly (ADR-0003). Same family as
 * `LocalPlantings.tsx`/`LocalFertiliser.tsx`, not `LocalSprays.tsx`: the event itself needs nothing
 * server-resolved to be BUILT, so `useRecordHarvest()` calls the `recordHarvest` domain builder
 * client-side — unlike a spray, whose PHI the client cannot compute at all.
 *
 * ⭐ `useEffectiveHarvests()` uses `mergeByIdPreferHydrated`, NOT plain `mergeById`, and this is the
 * one field that forces it: `phiOverride.by` (the acting user id) is never client-set — a LOCAL
 * override capture carries `phiOverride: { reason }` alone, and only the HYDRATED echo, once this
 * device's own harvest round-trips through the server, carries `by` too. Local-wins would
 * permanently shadow that enrichment the moment it arrives — the identical defect class
 * `HydratedLivestock.tsx`'s `mergeByIdPreferHydrated` docstring names for a move's `fromMobId`.
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
import { recordHarvest } from '@werf/domain';
import { useAuth } from '../auth/AuthProvider';
import { getLocalDatabase } from '../sync/local-db';
import { useCloseCaptureStore } from '../sync/useCloseCaptureStore';
import { mergeByIdPreferHydrated } from '../livestock/HydratedLivestock';
import { useHydratedHarvests } from './HydratedHarvest';

/** A harvest as held locally. `occurredAt` is an ISO STRING, not a Date, for the same reason every
 *  capture store in this app keeps instants as strings — see `LocalPlantings.tsx`'s identical note. */
export interface StoredHarvest {
  readonly id: string;
  readonly farmId: string;
  readonly landUnitId: string;
  readonly occurredAt: string;
  readonly harvestedOn: string;
  readonly quantity: number;
  readonly unit: string;
  readonly grade?: string;
  readonly destination?: string;
  /** A local capture that needed one carries `reason` alone — `by` arrives only once this device's
   *  own capture has round-tripped through the server (see the module note). */
  readonly phiOverride?: { readonly reason: string; readonly by?: string };
}

export type HarvestStore = CaptureStore<StoredHarvest>;

/** Injectable so tests can back the log with in-memory storage instead of localStorage. */
export type HarvestStoreFactory = (key: string) => HarvestStore;

const defaultFactory: HarvestStoreFactory = (key) =>
  createSqliteCaptureStore<StoredHarvest>({
    database: getLocalDatabase,
    key,
    legacyStorage: window.localStorage,
  });

const HarvestStoreContext = createContext<HarvestStore | null>(null);

export interface LocalHarvestProviderProps {
  children: ReactNode;
  factory?: HarvestStoreFactory;
}

export function LocalHarvestProvider({
  children,
  factory = defaultFactory,
}: LocalHarvestProviderProps) {
  const { activeFarm } = useAuth();
  const farmId = activeFarm?.id ?? 'none';
  const store = useMemo(() => factory(`werf-harvests:${farmId}`), [factory, farmId]);
  useCloseCaptureStore(store);

  return <HarvestStoreContext.Provider value={store}>{children}</HarvestStoreContext.Provider>;
}

function useHarvestStore(): HarvestStore {
  const store = useContext(HarvestStoreContext);
  if (!store) throw new Error('useHarvestStore must be used inside a LocalHarvestProvider');
  return store;
}

/** This device's own harvests, reactive: this re-renders when one is captured. */
export function useHarvests(): readonly StoredHarvest[] {
  const store = useHarvestStore();
  return useSyncExternalStore(store.subscribe, store.all);
}

/** Whether this store's initial hydration attempt is over (`CaptureStore.settled()`) — the Outbox
 *  flush must not act on `useHarvests()` until this is true. */
export function useHarvestsSettled(): boolean {
  const store = useHarvestStore();
  return useSyncExternalStore(store.subscribe, store.settled);
}

/** Whether this store's hydration ATTEMPT ended in a genuine failure
 *  (`CaptureStore.hydrationFailed()`) — the Outbox flush must hold, not treat `useHarvests()` as
 *  confirmed empty, when this is true. */
export function useHarvestsHydrationFailed(): boolean {
  const store = useHarvestStore();
  return useSyncExternalStore(store.subscribe, store.hydrationFailed);
}

/**
 * Commit a harvest to the local log. Synchronous; never awaits the network (NFR-007). The capture
 * is validated through the domain rule first — at least a quantity and a unit, on a real block — so
 * a bad capture throws here rather than entering the append-only log; only then is the JSON-safe
 * projection persisted. The returned promise resolves once the write is durably persisted — await
 * it before reporting "Saved" (P1.1).
 *
 * Does NOT run the PHI guard — that is the screen's job, BEFORE this is ever called, using
 * `phiGuardFor` (`@werf/domain`) over the local spray/product caches. This function only builds and
 * persists the event; a harvest already decided to be an override carries its reason in already.
 */
export function useRecordHarvest(): (harvest: {
  readonly id: string;
  readonly farmId: string;
  readonly landUnitId: string;
  readonly occurredAt: Date;
  readonly harvestedOn: string;
  readonly quantity: number;
  readonly unit: string;
  readonly grade?: string;
  readonly destination?: string;
  readonly phiOverride?: { readonly reason: string };
}) => Promise<void> {
  const store = useHarvestStore();
  return useCallback(
    (harvest) => {
      recordHarvest({
        id: harvest.id,
        farmId: harvest.farmId,
        landUnitId: harvest.landUnitId,
        occurredAt: harvest.occurredAt,
        harvestedOn: harvest.harvestedOn,
        quantity: harvest.quantity,
        unit: harvest.unit,
        ...(harvest.grade === undefined ? {} : { grade: harvest.grade }),
        ...(harvest.destination === undefined ? {} : { destination: harvest.destination }),
        ...(harvest.phiOverride === undefined ? {} : { phiOverride: harvest.phiOverride }),
      });
      return store.append({
        id: harvest.id,
        farmId: harvest.farmId,
        landUnitId: harvest.landUnitId,
        occurredAt: harvest.occurredAt.toISOString(),
        harvestedOn: harvest.harvestedOn,
        quantity: harvest.quantity,
        unit: harvest.unit,
        ...(harvest.grade === undefined ? {} : { grade: harvest.grade }),
        ...(harvest.destination === undefined ? {} : { destination: harvest.destination }),
        ...(harvest.phiOverride === undefined ? {} : { phiOverride: harvest.phiOverride }),
      });
    },
    [store],
  );
}

/**
 * This device's own harvests, MERGED with harvests another device sent and the server has already
 * replicated down — the land-hydration pattern (phase-checklists.md 3e) applied to this store.
 * `mergeByIdPreferHydrated`: see the module header for why plain `mergeById` would silently drop
 * `phiOverride.by` the moment this device's own override round-trips back down.
 */
export function useEffectiveHarvests(): readonly StoredHarvest[] {
  const harvests = useHarvests();
  const hydrated = useHydratedHarvests();
  return useMemo(() => mergeByIdPreferHydrated(harvests, hydrated), [harvests, hydrated]);
}
