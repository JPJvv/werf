/**
 * The SQLite/OPFS-backed `CaptureStore<T>` (phase-checklists.md 3c) — a sibling to
 * `capture-store.ts`'s `createCaptureStore`, not a replacement for it. `createCaptureStore`
 * (localStorage-backed) is untouched and keeps backing `sent-log.ts`/`draft-store.ts`; this file
 * is what the 12 `Local*.tsx` providers switch to for the append-only capture logs themselves.
 *
 * Implements the SAME `CaptureStore<T>` interface with the SAME synchronous-snapshot contract
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
 *
 * ⭐ P1.1 (2026-08-14): `append()` returns a promise that resolves ONLY once the record is
 * DURABLY PERSISTED to `capture_records` — never before. A capture screen awaits it before
 * reporting "Saved" or advancing (CLAUDE.md's offline-is-the-default-state rule extends to this:
 * the network must never be awaited, but the LOCAL commit genuinely must be). Two failure classes
 * are both retried indefinitely, on the same `PERSIST_RETRY_INTERVAL_MS` cadence, and NEITHER
 * ever discards a farmer's capture (`.claude/rules/db.md`: "the write queue is never discarded by
 * the system"):
 *   1. The database is open (`resolvedDb` is set) but one record's own INSERT fails (quota
 *      pressure, a transient OPFS error) — the existing per-record `persistenceRetries`
 *      coordinator below, extended to resolve that record's own `append()` promise once it lands.
 *   2. The database itself will not open, or migration/the initial SELECT throws — the
 *      `hydrationRetries` coordinator retries the WHOLE open-and-hydrate sequence (calling
 *      `database()` fresh each attempt, since a rejected promise cannot un-reject) until it
 *      succeeds, then flushes every append made during the outage. `hydrationFailed()` flips back
 *      to `false` on recovery, so a consumer reading it (Outbox.tsx's flush) trusts the store
 *      again without requiring a page reload.
 */

import type { CaptureStore } from './capture-store';
import type { SessionStorageLike } from './session-store';
import type { LocalDatabase } from './local-database';

export interface SqliteCaptureStoreOptions {
  /** Opens (or returns) the shared local database. Called lazily, and called AGAIN on every open
   *  retry — a promise that has already rejected cannot later resolve, so recovering from a
   *  failed open requires a fresh attempt, not a fresh await of the same one. */
  readonly database: () => Promise<LocalDatabase>;
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
// failure class. The same cadence backs the whole-database-open retry below (P1.1) — a second,
// independent failure class, not a widening of this one.
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
  readonly resolve: () => void;
  inFlight: boolean;
}

// One application-level durability queue, rather than one interval per mounted capture provider.
// A failed write must outlive a farm-switching component (discarding it in `close()` would turn a
// resource fix into data loss), but it does not need to retain that store's listeners/snapshot.
const persistenceRetries = new Map<string, PersistenceRetry>();
let persistenceRetryTimer: ReturnType<typeof setInterval> | null = null;

// The sibling coordinator for a failed WHOLE-DATABASE open (P1.1) — keyed by an opaque per-store
// token (not the store's `key` string), because two store instances for the SAME key legitimately
// coexist for a moment (React StrictMode's double-invoked `useMemo`) and each must retry its own
// open independently rather than one silently overwriting the other's retry state.
interface HydrationRetry {
  readonly attempt: () => Promise<boolean>;
  inFlight: boolean;
}
const hydrationRetries = new Map<object, HydrationRetry>();
let hydrationRetryTimer: ReturnType<typeof setInterval> | null = null;

/** Test isolation only; production must never discard this queue. Re-exported only by ./testing. */
export function resetPersistenceRetryCoordinatorForTesting(): void {
  persistenceRetries.clear();
  if (persistenceRetryTimer !== null) clearInterval(persistenceRetryTimer);
  persistenceRetryTimer = null;
}

