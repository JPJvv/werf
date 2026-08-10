/**
 * The down-sync half of mobs/tallies (phase-checklists.md 3e) — rows another device captured,
 * sent, and the server has already replicated to THIS device via PowerSync, read through the
 * `@werf/sync` adapter and never the SDK directly (ADR-0003). This is the fix for tripwire 3e:
 * before this file existed, `Outbox.tsx`'s `landed()` could only ever mean "did this device send
 * it", which is exact only while nothing hydrates — see `Outbox.tsx`'s own header for the full
 * account of the bug this closes.
 *
 * ⭐ Deliberately NOT a widening of `LocalMobs`/`LocalTallies`. Those stores hold what THIS DEVICE
 * captured, in the local-only `capture_records` table, and `Outbox.tsx`'s upload QUEUE reads them
 * unchanged — a hydrated row must never look like a pending local capture, or a device would
 * re-POST another device's already-landed work. This file is a second, independent read: the
 * canonical `mobs`/`events` tables PowerSync down-syncs into, farm-scoped so a multi-farm account's
 * other farms never leak into this one's fold (Sync Streams are per-user, not per-farm —
 * `packages/sync/src/connector.ts`'s header). Callers that need "everything this device knows
 * about, captured or heard about" merge the two explicitly — see `Outbox.tsx`'s `needsHead` and
 * `herd.ts`'s `useEffectiveMobs` for the two places that do.
 */

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { createHydratedTableStore, type HydratedTableStore } from '@werf/sync';
import type { TallyRecord } from '@werf/domain';
import { useAuth } from '../auth/AuthProvider';
import { getLocalDatabase } from '../sync/local-db';
import type { StoredMob } from './LocalMobs';

const MOBS_SQL =
  'SELECT id, farm_id, enterprise_id, land_unit_id, name, species, head_count, initial_head_count FROM mobs WHERE farm_id = ? AND deleted_at IS NULL';

// `type = 'tally'` and `deleted_at IS NULL` narrow the shared `events` table to exactly the rows
// `projectHeadCount` folds — every other event type is invisible to this query by construction.
const TALLY_EVENTS_SQL =
  "SELECT id, mob_id, occurred_at, payload FROM events WHERE farm_id = ? AND type = 'tally' AND deleted_at IS NULL";

/** Tolerant per row — a row written by a future schema version this build does not understand is
 *  skipped, not fatal, same philosophy as `sqlite-capture-store.ts`'s payload parsing. */
function mapHydratedMob(row: Record<string, unknown>): StoredMob | null {
  const id = row['id'];
  const farmId = row['farm_id'];
  const name = row['name'];
  const species = row['species'];
  if (
    typeof id !== 'string' ||
    typeof farmId !== 'string' ||
    typeof name !== 'string' ||
    typeof species !== 'string'
  ) {
    return null;
  }
  const headCount = row['head_count'];
  const initialHeadCount = row['initial_head_count'];
  return {
    id,
    farmId,
    enterpriseId: typeof row['enterprise_id'] === 'string' ? row['enterprise_id'] : null,
    landUnitId: typeof row['land_unit_id'] === 'string' ? row['land_unit_id'] : null,
    name,
    species: species as StoredMob['species'],
    headCount: typeof headCount === 'number' ? headCount : null,
    initialHeadCount: typeof initialHeadCount === 'number' ? initialHeadCount : null,
  };
}

/** Same tolerance, plus a `JSON.parse` of the event payload — the same shape
 *  `recordMobTally` (`@werf/domain`) writes, read back rather than duplicated. */
function mapHydratedTally(row: Record<string, unknown>): TallyRecord | null {
  const id = row['id'];
  const mobId = row['mob_id'];
  const occurredAt = row['occurred_at'];
  const payloadJson = row['payload'];
  if (
    typeof id !== 'string' ||
    typeof mobId !== 'string' ||
    typeof occurredAt !== 'string' ||
    typeof payloadJson !== 'string'
  ) {
    return null;
  }
  // ⭐ Normalize to the exact `.toISOString()` format a local capture writes. Postgres's
  // `timestamptz` does not guarantee the SQLite column comes back as ISO-8601-with-`T` — a
  // `2026-07-25 12:00:00+00` (space, not `T`) byte-sorts BEFORE every local tally on the same
  // instant, silently breaking the `(occurredAt, id)` total order `projectHeadCount` depends on.
  // Parsing to a Date and re-emitting ISO makes the wire format a non-issue rather than a
  // load-bearing assumption.
  const occurredAtDate = new Date(occurredAt);
  if (Number.isNaN(occurredAtDate.getTime())) return null;
  const occurredAtIso = occurredAtDate.toISOString();
  try {
    const payload: unknown = JSON.parse(payloadJson);
    if (typeof payload !== 'object' || payload === null || !('reason' in payload)) return null;
    const { reason, delta, countedHead } = payload as {
      reason: unknown;
      delta?: unknown;
      countedHead?: unknown;
    };
    if (typeof reason !== 'string') return null;
    return {
      id,
      mobId,
      occurredAt: occurredAtIso,
      reason: reason as TallyRecord['reason'],
      ...(typeof delta === 'number' ? { delta } : {}),
      ...(typeof countedHead === 'number' ? { countedHead } : {}),
    };
  } catch {
    return null;
  }
}

