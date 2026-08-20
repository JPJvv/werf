/**
 * The down-sync half of land (phase-checklists.md 3e — land hydration, closed 2026-08-14). Camps
 * and blocks another device created, and boundary walks another device sent, already replicated to
 * THIS device via PowerSync — read through the `@werf/sync` adapter, never the SDK directly
 * (ADR-0003). Same family as `livestock/HydratedLivestock.tsx`: a second, independent read of the
 * canonical `land_units`/`events` tables PowerSync down-syncs into, farm-scoped so a multi-farm
 * account's other farms never leak in (Sync Streams are per-user, not per-farm).
 *
 * ⭐ Deliberately NOT a widening of `LocalLand`. That store holds what THIS DEVICE captured, in the
 * local-only `capture_records` table, and `Outbox.tsx`'s upload QUEUE reads it unchanged — a
 * hydrated row must never look like a pending local capture, or a device would re-POST another
 * device's already-landed work. `LocalLand.tsx`'s `useEffectiveLandUnits`/`useEffectiveBoundaryWalks`
 * merge the two explicitly for every READ path (list screens, pickers, `useCurrentBoundary`).
 *
 * A separate file from `HydratedLivestock.tsx`, not an extension of it: land is captured through its
 * own local store (`LocalLand.tsx`, not `LocalHerd`/`LocalMobs`), and mirrors that split here.
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
import { isIrrigationType, type IrrigationType } from '@werf/core';
import type { WalkFix } from '@werf/domain';
import { useAuth } from '../auth/AuthProvider';
import { getLocalDatabase } from '../sync/local-db';
import type { StoredLandUnit, StoredBoundaryWalk } from './LocalLand';

const LAND_UNITS_SQL =
  'SELECT id, farm_id, enterprise_id, parent_id, kind, code, name, boundary_geojson, hectares, ' +
  'carrying_capacity_lsu, soil_type, irrigation, attributes FROM land_units ' +
  'WHERE farm_id = ? AND deleted_at IS NULL';

// `type = 'boundary_walk'` narrows the shared `events` table to exactly the rows
// `latestWalkFor` folds — every other event type is invisible to this query by construction.
const BOUNDARY_WALK_EVENTS_SQL =
  'SELECT id, farm_id, land_unit_id, occurred_at, payload FROM events ' +
  "WHERE farm_id = ? AND type = 'boundary_walk' AND deleted_at IS NULL";

/** Tolerant per row — a row written by a future schema version this build does not understand is
 *  skipped, not fatal, same philosophy as `sqlite-capture-store.ts`'s payload parsing. */
function mapHydratedLandUnit(row: Record<string, unknown>): StoredLandUnit | null {
  const id = row['id'];
  const farmId = row['farm_id'];
  const kind = row['kind'];
  const code = row['code'];
  if (
    typeof id !== 'string' ||
    typeof farmId !== 'string' ||
    typeof kind !== 'string' ||
    typeof code !== 'string'
  ) {
    return null;
  }
  const attributesJson = row['attributes'];
  let attributes: Record<string, unknown> = {};
  if (typeof attributesJson === 'string') {
    try {
      const parsed: unknown = JSON.parse(attributesJson);
      if (typeof parsed === 'object' && parsed !== null)
        attributes = parsed as Record<string, unknown>;
    } catch {
      // Tolerant: an unreadable attributes blob loses only the extras, not the row.
    }
  }
  const str = (key: string): string | null =>
    typeof row[key] === 'string' ? (row[key] as string) : null;
  const num = (key: string): number | null =>
    typeof row[key] === 'number' ? (row[key] as number) : null;
  // Same tolerance as `kind`, made explicit: a value outside the closed set (a future irrigation
  // type this build does not know, or corrupt data) is dropped rather than lying about its type.
  const irrigation = (key: string): IrrigationType | null => {
    const value = row[key];
    return typeof value === 'string' && isIrrigationType(value) ? value : null;
  };
  return {
    id,
    farmId,
    enterpriseId: str('enterprise_id'),
    parentId: str('parent_id'),
    kind: kind as StoredLandUnit['kind'],
    code,
    name: str('name'),
    boundaryGeojson: str('boundary_geojson'),
    hectares: num('hectares'),
    carryingCapacityLsu: num('carrying_capacity_lsu'),
    soilType: str('soil_type'),
    irrigation: irrigation('irrigation'),
    attributes,
  };
}

/** Same tolerance, plus a `JSON.parse` of the event payload — the same shape
 *  `recordBoundaryWalk` (`@werf/domain`) writes, read back rather than duplicated. No field here is
 *  enrichment a local capture lacks (unlike a move's `fromMobId`): a walk's payload is exactly
 *  `{boundaryGeojson, corners, areaHectares}`, the same three fields `StoredBoundaryWalk` already
 *  carries — so `mergeById` (local-wins) is the correct, simpler merge, not
 *  `mergeByIdPreferHydrated`. See `LocalLand.tsx`'s `useEffectiveBoundaryWalks`. */
