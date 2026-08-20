/**
 * The down-sync half of harvests (FR-207) — harvests another device recorded, already replicated to
 * THIS device via PowerSync — read through the `@werf/sync` adapter, never the SDK directly
 * (ADR-0003). Same family as `HydratedFertiliser.tsx`/`HydratedSprays.tsx`: a second, independent
 * read of the canonical `events` table PowerSync down-syncs into, farm-scoped so a multi-farm
 * account's other farms never leak in (Sync Streams are per-user, not per-farm).
 *
 * Deliberately NOT a widening of `LocalHarvest`, for the identical reason `HydratedFertiliser.tsx`
 * documents: a hydrated row must never look like a pending local capture, or a device would re-POST
 * another device's already-landed work.
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
import type { StoredHarvest } from './LocalHarvest';

// `type = 'harvest'` narrows the shared `events` table to exactly the rows this store folds.
const HARVEST_EVENTS_SQL =
  'SELECT id, farm_id, land_unit_id, occurred_at, payload FROM events ' +
  "WHERE farm_id = ? AND type = 'harvest' AND deleted_at IS NULL";

/** Tolerant per row — a row written by a future schema version this build does not understand is
 *  skipped, not fatal, same philosophy as `HydratedFertiliser.tsx`'s mapper. */
function mapHydratedHarvest(row: Record<string, unknown>): StoredHarvest | null {
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

  const harvestedOn = payload['harvestedOn'];
  const quantity = payload['quantity'];
  const unit = payload['unit'];
  if (typeof harvestedOn !== 'string' || typeof quantity !== 'number' || typeof unit !== 'string') {
    return null;
  }

  const str = (key: string): string | undefined =>
    typeof payload[key] === 'string' ? (payload[key] as string) : undefined;

  const overrideRaw = payload['phiOverride'];
  let phiOverride: { reason: string; by: string } | undefined;
  if (typeof overrideRaw === 'object' && overrideRaw !== null) {
    const reason = (overrideRaw as { reason?: unknown }).reason;
    const by = (overrideRaw as { by?: unknown }).by;
    if (typeof reason === 'string' && typeof by === 'string') phiOverride = { reason, by };
  }

  return {
    id,
    farmId,
    landUnitId,
    occurredAt: occurredAtDate.toISOString(),
    harvestedOn,
    quantity,
    unit,
    ...(str('grade') === undefined ? {} : { grade: str('grade') }),
    ...(str('destination') === undefined ? {} : { destination: str('destination') }),
    ...(phiOverride === undefined ? {} : { phiOverride }),
  } as StoredHarvest;
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

const HydratedHarvestContext = createContext<HydratedTableStore<StoredHarvest> | null>(null);

export function HydratedHarvestProvider({ children }: { children: ReactNode }) {
  const { activeFarm } = useAuth();
  const farmId = activeFarm?.id ?? 'none';
  const [value, setValue] = useState<HydratedTableStore<StoredHarvest>>(() =>
    emptyHydratedTableStore<StoredHarvest>(),
  );

  // Construction lives INSIDE the effect, not a `useMemo` above it — `HydratedLivestock.tsx`'s
  // StrictMode finding applies identically here (see `HydratedFertiliser.tsx`'s identical comment).
  useEffect(() => {
    const store = createHydratedTableStore({
      database: getLocalDatabase(),
      sql: HARVEST_EVENTS_SQL,
      params: [farmId],
      mapRow: mapHydratedHarvest,
    });
    setValue(store);
    return () => store.close();
  }, [farmId]);

  return (
    <HydratedHarvestContext.Provider value={value}>{children}</HydratedHarvestContext.Provider>
  );
}

function useHydratedHarvestStore(): HydratedTableStore<StoredHarvest> {
  const ctx = useContext(HydratedHarvestContext);
  if (!ctx) throw new Error('useHydrated* must be used inside a HydratedHarvestProvider');
  return ctx;
}

/** Harvests another device recorded and the server has replicated to this one. */
export function useHydratedHarvests(): readonly StoredHarvest[] {
  const store = useHydratedHarvestStore();
  return useSyncExternalStore(store.subscribe, store.all);
}

export function useHydratedHarvestsSettled(): boolean {
  const store = useHydratedHarvestStore();
  return useSyncExternalStore(store.subscribe, store.settled);
}

export function useHydratedHarvestsHydrationFailed(): boolean {
  const store = useHydratedHarvestStore();
  return useSyncExternalStore(store.subscribe, store.hydrationFailed);
}
