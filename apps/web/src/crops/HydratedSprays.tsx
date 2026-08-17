/**
 * The down-sync half of sprays (FR-204) — sprays another device recorded (or THIS device's own,
 * round-tripped back down), already replicated to THIS device via PowerSync — read through the
 * `@werf/sync` adapter, never the SDK directly (ADR-0003). Mirrors `HydratedFertiliser.tsx`, one
 * compliance-gated field family over: the mapped row here ALSO carries `activeIngredients`/
 * `phiDays`/`earliestHarvestDate`, because those are resolved server-side and this table is the
 * ONLY place a device ever sees them (`LocalSprays.tsx`'s own module note).
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
import type { StoredSpray } from './LocalSprays';

const SPRAY_EVENTS_SQL =
  'SELECT id, farm_id, land_unit_id, occurred_at, payload FROM events ' +
  "WHERE farm_id = ? AND type = 'spray' AND deleted_at IS NULL";

/** Tolerant per row — a row written by a future schema version this build does not understand is
 *  skipped, not fatal, same philosophy as `HydratedFertiliser.tsx`'s mapper. */
function mapHydratedSpray(row: Record<string, unknown>): StoredSpray | null {
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
  const sprayedOn = payload['sprayedOn'];
  const activeIngredientsRaw = payload['activeIngredients'];
  if (
    typeof productId !== 'string' ||
    typeof sprayedOn !== 'string' ||
    !Array.isArray(activeIngredientsRaw)
  ) {
    return null;
  }
  const activeIngredients = activeIngredientsRaw.filter((v): v is string => typeof v === 'string');

  const num = (key: string): number | undefined =>
    typeof payload[key] === 'number' ? (payload[key] as number) : undefined;
  const str = (key: string): string | undefined =>
    typeof payload[key] === 'string' ? (payload[key] as string) : undefined;

  return {
    id,
    farmId,
    landUnitId,
    occurredAt: occurredAtDate.toISOString(),
    sprayedOn,
    productId,
    activeIngredients,
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
