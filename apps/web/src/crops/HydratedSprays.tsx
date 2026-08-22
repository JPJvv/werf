/** Down-synced farmer-owned spray records, including their captured product snapshots. */

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
import type { StoredSpray } from './LocalSprays';

const SPRAY_EVENTS_SQL =
  'SELECT id, farm_id, land_unit_id, occurred_at, payload, inventory_lot_id FROM events ' +
  "WHERE farm_id = ? AND type = 'spray' AND deleted_at IS NULL";

/** Tolerant per row — a row written by a future schema version this build does not understand is
 *  skipped, not fatal, same philosophy as `HydratedFertiliser.tsx`'s mapper. Exported for a direct
 *  unit test (Phase 4e, FR-502): `inventory_lot_id` is a top-level event COLUMN, easy to leave out
 *  of the `SELECT` and silently drop the moment this device's own capture round-trips down
 *  (`mergeByIdPreferHydrated` — hydrated wins). */
export function mapHydratedSpray(row: Record<string, unknown>): StoredSpray | null {
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

  const productId = payload['productId'];
  const productName = payload['productName'];
  const sprayedOn = payload['sprayedOn'];
  const activeIngredientsRaw = payload['activeIngredients'];
  if (
    typeof productId !== 'string' ||
    (productName !== undefined && typeof productName !== 'string') ||
    typeof sprayedOn !== 'string' ||
    (activeIngredientsRaw !== undefined && !Array.isArray(activeIngredientsRaw))
  ) {
    return null;
  }
  const activeIngredients = Array.isArray(activeIngredientsRaw)
    ? activeIngredientsRaw.filter((v): v is string => typeof v === 'string')
    : undefined;

  const num = (key: string): number | undefined =>
    typeof payload[key] === 'number' ? (payload[key] as number) : undefined;
  const str = (key: string): string | undefined =>
    typeof payload[key] === 'string' ? (payload[key] as string) : undefined;

  const overrideRaw = payload['phiOverride'];
  let phiOverride: { reason: string; by: string } | undefined;
  if (typeof overrideRaw === 'object' && overrideRaw !== null) {
    const reason = (overrideRaw as { reason?: unknown }).reason;
    const by = (overrideRaw as { by?: unknown }).by;
    if (typeof reason === 'string' && typeof by === 'string') phiOverride = { reason, by };
  }

  // A top-level event COLUMN (Phase 4e, FR-502), not a payload field — omitted, not queried, until
  // now: `useEffectiveSprays`'s `mergeByIdPreferHydrated` merge means the hydrated copy is what
  // this device reads once its own capture round-trips, so a column missing here silently drops the
  // field the moment that happens (the "exists everywhere except where it's read" class).
  const inventoryLotId = row['inventory_lot_id'];

  return {
    id,
    farmId,
    landUnitId,
    occurredAt: occurredAtDate.toISOString(),
    sprayedOn,
    productId,
    // Old Phase 4 events did not snapshot the name. Keep them visible and allow the screen to use
    // a matching farm product when one exists; never drop the farmer's history over this upgrade.
    productName: typeof productName === 'string' ? productName : '',
    ...(str('registrationNumber') === undefined
      ? {}
      : { registrationNumber: str('registrationNumber') }),
    ...(activeIngredients === undefined ? {} : { activeIngredients }),
    ...(num('rateLPerHa') === undefined ? {} : { rateLPerHa: num('rateLPerHa') }),
    ...(num('waterLPerHa') === undefined ? {} : { waterLPerHa: num('waterLPerHa') }),
    ...(str('operator') === undefined ? {} : { operator: str('operator') }),
    ...(str('equipment') === undefined ? {} : { equipment: str('equipment') }),
    ...(num('windKph') === undefined ? {} : { windKph: num('windKph') }),
    ...(num('tempC') === undefined ? {} : { tempC: num('tempC') }),
    ...(str('targetPest') === undefined ? {} : { targetPest: str('targetPest') }),
    ...(num('phiDays') === undefined ? {} : { phiDays: num('phiDays') }),
    ...(str('earliestHarvestDate') === undefined
      ? {}
      : { earliestHarvestDate: str('earliestHarvestDate') }),
    ...(phiOverride === undefined ? {} : { phiOverride }),
    ...(typeof inventoryLotId === 'string' ? { inventoryLotId } : {}),
  } as StoredSpray;
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

const HydratedSpraysContext = createContext<HydratedTableStore<StoredSpray> | null>(null);

export function HydratedSpraysProvider({ children }: { children: ReactNode }) {
  const { activeFarm } = useAuth();
  const farmId = activeFarm?.id ?? 'none';
  const [value, setValue] = useState<HydratedTableStore<StoredSpray>>(() =>
    emptyHydratedTableStore<StoredSpray>(),
  );

  useEffect(() => {
    const store = createHydratedTableStore({
      database: getLocalDatabase(),
      sql: SPRAY_EVENTS_SQL,
      params: [farmId],
      mapRow: mapHydratedSpray,
    });
    setValue(store);
    return () => store.close();
  }, [farmId]);

  return <HydratedSpraysContext.Provider value={value}>{children}</HydratedSpraysContext.Provider>;
}

function useHydratedSpraysStore(): HydratedTableStore<StoredSpray> {
  const ctx = useContext(HydratedSpraysContext);
  if (!ctx) throw new Error('useHydrated* must be used inside a HydratedSpraysProvider');
  return ctx;
}

/** Sprays another device recorded, or this device's own round-tripped back down. */
export function useHydratedSprays(): readonly StoredSpray[] {
  const store = useHydratedSpraysStore();
  return useSyncExternalStore(store.subscribe, store.all);
}

export function useHydratedSpraysSettled(): boolean {
  const store = useHydratedSpraysStore();
  return useSyncExternalStore(store.subscribe, store.settled);
}

export function useHydratedSpraysHydrationFailed(): boolean {
  const store = useHydratedSpraysStore();
  return useSyncExternalStore(store.subscribe, store.hydrationFailed);
}
