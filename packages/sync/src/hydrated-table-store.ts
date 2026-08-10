/**
 * A reactive, read-only view over one farm-scoped slice of a PowerSync-synced canonical table
 * (phase-checklists.md 3e) — the down-sync counterpart to `sqlite-capture-store.ts`'s upload-side
 * store. `Outbox.tsx` and the read projections (`herd.ts`) use this to see rows another device
 * captured and the server has already replicated to this one, WITHOUT importing `@powersync/web`
 * themselves — only `import type { LocalDatabase }` crosses into `local-database.ts`, same
 * discipline as every other file in this package that touches the SDK's shape but not its runtime.
 *
 * ⭐ `settled()` here means "the first LOCAL read of this query completed" — never
 * `waitForFirstSync()` or anything that waits on a live connection. `db.watch()` runs against local
 * SQLite regardless of connection state, so an offline device settles immediately with whatever it
 * already holds (possibly nothing, possibly a farm's whole history from the last time it was
 * online) — exactly the offline-first premise this product does not get to compromise on. A design
 * that gated this on `waitForFirstSync()` would mean a device six weeks offline could never mark a
 * single store settled, which would hold the outbox flush forever for a reason that has nothing to
 * do with the invariant `settled()` exists to protect.
 *
 * ⛔ NOT a second source of truth for "does the server hold this record". This store reads
 * whatever the LOCAL down-synced copy of the canonical table currently contains — nothing more,
 * nothing less. A caller does not write into it, and it is deliberately farm-scoped by a `WHERE
 * farm_id = ?` in the query itself: the local SQLite file is ONE database for every farm a
 * multi-farm account belongs to (Sync Streams are per-user, not per-farm — packages/sync/src/
 * connector.ts's header), so a row from a farm the device is not currently showing must never
 * leak into this farm's fold.
 */

import type { LocalDatabase } from './local-database';

export interface HydratedTableStore<T> {
  /** The current matching rows. Stable identity between watch callbacks — safe for
   *  `useSyncExternalStore`. */
  all(): readonly T[];
  subscribe(listener: () => void): () => void;
  /** Whether the first local read has completed, on either outcome. See this module's header. */
  settled(): boolean;
  /**
   * Whether a read attempt ended in a genuine failure (the query itself errored) rather than a
   * clean result. Sticky once true: a watched query that failed once cannot be trusted to notice
   * its own recovery, and a consumer reading this alongside other sources (`Outbox.tsx`'s flush,
   * most of all) must keep treating it as "cannot currently verify" — the same fail-closed
   * philosophy `CaptureStore.hydrationFailed()` already established for the upload side.
   */
  hydrationFailed(): boolean;
}

export interface HydratedTableStoreOptions<T> {
  /** Resolves once the shared local database has opened. Awaited lazily, not at construction. */
  readonly database: Promise<LocalDatabase>;
  readonly sql: string;
  readonly params: readonly unknown[];
  /**
   * Maps one raw SQLite row (snake_case columns) to the shape callers read, or `null` to skip a
   * row this build cannot make sense of. Pure. Tolerant per row, same philosophy as
   * `sqlite-capture-store.ts`'s payload parsing: a single row written by a future schema version
   * this build does not understand must not fail the whole hydration.
   */
  readonly mapRow: (row: Record<string, unknown>) => T | null;
}

interface WatchResultLike {
  readonly array: readonly Record<string, unknown>[];
}

export function createHydratedTableStore<T>(
  options: HydratedTableStoreOptions<T>,
): HydratedTableStore<T> {
  const { database, sql, params, mapRow } = options;

  let snapshot: readonly T[] = [];
  let hasSettled = false;
  let didFail = false;
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  void (async () => {
    let db: LocalDatabase;
    try {
      db = await database;
    } catch {
      // The shared local database itself never opened. Same fail-closed shape as a query error
      // below — nothing to read, and nothing this store can verify.
      didFail = true;
      hasSettled = true;
      notify();
      return;
    }
    db.watch(
      sql,
      params as unknown[],
      {
        onResult: (result: unknown) => {
          const rows = (result as WatchResultLike).array;
          snapshot = rows.flatMap((row) => {
            const mapped = mapRow(row);
            return mapped === null ? [] : [mapped];
          });
          hasSettled = true;
          notify();
        },
        onError: () => {
          // A single malformed row is not this class of failure — `mapRow` is expected to be
          // total over what the schema can produce, matching `sqlite-capture-store.ts`'s
          // per-row tolerance philosophy. This branch is the query itself refusing to run.
          didFail = true;
          hasSettled = true;
          notify();
        },
      },
      { triggerImmediate: true },
    );
  })();

  return {
    all(): readonly T[] {
      return snapshot;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    settled(): boolean {
      return hasSettled;
    },
    hydrationFailed(): boolean {
      return didFail;
    },
  };
}
