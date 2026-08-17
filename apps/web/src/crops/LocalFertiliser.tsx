/**
 * The local fertiliser-application log (FR-206) — this device's own captured applications, read and
 * written through the `@werf/sync` capture-store adapter, never a storage API directly (ADR-0003).
 * Same family as `LocalPlantings.tsx`: append-only captured facts, reactive, farm-scoped by key.
 *
 * Unlike a planting, there is no "current" projection here — a fertiliser application has no
 * ongoing state a screen reads back ("currently planted"/"currently walked"); it is purely a log a
 * farmer and an auditor read as history. `latestFertiliserFor` below exists only to show "last
 * applied" on the land list, not to answer a compliance or safety question.
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
import { ancestorChainOf, recordFertiliser, type FertiliserRate } from '@werf/domain';
import { useAuth } from '../auth/AuthProvider';
import { getLocalDatabase } from '../sync/local-db';
import { useCloseCaptureStore } from '../sync/useCloseCaptureStore';
import { mergeById } from '../livestock/HydratedLivestock';
import { useEffectiveLandUnits } from '../land/LocalLand';
import { useHydratedFertiliser } from './HydratedFertiliser';

export type FertiliserMethod = 'broadcast' | 'band' | 'fertigation' | 'foliar';

/** A fertiliser application as held locally. `occurredAt` is an ISO STRING for the same reason
 *  every capture store here keeps instants as strings (see `LocalPlantings.tsx`). */
export interface StoredFertiliser {
  readonly id: string;
  readonly farmId: string;
  readonly landUnitId: string;
  readonly occurredAt: string;
  readonly product: string;
  readonly method: FertiliserMethod;
  readonly rate?: FertiliserRate;
  readonly operator?: string;
}

export type FertiliserStore = CaptureStore<StoredFertiliser>;
export type FertiliserStoreFactory = (key: string) => FertiliserStore;

const defaultFactory: FertiliserStoreFactory = (key) =>
  createSqliteCaptureStore<StoredFertiliser>({
    database: getLocalDatabase,
    key,
    legacyStorage: window.localStorage,
  });

const FertiliserStoreContext = createContext<FertiliserStore | null>(null);

export interface LocalFertiliserProviderProps {
  children: ReactNode;
  factory?: FertiliserStoreFactory;
}

export function LocalFertiliserProvider({
  children,
  factory = defaultFactory,
}: LocalFertiliserProviderProps) {
  const { activeFarm } = useAuth();
  const farmId = activeFarm?.id ?? 'none';
  const store = useMemo(() => factory(`werf-fertiliser:${farmId}`), [factory, farmId]);
  useCloseCaptureStore(store);

  return (
    <FertiliserStoreContext.Provider value={store}>{children}</FertiliserStoreContext.Provider>
  );
}

function useFertiliserStore(): FertiliserStore {
  const store = useContext(FertiliserStoreContext);
  if (!store) throw new Error('useFertiliserStore must be used inside a LocalFertiliserProvider');
  return store;
}

/** This device's own fertiliser applications, reactive. */
export function useFertiliserApplications(): readonly StoredFertiliser[] {
  const store = useFertiliserStore();
  return useSyncExternalStore(store.subscribe, store.all);
}

/** Whether this store's initial hydration attempt is over — the Outbox flush must not act on
 *  `useFertiliserApplications()` until this is true. */
export function useFertiliserSettled(): boolean {
  const store = useFertiliserStore();
  return useSyncExternalStore(store.subscribe, store.settled);
}

/** Whether this store's hydration ATTEMPT ended in a genuine failure — the Outbox flush must hold,
 *  not treat `useFertiliserApplications()` as confirmed empty, when this is true. */
export function useFertiliserHydrationFailed(): boolean {
  const store = useFertiliserStore();
  return useSyncExternalStore(store.subscribe, store.hydrationFailed);
}

/**
 * Commit a fertiliser application to the local log. Synchronous; never awaits the network
 * (NFR-007). Validated through the domain rule first — a product and a method, on a real block —
 * so a bad capture throws here rather than entering the append-only log. The returned promise
 * resolves once the write is durably persisted — await it before reporting "Saved" (P1.1).
 */
export function useRecordFertiliser(): (application: {
  readonly id: string;
  readonly farmId: string;
  readonly landUnitId: string;
  readonly occurredAt: Date;
  readonly product: string;
  readonly method: FertiliserMethod;
  readonly rate?: FertiliserRate;
  readonly operator?: string;
}) => Promise<void> {
  const store = useFertiliserStore();
  return useCallback(
    (application) => {
      recordFertiliser({
        id: application.id,
        farmId: application.farmId,
        landUnitId: application.landUnitId,
        occurredAt: application.occurredAt,
        product: application.product,
        method: application.method,
        ...(application.rate === undefined ? {} : { rate: application.rate }),
        ...(application.operator === undefined ? {} : { operator: application.operator }),
      });
      return store.append({
        id: application.id,
        farmId: application.farmId,
        landUnitId: application.landUnitId,
        occurredAt: application.occurredAt.toISOString(),
        product: application.product,
        method: application.method,
        ...(application.rate === undefined ? {} : { rate: application.rate }),
        ...(application.operator === undefined ? {} : { operator: application.operator }),
      });
    },
    [store],
  );
}

/**
 * This device's own applications, MERGED with applications another device sent and the server has
 * already replicated down (the land-hydration pattern, applied to this store — see
 * `LocalPlantings.tsx`'s `useEffectivePlantings` for the identical shape and reasoning).
 */
export function useEffectiveFertiliserApplications(): readonly StoredFertiliser[] {
  const applications = useFertiliserApplications();
  const hydrated = useHydratedFertiliser();
  return useMemo(() => mergeById(applications, hydrated), [applications, hydrated]);
}

/**
 * The most recent fertiliser application on a block, as this device sees it — display only, never
 * a safety or compliance dependency (see the module note). Walks `parent_id` via `ancestorChainOf`
 * UNBOUNDED, the same choice `useCurrentPlanting` makes and for the identical reason: a split
 * closes nothing, so a block split off another still carries what was last applied to the ground it
 * came from.
 */
export function useLatestFertiliser(landUnitId: string): StoredFertiliser | undefined {
  const applications = useEffectiveFertiliserApplications();
  const units = useEffectiveLandUnits();
  return useMemo(
    () => latestFertiliserFor(applications, ancestorChainOf(landUnitId, units)),
    [applications, units, landUnitId],
  );
}

/** The latest application across a set of land units (a block and, per FR-202, its ancestors) by
 *  the total order, or undefined when none of them has ever had one. */
export function latestFertiliserFor(
  applications: readonly StoredFertiliser[],
  landUnitIds: readonly string[],
): StoredFertiliser | undefined {
  const ids = new Set(landUnitIds);
  let latest: StoredFertiliser | undefined;
  for (const application of applications) {
    if (!ids.has(application.landUnitId)) continue;
    if (latest === undefined || isLater(application, latest)) latest = application;
  }
  return latest;
}

function isLater(candidate: StoredFertiliser, incumbent: StoredFertiliser): boolean {
  if (candidate.occurredAt !== incumbent.occurredAt) {
    return candidate.occurredAt > incumbent.occurredAt;
  }
  return candidate.id > incumbent.id;
}
