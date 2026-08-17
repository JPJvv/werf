/**
 * The local planting log (FR-203) — this device's own captured plantings, read and written through
 * the `@werf/sync` capture-store adapter, never a storage API directly (ADR-0003). Same family as
 * `LocalRainfall`/`LocalLand`'s boundary-walk half: append-only captured facts, reactive, farm-
 * scoped by key.
 *
 * First store under `crops/` — Phase 4's own domain area, the way `land/` and `livestock/` are
 * theirs. A planting references a block (`landUnitId`), but it is a CROP fact, not a land-
 * infrastructure one — the same split `LocalRainfall` already draws from `LocalLand`, for the same
 * reason: rain is a farm fact carried on land, and this is a crop fact carried on land.
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
import { ancestorChainOf, recordPlanting } from '@werf/domain';
import { useAuth } from '../auth/AuthProvider';
import { getLocalDatabase } from '../sync/local-db';
import { useCloseCaptureStore } from '../sync/useCloseCaptureStore';
import { mergeById } from '../livestock/HydratedLivestock';
import { useEffectiveLandUnits } from '../land/LocalLand';
import { useHydratedPlantings } from './HydratedCrops';

/**
 * A planting as held locally. `occurredAt` is an ISO STRING, not a Date, for the same reason every
 * capture store in this app keeps instants as strings: `timestampSchema` parses a string INTO a
 * Date, and JSON has no Date to round-trip through `localStorage`/SQLite on a cold start.
 */
export interface StoredPlanting {
  readonly id: string;
  readonly farmId: string;
  readonly landUnitId: string;
  readonly occurredAt: string;
  readonly crop: string;
  readonly cultivar?: string;
  readonly density?: { readonly value: number; readonly unit: string };
  readonly seedSource?: string;
  readonly expectedHarvestDate?: string;
}

export type PlantingStore = CaptureStore<StoredPlanting>;

/** Injectable so tests can back the log with in-memory storage instead of localStorage. */
export type PlantingStoreFactory = (key: string) => PlantingStore;

const defaultFactory: PlantingStoreFactory = (key) =>
  createSqliteCaptureStore<StoredPlanting>({
    database: getLocalDatabase,
    key,
    legacyStorage: window.localStorage,
  });

const PlantingStoreContext = createContext<PlantingStore | null>(null);

export interface LocalPlantingsProviderProps {
  children: ReactNode;
  factory?: PlantingStoreFactory;
}

export function LocalPlantingsProvider({
  children,
  factory = defaultFactory,
}: LocalPlantingsProviderProps) {
  const { activeFarm } = useAuth();
  const farmId = activeFarm?.id ?? 'none';
  const store = useMemo(() => factory(`werf-plantings:${farmId}`), [factory, farmId]);
  useCloseCaptureStore(store);

  return <PlantingStoreContext.Provider value={store}>{children}</PlantingStoreContext.Provider>;
}

function usePlantingStore(): PlantingStore {
  const store = useContext(PlantingStoreContext);
  if (!store) throw new Error('usePlantingStore must be used inside a LocalPlantingsProvider');
  return store;
}

/** This device's own plantings, reactive: this re-renders when one is captured. */
export function usePlantings(): readonly StoredPlanting[] {
  const store = usePlantingStore();
  return useSyncExternalStore(store.subscribe, store.all);
}

/** Whether this store's initial hydration attempt is over (`CaptureStore.settled()`) — the Outbox
 *  flush must not act on `usePlantings()` until this is true. */
export function usePlantingsSettled(): boolean {
  const store = usePlantingStore();
  return useSyncExternalStore(store.subscribe, store.settled);
}

/** Whether this store's hydration ATTEMPT ended in a genuine failure
 *  (`CaptureStore.hydrationFailed()`) — the Outbox flush must hold, not treat `usePlantings()` as
 *  confirmed empty, when this is true. */
export function usePlantingsHydrationFailed(): boolean {
  const store = usePlantingStore();
  return useSyncExternalStore(store.subscribe, store.hydrationFailed);
}

/**
 * Commit a planting to the local log. Synchronous; never awaits the network (NFR-007). The capture
 * is validated through the domain rule first — at least a crop, sown in a real block — so a bad
 * capture throws here rather than entering the append-only log; only then is the JSON-safe
 * projection persisted. The returned promise resolves once the write is durably persisted — await
 * it before reporting "Saved" (P1.1).
 */