function mapHydratedBoundaryWalk(row: Record<string, unknown>): StoredBoundaryWalk | null {
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
  try {
    const payload: unknown = JSON.parse(payloadJson);
    if (typeof payload !== 'object' || payload === null) return null;
    const { boundaryGeojson, corners, areaHectares } = payload as {
      boundaryGeojson?: unknown;
      corners?: unknown;
      areaHectares?: unknown;
    };
    if (
      typeof boundaryGeojson !== 'string' ||
      !Array.isArray(corners) ||
      typeof areaHectares !== 'number'
    ) {
      return null;
    }
    const fixes: WalkFix[] = [];
    for (const corner of corners) {
      if (
        typeof corner !== 'object' ||
        corner === null ||
        typeof (corner as { lon?: unknown }).lon !== 'number' ||
        typeof (corner as { lat?: unknown }).lat !== 'number' ||
        typeof (corner as { accuracyM?: unknown }).accuracyM !== 'number'
      ) {
        return null;
      }
      const c = corner as { lon: number; lat: number; accuracyM: number };
      fixes.push({ lon: c.lon, lat: c.lat, accuracyM: c.accuracyM });
    }
    return {
      id,
      farmId,
      landUnitId,
      occurredAt: occurredAtDate.toISOString(),
      corners: fixes,
      boundaryGeojson,
      areaHectares,
    };
  } catch {
    return null;
  }
}

interface HydratedLandValue {
  readonly landUnits: HydratedTableStore<StoredLandUnit>;
  readonly boundaryWalks: HydratedTableStore<StoredBoundaryWalk>;
}

/** Permanently unsettled, no subscription to close — see `HydratedLivestock.tsx`'s identical
 *  helper for the full StrictMode rationale. */
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

const HydratedLandContext = createContext<HydratedLandValue | null>(null);

export function HydratedLandProvider({ children }: { children: ReactNode }) {
  const { activeFarm } = useAuth();
  const farmId = activeFarm?.id ?? 'none';
  const [value, setValue] = useState<HydratedLandValue>(() => ({
    landUnits: emptyHydratedTableStore<StoredLandUnit>(),
    boundaryWalks: emptyHydratedTableStore<StoredBoundaryWalk>(),
  }));

  // Construction lives INSIDE the effect, not a `useMemo` above it — `HydratedLivestock.tsx`'s
  // StrictMode finding applies identically here: a memoized pair closed by the cleanup and never
  // rebuilt dies permanently on React 18's synthetic double-invoke in `pnpm dev`.
  useEffect(() => {
    const pair: HydratedLandValue = {
      landUnits: createHydratedTableStore({
        database: getLocalDatabase(),
        sql: LAND_UNITS_SQL,
        params: [farmId],
        mapRow: mapHydratedLandUnit,
      }),
      boundaryWalks: createHydratedTableStore({
        database: getLocalDatabase(),
        sql: BOUNDARY_WALK_EVENTS_SQL,
        params: [farmId],
        mapRow: mapHydratedBoundaryWalk,
      }),
    };
    setValue(pair);
    return () => {
      pair.landUnits.close();
      pair.boundaryWalks.close();
    };
  }, [farmId]);

  return <HydratedLandContext.Provider value={value}>{children}</HydratedLandContext.Provider>;
}

function useHydratedLand(): HydratedLandValue {
  const ctx = useContext(HydratedLandContext);
  if (!ctx) throw new Error('useHydrated* must be used inside a HydratedLandProvider');
  return ctx;
}

/** Camps/blocks another device created and the server has replicated to this one. */
export function useHydratedLandUnits(): readonly StoredLandUnit[] {
  const { landUnits } = useHydratedLand();
  return useSyncExternalStore(landUnits.subscribe, landUnits.all);
}

export function useHydratedLandUnitsSettled(): boolean {
  const { landUnits } = useHydratedLand();
  return useSyncExternalStore(landUnits.subscribe, landUnits.settled);
}

export function useHydratedLandUnitsHydrationFailed(): boolean {
  const { landUnits } = useHydratedLand();
  return useSyncExternalStore(landUnits.subscribe, landUnits.hydrationFailed);
}

/** Boundary walks another device sent and the server has replicated to this one. */
export function useHydratedBoundaryWalks(): readonly StoredBoundaryWalk[] {
  const { boundaryWalks } = useHydratedLand();
  return useSyncExternalStore(boundaryWalks.subscribe, boundaryWalks.all);
}

export function useHydratedBoundaryWalksSettled(): boolean {
  const { boundaryWalks } = useHydratedLand();
  return useSyncExternalStore(boundaryWalks.subscribe, boundaryWalks.settled);
}

export function useHydratedBoundaryWalksHydrationFailed(): boolean {
  const { boundaryWalks } = useHydratedLand();
  return useSyncExternalStore(boundaryWalks.subscribe, boundaryWalks.hydrationFailed);
}