interface HydratedLivestockValue {
  readonly mobs: HydratedTableStore<StoredMob>;
  readonly tallies: HydratedTableStore<TallyRecord>;
}

const HydratedLivestockContext = createContext<HydratedLivestockValue | null>(null);

export function HydratedLivestockProvider({ children }: { children: ReactNode }) {
  const { activeFarm } = useAuth();
  const farmId = activeFarm?.id ?? 'none';
  const value = useMemo<HydratedLivestockValue>(
    () => ({
      mobs: createHydratedTableStore({
        database: getLocalDatabase(),
        sql: MOBS_SQL,
        params: [farmId],
        mapRow: mapHydratedMob,
      }),
      tallies: createHydratedTableStore({
        database: getLocalDatabase(),
        sql: TALLY_EVENTS_SQL,
        params: [farmId],
        mapRow: mapHydratedTally,
      }),
    }),
    [farmId],
  );
  return (
    <HydratedLivestockContext.Provider value={value}>{children}</HydratedLivestockContext.Provider>
  );
}

function useHydratedLivestock(): HydratedLivestockValue {
  const ctx = useContext(HydratedLivestockContext);
  if (!ctx) throw new Error('useHydrated* must be used inside a HydratedLivestockProvider');
  return ctx;
}

/** Mobs another device created and the server has replicated to this one. */
export function useHydratedMobs(): readonly StoredMob[] {
  const { mobs } = useHydratedLivestock();
  return useSyncExternalStore(mobs.subscribe, mobs.all);
}

/** Whether the first local read of the down-synced `mobs` table has completed — see
 *  `hydrated-table-store.ts`'s header for why this is never `waitForFirstSync()`. */
export function useHydratedMobsSettled(): boolean {
  const { mobs } = useHydratedLivestock();
  return useSyncExternalStore(mobs.subscribe, mobs.settled);
}

export function useHydratedMobsHydrationFailed(): boolean {
  const { mobs } = useHydratedLivestock();
  return useSyncExternalStore(mobs.subscribe, mobs.hydrationFailed);
}

/** Tallies another device sent and the server has replicated to this one, in `TallyRecord` shape
 *  — everything `projectHeadCount` needs, nothing this device did not verify (no `count`, which
 *  only the capturing device's `StoredTally` carries). */
export function useHydratedTallies(): readonly TallyRecord[] {
  const { tallies } = useHydratedLivestock();
  return useSyncExternalStore(tallies.subscribe, tallies.all);
}

export function useHydratedTalliesSettled(): boolean {
  const { tallies } = useHydratedLivestock();
  return useSyncExternalStore(tallies.subscribe, tallies.settled);
}

export function useHydratedTalliesHydrationFailed(): boolean {
  const { tallies } = useHydratedLivestock();
  return useSyncExternalStore(tallies.subscribe, tallies.hydrationFailed);
}

/**
 * Merges a device's own captures with the hydrated copies of the same canonical rows, local
 * winning on a shared id — the two are two views of the SAME row once the server has both, and
 * only one of them should ever reach a fold. Used by both `Outbox.tsx`'s `needsHead` arithmetic
 * and `herd.ts`'s read projection, so the two cannot disagree about what "this device knows about"
 * means. Local wins on a collision purely because it can never be staler than the hydrated copy —
 * the content is the same either way once both exist, since a row does not change after it lands.
 */
export function mergeById<T extends { id: string }>(
  local: readonly T[],
  hydrated: readonly T[],
): readonly T[] {
  if (hydrated.length === 0) return local;
  const seen = new Set(local.map((row) => row.id));
  const extra = hydrated.filter((row) => !seen.has(row.id));
  return extra.length === 0 ? local : [...local, ...extra];
}
