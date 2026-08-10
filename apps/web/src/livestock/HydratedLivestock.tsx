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

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
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
    const {
      reason,
      delta,
      countedHead,
      counterpartMobId,
      carriedWithholdUntil,
      declaredWithdrawalUntil,
    } = payload as {
      reason: unknown;
      delta?: unknown;
      countedHead?: unknown;
      counterpartMobId?: unknown;
      carriedWithholdUntil?: unknown;
      declaredWithdrawalUntil?: unknown;
    };
    if (typeof reason !== 'string') return null;
    return {
      id,
      mobId,
      occurredAt: occurredAtIso,
      reason: reason as TallyRecord['reason'],
      ...(typeof delta === 'number' ? { delta } : {}),
      ...(typeof countedHead === 'number' ? { countedHead } : {}),
      // ⭐ sync-auditor Finding 1 (2026-08-10): these three were parsed off local captures
      // (`StoredTally`) but silently dropped for a HYDRATED tally, so `withdrawal.ts`'s guard was
      // blind to a withholding that arrived only via down-sync — see `withdrawal.ts` and the two
      // call sites that merge this store in (`AdjustMobScreen.tsx`, `Outbox.tsx`).
      ...(typeof counterpartMobId === 'string' ? { counterpartMobId } : {}),
      ...(typeof carriedWithholdUntil === 'string' ? { carriedWithholdUntil } : {}),
      ...(typeof declaredWithdrawalUntil === 'string' ? { declaredWithdrawalUntil } : {}),
    };
  } catch {
    return null;
  }
}

interface HydratedLivestockValue {
  readonly mobs: HydratedTableStore<StoredMob>;
  readonly tallies: HydratedTableStore<TallyRecord>;
}

/** Permanently unsettled, no subscription to close — safe to construct during render (StrictMode's
 *  render-phase double-invoke is harmless against pure, side-effect-free code, unlike
 *  `createHydratedTableStore` itself, which fires a real `db.watch()`). Exists only for the single
 *  render before the effect below constructs the real pair — `settled()` already starts `false` by
 *  design, so this is one more tick of a state every consumer already tolerates, not a new one.
 *  `all()` returns the SAME empty array every call — `useSyncExternalStore` compares snapshots by
 *  reference, so a fresh `[]` literal per call reads as "always changed" and warns/loops. */
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

const HydratedLivestockContext = createContext<HydratedLivestockValue | null>(null);

export function HydratedLivestockProvider({ children }: { children: ReactNode }) {
  const { activeFarm } = useAuth();
  const farmId = activeFarm?.id ?? 'none';
  const [value, setValue] = useState<HydratedLivestockValue>(() => ({
    mobs: emptyHydratedTableStore<StoredMob>(),
    tallies: emptyHydratedTableStore<TallyRecord>(),
  }));

  // ⭐ sync-auditor re-pass (2026-08-10): the store pair used to be built in a `useMemo` above this
  // effect, whose cleanup closed it. That is NOT symmetric under React 18 StrictMode: mount → run
  // this effect → immediately simulate an unmount (run the cleanup) → remount (re-run the effect) —
  // all against the SAME memoized pair, since `farmId` never changed across that synthetic cycle.
  // The cleanup closed it; nothing reconstructed it; `AbortController.abort()` has no undo — down-
  // sync hydration died permanently after the FIRST real mount in `pnpm dev` (`main.tsx` wraps
  // `<App/>` in `<StrictMode>`), invisibly, because production strips the double-invoke and every
  // existing test rendered without it. Fixed by moving construction INSIDE the effect, mirroring
  // `SyncConnection.tsx`'s already-established shape for exactly this class of resource: this
  // effect's own setup and cleanup are now symmetric, so a StrictMode synthetic cycle closes one
  // pair and builds a fresh one, precisely as it does for a real farm switch or unmount.
  useEffect(() => {
    const pair: HydratedLivestockValue = {
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
    };
    setValue(pair);
    return () => {
      pair.mobs.close();
      pair.tallies.close();
    };
  }, [farmId]);
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
