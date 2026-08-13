/**
 * The SQLite/OPFS-backed `CaptureStore<T>` (phase-checklists.md 3c) — a sibling to
 * `capture-store.ts`'s `createCaptureStore`, not a replacement for it. `createCaptureStore`
 * (localStorage-backed) is untouched and keeps backing `sent-log.ts`/`draft-store.ts`; this file
 * is what the 12 `Local*.tsx` providers switch to for the append-only capture logs themselves.
 *
 * Implements the SAME `CaptureStore<T>` interface with the SAME synchronous-append contract
 * (NFR-007, <50ms local commit — `.claude/rules/frontend.md`): `append()` updates the in-memory
 * snapshot and notifies subscribers before it returns, whether or not the database has finished
 * opening. Only `import type { LocalDatabase }` crosses into `local-database.ts` — never a
 * runtime import — so this file never drags `@powersync/web`'s WASM engine into whatever
 * statically imports it, matching `connector.ts`'s own discipline for the same reason.
 *
 * ⭐ THE SUBTLEST CORRECTNESS POINT IN THIS FILE: construction is synchronous, but opening the
 * database and reading back a store's rows is not — real wall-clock time (DB open + one-time
 * migration check + a SELECT) elapses before hydration completes. An `append()` called in that
 * window is a farmer's capture the screen has already shown as saved; a hydration that REPLACES
 * the in-memory snapshot with what it read from the database, rather than MERGING the two, would
 * silently drop it. So hydration always merges `[...rowsFromDb, ...pendingAppends]`, never
 * replaces — the append-order guarantee `apps/web/src/sync/Outbox.tsx`'s FK/`guardedBy`/
 * `needsHead` logic depends on holds across the hydration boundary, not just within it.
 */

import type { CaptureStore } from './capture-store';
import type { SessionStorageLike } from './session-store';
import type { LocalDatabase } from './local-database';

export interface SqliteCaptureStoreOptions {
  /** Resolves once the shared local database has opened. Awaited lazily, not at construction. */
  readonly database: Promise<LocalDatabase>;
  /** Same "werf-<name>:<farmId>" shape as the localStorage key it replaces. */
  readonly key: string;
  /** `window.localStorage` — read-only, consulted once for this key's one-time migration. */
  readonly legacyStorage: SessionStorageLike;
}

// phase-checklists.md 3f: "the write queue is never bounded and never evicted." A local SQLite
// write is not network-bound the way Outbox.tsx's flush is, so this retries far sooner than that
// file's 90s throttle-driven interval — quota pressure from a large photo capture elsewhere in
// the app can clear within a second once that write finishes, and there is no reason to leave a
// farmer's capture undurable for a minute and a half waiting on a constant tuned for a different
// failure class.
export const PERSIST_RETRY_INTERVAL_MS = 5_000;

interface CaptureRecordRow {
  readonly payload_json: string;
}

interface MigrationMarkerRow {
  readonly id: string;
}

const PERSIST_CAPTURE_SQL =
  'INSERT OR REPLACE INTO capture_records (id, store_key, farm_id, seq, payload_json) VALUES (?, ?, ?, ?, ?)';

interface PersistenceRetry {
  readonly db: LocalDatabase;
  readonly params: readonly unknown[];
  inFlight: boolean;
}

// One application-level durability queue, rather than one interval per mounted capture provider.
// A failed write must outlive a farm-switching component (discarding it in `close()` would turn a
// resource fix into data loss), but it does not need to retain that store's listeners/snapshot.
const persistenceRetries = new Map<string, PersistenceRetry>();
let persistenceRetryTimer: ReturnType<typeof setInterval> | null = null;

/** Test isolation only; production must never discard this queue. Re-exported only by ./testing. */
export function resetPersistenceRetryCoordinatorForTesting(): void {
  persistenceRetries.clear();
  if (persistenceRetryTimer !== null) clearInterval(persistenceRetryTimer);
  persistenceRetryTimer = null;
}

function stopPersistenceTimerWhenIdle(): void {
  if (persistenceRetries.size !== 0 || persistenceRetryTimer === null) return;
  clearInterval(persistenceRetryTimer);
  persistenceRetryTimer = null;
}

function attemptPersistence(retryKey: string, retry: PersistenceRetry): void {
  if (retry.inFlight) return;
  retry.inFlight = true;
  retry.db
    .execute(PERSIST_CAPTURE_SQL, [...retry.params])
    .then(() => {
      if (persistenceRetries.get(retryKey) === retry) persistenceRetries.delete(retryKey);
      stopPersistenceTimerWhenIdle();
    })
    .catch(() => {
      retry.inFlight = false;
      if (!persistenceRetries.has(retryKey)) persistenceRetries.set(retryKey, retry);
      ensurePersistenceTimer();
    });
}

