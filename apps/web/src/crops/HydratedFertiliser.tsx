/**
 * The down-sync half of fertiliser applications (FR-206) — applications another device recorded,
 * already replicated to THIS device via PowerSync — read through the `@werf/sync` adapter, never
 * the SDK directly (ADR-0003). Same family as `HydratedCrops.tsx`: a second, independent read of
 * the canonical `events` table PowerSync down-syncs into, farm-scoped so a multi-farm account's
 * other farms never leak in (Sync Streams are per-user, not per-farm).
 *
 * Deliberately NOT a widening of `LocalFertiliser`, for the identical reason `HydratedCrops.tsx`
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
import type { StoredFertiliser } from './LocalFertiliser';

// `type = 'fertiliser'` narrows the shared `events` table to exactly the rows this store folds.
const FERTILISER_EVENTS_SQL =
  'SELECT id, farm_id, land_unit_id, occurred_at, payload, inventory_lot_id FROM events ' +
  "WHERE farm_id = ? AND type = 'fertiliser' AND deleted_at IS NULL";

/** Tolerant per row — a row written by a future schema version this build does not understand is
 *  skipped, not fatal, same philosophy as `HydratedCrops.tsx`'s mapper. Exported for a direct unit
 *  test — see `HydratedSprays.tsx`'s identical note on `inventory_lot_id` (Phase 4e, FR-502). */
export function mapHydratedFertiliser(row: Record<string, unknown>): StoredFertiliser | null {
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

  const product = payload['product'];
  const method = payload['method'];
  if (typeof product !== 'string') return null;
  if (
    method !== 'broadcast' &&
    method !== 'band' &&
    method !== 'fertigation' &&
    method !== 'foliar'
  ) {
    return null;
  }

  const operator = typeof payload['operator'] === 'string' ? payload['operator'] : undefined;

  const rateRaw = payload['rate'];
  let rate: { value: number; unit: string } | undefined;
  if (typeof rateRaw === 'object' && rateRaw !== null) {
    const value = (rateRaw as { value?: unknown }).value;
    const unit = (rateRaw as { unit?: unknown }).unit;
    if (typeof value === 'number' && typeof unit === 'string') rate = { value, unit };
  }

  // A top-level event COLUMN (Phase 4e, FR-502), not a payload field — see `HydratedSprays.tsx`'s
  // identical note for why this must be selected explicitly, one compliance gate lighter.
  const inventoryLotId = row['inventory_lot_id'];

  return {
    id,
    farmId,
    landUnitId,
    occurredAt: occurredAtDate.toISOString(),
    product,
    method,
    ...(rate === undefined ? {} : { rate }),
    ...(operator === undefined ? {} : { operator }),
    ...(typeof inventoryLotId === 'string' ? { inventoryLotId } : {}),
  };
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

const HydratedFertiliserContext = createContext<HydratedTableStore<StoredFertiliser> | null>(null);

export function HydratedFertiliserProvider({ children }: { children: ReactNode }) {
  const { activeFarm } = useAuth();
  const farmId = activeFarm?.id ?? 'none';
  const [value, setValue] = useState<HydratedTableStore<StoredFertiliser>>(() =>
    emptyHydratedTableStore<StoredFertiliser>(),
  );

  // Construction lives INSIDE the effect, not a `useMemo` above it — `HydratedLivestock.tsx`'s
  // StrictMode finding applies identically here (see `HydratedCrops.tsx`'s identical comment).
  useEffect(() => {
    const store = createHydratedTableStore({
      database: getLocalDatabase(),
      sql: FERTILISER_EVENTS_SQL,
      params: [farmId],
      mapRow: mapHydratedFertiliser,
    });
    setValue(store);
    return () => store.close();
  }, [farmId]);

  return (
    <HydratedFertiliserContext.Provider value={value}>
      {children}
    </HydratedFertiliserContext.Provider>
  );
}

function useHydratedFertiliserStore(): HydratedTableStore<StoredFertiliser> {
  const ctx = useContext(HydratedFertiliserContext);
  if (!ctx) throw new Error('useHydrated* must be used inside a HydratedFertiliserProvider');
  return ctx;
}

/** Fertiliser applications another device recorded and the server has replicated to this one. */
export function useHydratedFertiliser(): readonly StoredFertiliser[] {
  const store = useHydratedFertiliserStore();
  return useSyncExternalStore(store.subscribe, store.all);
}

export function useHydratedFertiliserSettled(): boolean {
  const store = useHydratedFertiliserStore();
  return useSyncExternalStore(store.subscribe, store.settled);
}

export function useHydratedFertiliserHydrationFailed(): boolean {
  const store = useHydratedFertiliserStore();
  return useSyncExternalStore(store.subscribe, store.hydrationFailed);
}