export function useRecordPlanting(): (planting: {
  readonly id: string;
  readonly farmId: string;
  readonly landUnitId: string;
  readonly occurredAt: Date;
  readonly crop: string;
  readonly cultivar?: string;
  readonly density?: { readonly value: number; readonly unit: string };
  readonly seedSource?: string;
  readonly expectedHarvestDate?: string;
}) => Promise<void> {
  const store = usePlantingStore();
  return useCallback(
    (planting) => {
      recordPlanting({
        id: planting.id,
        farmId: planting.farmId,
        landUnitId: planting.landUnitId,
        occurredAt: planting.occurredAt,
        crop: planting.crop,
        ...(planting.cultivar === undefined ? {} : { cultivar: planting.cultivar }),
        ...(planting.density === undefined ? {} : { density: planting.density }),
        ...(planting.seedSource === undefined ? {} : { seedSource: planting.seedSource }),
        ...(planting.expectedHarvestDate === undefined
          ? {}
          : { expectedHarvestDate: planting.expectedHarvestDate }),
      });
      return store.append({
        id: planting.id,
        farmId: planting.farmId,
        landUnitId: planting.landUnitId,
        occurredAt: planting.occurredAt.toISOString(),
        crop: planting.crop,
        ...(planting.cultivar === undefined ? {} : { cultivar: planting.cultivar }),
        ...(planting.density === undefined ? {} : { density: planting.density }),
        ...(planting.seedSource === undefined ? {} : { seedSource: planting.seedSource }),
        ...(planting.expectedHarvestDate === undefined
          ? {}
          : { expectedHarvestDate: planting.expectedHarvestDate }),
      });
    },
    [store],
  );
}

/**
 * This device's own plantings, MERGED with plantings another device sent and the server has already
 * replicated down (the land-hydration pattern, phase-checklists.md 3e, applied to this store).
 * Without this, a planting nobody on THIS device ever captured would not appear at all — invisible
 * on the land list. `mergeById` (local-wins): a hydrated planting's payload carries exactly the
 * fields a local one already does, no enrichment asymmetry a preference would buy anything for.
 */
export function useEffectivePlantings(): readonly StoredPlanting[] {
  const plantings = usePlantings();
  const hydrated = useHydratedPlantings();
  return useMemo(() => mergeById(plantings, hydrated), [plantings, hydrated]);
}

/**
 * The planting a block currently reads as "in the ground", as this device sees it.
 *
 * ⭐ ORDERED BY `(occurredAt, id)`, the same total order `LocalLand.tsx`'s `latestWalkFor` uses for a
 * boundary — never by `occurredAt` alone, because two plantings of one block can tie on the same day
 * by construction, and a tie left to array order resolves to arrival order rather than to what
 * happened. This is a UX/reporting decision, not a safety one (see `@werf/domain/crops/planting.ts`'s
 * module note) — the PHI guard (4d) will read a block's SPRAY history directly and never asks this
 * question.
 *
 * Reads `useEffectivePlantings` (local+hydrated merged), so a planting another device recorded is
 * not invisible here.
 *
 * ⭐ FR-202 (split, 4a·2): also walks `parent_id` via `@werf/domain`'s `ancestorChainOf`, UNBOUNDED —
 * a block split off another still carries whatever was last planted on the ground it came from,
 * because the split closes nothing (`land/split`'s own module note). See `ancestry.ts`'s header for
 * why this projection is unbounded while the future PHI guard's ancestor walk (4d·4) will not be.
 */
export function useCurrentPlanting(landUnitId: string): StoredPlanting | undefined {
  const plantings = useEffectivePlantings();
  const units = useEffectiveLandUnits();
  return useMemo(
    () => latestPlantingFor(plantings, ancestorChainOf(landUnitId, units)),
    [plantings, units, landUnitId],
  );
}

/** The latest planting across a set of land units (a block and, per FR-202, its ancestors) by the
 *  total order, or undefined when none of them has ever been planted. */
export function latestPlantingFor(
  plantings: readonly StoredPlanting[],
  landUnitIds: readonly string[],
): StoredPlanting | undefined {
  const ids = new Set(landUnitIds);
  let latest: StoredPlanting | undefined;
  for (const planting of plantings) {
    if (!ids.has(planting.landUnitId)) continue;
    if (latest === undefined || isLater(planting, latest)) latest = planting;
  }
  return latest;
}

function isLater(candidate: StoredPlanting, incumbent: StoredPlanting): boolean {
  if (candidate.occurredAt !== incumbent.occurredAt) {
    return candidate.occurredAt > incumbent.occurredAt;
  }
  return candidate.id > incumbent.id;
}