function ensurePersistenceTimer(): void {
  if (persistenceRetryTimer !== null) return;
  persistenceRetryTimer = setInterval(() => {
    for (const [retryKey, retry] of [...persistenceRetries]) {
      attemptPersistence(retryKey, retry);
    }
    stopPersistenceTimerWhenIdle();
  }, PERSIST_RETRY_INTERVAL_MS);
}

function persistCapture(db: LocalDatabase, retryKey: string, params: readonly unknown[]): void {
  const retry: PersistenceRetry = { db, params, inFlight: false };
  persistenceRetries.set(retryKey, retry);
  attemptPersistence(retryKey, retry);
}

/** Same tolerant parse as `capture-store.ts`'s `load()`: corrupt/missing → `[]`, never throws — a
 *  parse error here would otherwise crash a boot that has already read the marker as "not yet
 *  migrated" and is about to attempt it. */
function parseLegacyArray<T>(raw: string | null): readonly T[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/**
 * Migrates one store_key's legacy localStorage array into `capture_records`, once. Guarded by a
 * row in `capture_migrations` whose PRESENCE is the marker — no boolean column, so "already
 * migrated" is one indexed lookup. Every migrated row AND the marker commit inside a single
 * `writeTransaction`, which auto-rolls-back and rethrows on any error inside its callback
 * (confirmed against the installed `@powersync/common`'s `DBAdapter.js` — `runWith` wraps the
 * callback in `BEGIN IMMEDIATE` / `COMMIT`, rolling back on a thrown error). So a browser kill
 * mid-migration leaves either nothing committed (safe to retry next boot — the source, legacy
 * localStorage, is only ever read here, never written or cleared) or everything committed; there
 * is no observable state with rows but no marker, or a marker with a truncated row set.
 *
 * ⭐ THE MARKER CHECK RUNS TWICE — once outside the transaction (a fast path: the common case,
 * already migrated, never opens a write transaction at all), and once again INSIDE it, right
 * before the inserts. The inside check is not redundant: `main.tsx` wraps the app in
 * `StrictMode`, which double-invokes a provider's `useMemo` in development, and two
 * `createSqliteCaptureStore` instances for the SAME key can each pass the OUTSIDE check before
 * either has written anything — a TOCTOU race. `writeTransaction`'s `BEGIN IMMEDIATE` serializes
 * writers, so the second transaction to actually run sees the first's committed marker at the
 * INSIDE check and returns without re-inserting — closing the window the outside check alone
 * cannot.
 */
async function migrateIfNeeded<T extends { id: string }>(
  db: LocalDatabase,
  key: string,
  farmId: string,
  legacyStorage: SessionStorageLike,
): Promise<void> {
  const alreadyMigrated = await db.getOptional<MigrationMarkerRow>(
    'SELECT id FROM capture_migrations WHERE id = ?',
    [key],
  );
  if (alreadyMigrated !== null) return; // fast path — no transaction opened, localStorage not read

  const records = parseLegacyArray<T>(legacyStorage.getItem(key));

  await db.writeTransaction(async (tx) => {
    const marker = await tx.getOptional<MigrationMarkerRow>(
      'SELECT id FROM capture_migrations WHERE id = ?',
      [key],
    );
    if (marker !== null) return; // lost the race — the winner already migrated this key

    let seq = 0;
    for (const record of records) {
      await tx.execute(
        'INSERT OR REPLACE INTO capture_records (id, store_key, farm_id, seq, payload_json) VALUES (?, ?, ?, ?, ?)',
        [record.id, key, farmId, seq++, JSON.stringify(record)],
      );
    }
    await tx.execute(
      'INSERT INTO capture_migrations (id, migrated_at, record_count) VALUES (?, ?, ?)',
      [key, new Date().toISOString(), records.length],
    );
  });
}

export function createSqliteCaptureStore<T extends { id: string }>(
  options: SqliteCaptureStoreOptions,
): CaptureStore<T> {
  const { database, key, legacyStorage } = options;
  // Every capture-store key is "werf-<name>:<farmId>" — a single colon. Parsed back out rather
  // than threaded as a new option, so the `*StoreFactory` signature `(key: string) => ...` the
  // seam contract already fixes does not have to widen.
  const farmId = key.slice(key.indexOf(':') + 1);

  let snapshot: readonly T[] = [];
  const pendingAppends: T[] = [];
  // `resolvedDb !== null` is the single source of truth for "safe to persist directly" — set
  // only once hydration has actually SUCCEEDED, so a failed attempt (caught below) leaves it
  // null forever and every subsequent append() keeps buffering into `pendingAppends`. Those
  // buffered records stay correct in `snapshot` (append() updates it unconditionally) but are
  // never durable until a future boot's retry succeeds — an accepted degraded mode, not a lost
  // write, matching the rest of this store's failure tolerance.
  let resolvedDb: LocalDatabase | null = null;
  let nextSeq = 0;
  // `settled()`'s backing flag — flips true once the hydration IIFE below reaches its `finally`,
  // on EITHER outcome. A consumer reading several stores together (Outbox.tsx's flush, most of
  // all) needs this to tell "genuinely holds nothing" apart from "has not finished asking yet" —
  // an unhydrated store's empty `all()` is indistinguishable from a confirmed-empty one without
  // it, and the difference is exactly the evidence a safety ordering is judged against.
  let hasSettled = false;
  // `hydrationFailed()`'s backing flag. Distinct from a corrupt ROW (tolerated below, never sets
  // this) — this is for when the hydration ATTEMPT itself could not complete: the database would
  // not open, the migration transaction genuinely threw, or the SELECT itself failed. `all()`
  // being `[]` in that case is not "confirmed empty"; a consumer reading several stores together
  // (Outbox.tsx's flush) must treat it as "cannot currently verify", never as evidence.
  let didHydrationFail = false;
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  const persist = (db: LocalDatabase, record: T, seq: number): void => {
    persistCapture(db, `${key}\u0000${record.id}`, [
      record.id,
      key,
      farmId,
      seq,
      JSON.stringify(record),
    ]);
  };

  void (async () => {
    try {
      const db = await database;
      await migrateIfNeeded<T>(db, key, farmId, legacyStorage);
      const rows = await db.getAll<CaptureRecordRow>(
        'SELECT payload_json FROM capture_records WHERE store_key = ? ORDER BY seq ASC',
        [key],
      );
      // Tolerant per row, matching parseLegacyArray's philosophy — a single malformed row (e.g.
      // written by a future schema version this build does not understand) must not fail the
      // WHOLE hydration. It used to: one bad row threw here, the catch block below caught it, and
      // because the migration marker was already committed, EVERY future boot re-threw on the
      // same row forever — a permanent read failure a farmer could never recover from, and every
      // append() made after that point silently stopped being durable (resolvedDb never got set).
      // Skipping just the bad row keeps hydration succeeding for everything else that IS readable.
      const fromDb = rows.flatMap((row) => {
        try {
          return [JSON.parse(row.payload_json) as T];
        } catch {
          return [];
        }
      });

      // Merge, never replace — see this module's header.
      snapshot = [...fromDb, ...pendingAppends];
      nextSeq = fromDb.length;
      for (const record of pendingAppends) persist(db, record, nextSeq++);
      pendingAppends.length = 0;
      resolvedDb = db;
    } catch {
      // The database would not open, or migration/the SELECT itself threw for a reason a corrupt
      // row can no longer be (that is tolerated above, per-row, without reaching here). Anything
      // appended before or during this window is still correct in `snapshot` — append() updates
      // it unconditionally, independent of hydration succeeding — only the DB-backed history is
      // missing until a future boot's retry succeeds. Never rethrown: an unhandled rejection must
      // not crash a screen that already has the farmer's in-memory capture on it.
      //
      // `didHydrationFail = true` is the load-bearing part: `all()` reading `[]` here is NOT
      // "this store confirmed it holds nothing" the way it is on a genuinely empty, successful
      // hydration — a consumer must be able to tell the two apart (Outbox.tsx's flush does).
      didHydrationFail = true;
    } finally {
      // Fires on BOTH outcomes — a subscriber (React's useSyncExternalStore, or a test awaiting
      // this store's own settle) needs to know the hydration ATTEMPT is over, whether or not it
      // succeeded; a notify() only on success would hang a listener forever on a failed boot.
      hasSettled = true;
      notify();
    }
  })();

  return {
    all(): readonly T[] {
      return snapshot;
    },

    append(record: T): void {
      snapshot = [...snapshot, record];
      if (resolvedDb !== null) {
        persist(resolvedDb, record, nextSeq++);
      } else {
        pendingAppends.push(record);
      }
      notify();
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    settled(): boolean {
      return hasSettled;
    },

    hydrationFailed(): boolean {
      return didHydrationFail;
    },

    close(): void {
      // Retry commands live in the application-level coordinator above and intentionally survive
      // this instance: clearing them here would lose a capture accepted before a farm switch.
      listeners.clear();
    },
  };
}
