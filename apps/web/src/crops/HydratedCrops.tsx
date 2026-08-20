/**
 * The down-sync half of crops (FR-203) — plantings another device recorded, already replicated to
 * THIS device via PowerSync — read through the `@werf/sync` adapter, never the SDK directly
 * (ADR-0003). Same family as `land/HydratedLand.tsx`: a second, independent read of the canonical
 * `events` table PowerSync down-syncs into, farm-scoped so a multi-farm account's other farms never
 * leak in (Sync Streams are per-user, not per-farm).
 *
 * ⭐ Deliberately NOT a widening of `LocalPlantings`. That store holds what THIS DEVICE captured, in
 * the local-only `capture_records` table, and `Outbox.tsx`'s upload QUEUE reads it unchanged — a
 * hydrated row must never look like a pending local capture, or a device would re-POST another
 * device's already-landed work. `LocalPlantings.tsx`'s `useEffectivePlantings` merges the two
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
import { useAuth } from '../auth/AuthProvider';
import { getLocalDatabase } from '../sync/local-db';
import type { StoredPlanting } from './LocalPlantings';

// `type = 'planting'` narrows the shared `events` table to exactly the rows `latestPlantingFor`
// folds — every other event type is invisible to this query by construction.
const PLANTING_EVENTS_SQL =
  'SELECT id, farm_id, land_unit_id, occurred_at, payload FROM events ' +
  "WHERE farm_id = ? AND type = 'planting' AND deleted_at IS NULL";

/** Tolerant per row — a row written by a future schema version this build does not understand is
 *  skipped, not fatal, same philosophy as `HydratedLand.tsx`'s mappers. */
function mapHydratedPlanting(row: Record<string, unknown>): StoredPlanting | null {
  const id = row['id'];
  const farmId = row['farm_id'];
  const landUnitId = row['land_unit_id'];
  const occurredAtRaw = row['occurred_at'];
  const payloadJson = row['payload'];
  if (
    typeof id !== 'string' ||
    typeof farmId !== 'string' ||
    typeof landUnitId !== 'string' ||
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

  const crop = payload['crop'];
  if (typeof crop !== 'string') return null;

  const str = (key: string): string | undefined =>
    typeof payload[key] === 'string' ? (payload[key] as string) : undefined;

  const densityRaw = payload['density'];
  let density: { value: number; unit: string } | undefined;
  if (typeof densityRaw === 'object' && densityRaw !== null) {
    const value = (densityRaw as { value?: unknown }).value;
    const unit = (densityRaw as { unit?: unknown }).unit;
    if (typeof value === 'number' && typeof unit === 'string') density = { value, unit };
  }

  return {
    id,
    farmId,
    landUnitId,
    occurredAt: occurredAtDate.toISOString(),
    crop,
    ...(str('cultivar') === undefined ? {} : { cultivar: str('cultivar') }),
    ...(density === undefined ? {} : { density }),
    ...(str('seedSource') === undefined ? {} : { seedSource: str('seedSource') }),
    ...(str('expectedHarvestDate') === undefined
      ? {}
      : { expectedHarvestDate: str('expectedHarvestDate') }),
  } as StoredPlanting;
}

/** Permanently unsettled, no subscription to close — see `HydratedLivestock.tsx`'s identical helper
 *  for the full StrictMode rationale. */
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

const HydratedCropsContext = createContext<HydratedTableStore<StoredPlanting> | null>(null);

export function HydratedCropsProvider({ children }: { children: ReactNode }) {
  const { activeFarm } = useAuth();
  const farmId = activeFarm?.id ?? 'none';
  const [value, setValue] = useState<HydratedTableStore<StoredPlanting>>(() =>
    emptyHydratedTableStore<StoredPlanting>(),
  );

  // Construction lives INSIDE the effect, not a `useMemo` above it — `HydratedLivestock.tsx`'s
  // StrictMode finding applies identically here: a memoized store closed by the cleanup and never
  // rebuilt dies permanently on React 18's synthetic double-invoke in `pnpm dev`.
  useEffect(() => {
    const store = createHydratedTableStore({
      database: getLocalDatabase(),
      sql: PLANTING_EVENTS_SQL,
      params: [farmId],
      mapRow: mapHydratedPlanting,
    });
    setValue(store);
    return () => store.close();
  }, [farmId]);

  return <HydratedCropsContext.Provider value={value}>{children}</HydratedCropsContext.Provider>;
}

function useHydratedCrops(): HydratedTableStore<StoredPlanting> {
  const ctx = useContext(HydratedCropsContext);
  if (!ctx) throw new Error('useHydrated* must be used inside a HydratedCropsProvider');
  return ctx;
}

/** Plantings another device recorded and the server has replicated to this one. */
export function useHydratedPlantings(): readonly StoredPlanting[] {
  const store = useHydratedCrops();
  return useSyncExternalStore(store.subscribe, store.all);
}

export function useHydratedPlantingsSettled(): boolean {
  const store = useHydratedCrops();
  return useSyncExternalStore(store.subscribe, store.settled);
}

export function useHydratedPlantingsHydrationFailed(): boolean {
  const store = useHydratedCrops();
  return useSyncExternalStore(store.subscribe, store.hydrationFailed);
}