/** Test isolation only; production must never discard this queue. Re-exported only by ./testing. */
export function resetHydrationRetryCoordinatorForTesting(): void {
  hydrationRetries.clear();
  if (hydrationRetryTimer !== null) clearInterval(hydrationRetryTimer);
  hydrationRetryTimer = null;
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
      retry.resolve();
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

/** Persists one record, retrying indefinitely on failure. The returned promise resolves ONLY
 *  once the INSERT has actually succeeded — never on the first (possibly failing) attempt. */
function persistDurably(
  db: LocalDatabase,
  retryKey: string,
  params: readonly unknown[],
): Promise<void> {
  return new Promise<void>((resolve) => {
    const retry: PersistenceRetry = { db, params, resolve, inFlight: false };
    persistenceRetries.set(retryKey, retry);
    attemptPersistence(retryKey, retry);
  });
}

function stopHydrationTimerWhenIdle(): void {
  if (hydrationRetries.size !== 0 || hydrationRetryTimer === null) return;
  clearInterval(hydrationRetryTimer);
  hydrationRetryTimer = null;
}

function attemptHydrationRetry(token: object, retry: HydrationRetry): void {
  if (retry.inFlight) return;
  retry.inFlight = true;
  void retry.attempt().then((succeeded) => {
    retry.inFlight = false;
    if (succeeded) {
      hydrationRetries.delete(token);
      stopHydrationTimerWhenIdle();
    }
  });
}

function ensureHydrationRetryTimer(): void {
  if (hydrationRetryTimer !== null) return;
  hydrationRetryTimer = setInterval(() => {
    for (const [token, retry] of [...hydrationRetries]) {
      attemptHydrationRetry(token, retry);
    }
    stopHydrationTimerWhenIdle();
  }, PERSIST_RETRY_INTERVAL_MS);
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

interface PendingAppend<T> {
  readonly record: T;
  readonly resolve: () => void;
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
  // Not-yet-durable appends, in append order. Every record here is already reflected in
  // `snapshot` (append() updates that unconditionally) — this is bookkeeping for what still
  // needs to reach `capture_records`, flushed by whichever hydration attempt next succeeds.
  const pendingAppends: PendingAppend<T>[] = [];
  // `resolvedDb !== null` is the single source of truth for "safe to persist directly" — set
  // only once hydration has actually SUCCEEDED, so a failed attempt leaves it null and every
  // subsequent append() keeps buffering into `pendingAppends` until a retry succeeds.
  let resolvedDb: LocalDatabase | null = null;
  let nextSeq = 0;
  // `settled()`'s backing flag — flips true once the FIRST open-and-hydrate attempt finishes, on
  // EITHER outcome. A consumer reading several stores together (Outbox.tsx's flush, most of all)
  // needs this to tell "genuinely holds nothing" apart from "has not finished asking yet".
  let hasSettled = false;
  // `hydrationFailed()`'s backing flag. True while the store cannot currently vouch for its own
  // `all()` as a complete account — set on a failed open attempt, cleared again the moment a
  // RETRY succeeds (P1.1: recovery is real, not just "reported once and never revisited").
  let didHydrationFail = false;
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  const persist = (db: LocalDatabase, record: T, seq: number): Promise<void> =>
    persistDurably(db, `${key}\u0000${record.id}`, [
      record.id,
      key,
      farmId,
      seq,
      JSON.stringify(record),
    ]);

  /** One open-and-hydrate attempt. Returns whether it succeeded; never throws. */
  const tryOpenAndHydrate = async (): Promise<boolean> => {
    try {
      const db = await database();
      await migrateIfNeeded<T>(db, key, farmId, legacyStorage);
      const rows = await db.getAll<CaptureRecordRow>(
        'SELECT payload_json FROM capture_records WHERE store_key = ? ORDER BY seq ASC',
        [key],
      );
      // Tolerant per row, matching parseLegacyArray's philosophy — a single malformed row (e.g.
      // written by a future schema version this build does not understand) must not fail the
      // WHOLE hydration.
      const fromDb = rows.flatMap((row) => {
        try {
          return [JSON.parse(row.payload_json) as T];
        } catch {
          return [];
        }
      });

      // Flush whatever accumulated during every failed attempt so far (possibly zero, possibly
      // many) — merge, never replace. Snap the array before iterating so an append() arriving
      // WHILE this flush is in flight is not silently included twice.
      const flushed = pendingAppends.splice(0, pendingAppends.length);
      snapshot = [...fromDb, ...flushed.map((p) => p.record)];
      nextSeq = fromDb.length;
      for (const { record, resolve } of flushed) {
        const seq = nextSeq++;
        void persist(db, record, seq).then(resolve);
      }

      resolvedDb = db;
      didHydrationFail = false; // recovery, if this was not the first attempt
      hasSettled = true;
      notify();
      return true;
    } catch {
      // The database would not open, or migration/the SELECT itself threw. Anything appended
      // before or during this window is still correct in `snapshot` — append() updates it
      // unconditionally — only the DB-backed history is missing until a retry succeeds.
      hasSettled = true;
      didHydrationFail = true;
      notify();
      return false;
    }
  };

  const hydrationToken = {};
  void (async () => {
    const succeeded = await tryOpenAndHydrate();
    if (!succeeded) {
      hydrationRetries.set(hydrationToken, { attempt: tryOpenAndHydrate, inFlight: false });
      ensureHydrationRetryTimer();
    }
  })();

  return {
    all(): readonly T[] {
      return snapshot;
    },

    append(record: T): Promise<void> {
      snapshot = [...snapshot, record];
      notify();
      if (resolvedDb !== null) {
        return persist(resolvedDb, record, nextSeq++);
      }
      return new Promise<void>((resolve) => {
        pendingAppends.push({ record, resolve });
      });
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
      // Retry commands (both coordinators) live at application scope and intentionally survive
      // this instance: clearing them here would lose a capture accepted before a farm switch, or
      // strand one made during an open failure that has not yet recovered.
      listeners.clear();
    },
  };
}
