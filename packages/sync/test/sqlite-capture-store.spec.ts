/**
 * The SQLite/OPFS-backed capture store (phase-checklists.md 3c) — exercised against
 * `createFakeLocalDatabase` (`@werf/sync/testing`), not a mock of our own code, the same
 * "fake, not a mock" philosophy `capture-store.spec.ts`'s `memoryStorage()` uses. A REAL
 * `PowerSyncDatabase` opens real OPFS/Worker/WASM machinery that hangs forever under plain Node
 * (local-database.ts's own header) and is unreliable across more than one render under jsdom
 * (`apps/web/src/sync/local-db.ts`'s tests mock this same seam for exactly that reason) — a real
 * open is Playwright's job (`apps/web/e2e/capture-migration.spec.ts`). This spec proves the STORE
 * LOGIC is right: hydration merges rather than replaces, migration is atomic, idempotent, and
 * race-safe under concurrent construction, and the `useSyncExternalStore` snapshot-identity
 * contract holds.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  createSqliteCaptureStore,
  PERSIST_RETRY_INTERVAL_MS,
  type SessionStorageLike,
} from '../src/index';
import { createFakeLocalDatabase } from '../src/testing';
import type { LocalDatabase } from '../src/local-database';

interface Animal {
  id: string;
  species: string;
}

/** An in-memory stand-in for localStorage — the migration's read-only source. */
function memoryStorage(initial: Record<string, string> = {}): SessionStorageLike {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

/** Resolves once, after `store`'s hydration IIFE has run its post-DB-open notify(). */
function waitForHydration(store: { subscribe(listener: () => void): () => void }): Promise<void> {
  return new Promise((resolve) => {
    const unsubscribe = store.subscribe(() => {
      unsubscribe();
      resolve();
    });
  });
}

describe('the SQLite-backed capture store', () => {
  it('migrates a legacy array once, and a second store on the same key does not re-read it', async () => {
    const db = createFakeLocalDatabase() as unknown as LocalDatabase;
    const legacyStorage = memoryStorage({
      'herd:farm-a': JSON.stringify([{ id: '1', species: 'cattle' }]),
    });
    const getItemSpy = vi.spyOn(legacyStorage, 'getItem');

    const first = createSqliteCaptureStore<Animal>({
      database: Promise.resolve(db),
      key: 'herd:farm-a',
      legacyStorage,
    });
    await waitForHydration(first);
    expect(first.all()).toEqual([{ id: '1', species: 'cattle' }]);
    expect(getItemSpy).toHaveBeenCalledTimes(1);

    getItemSpy.mockClear();
    const second = createSqliteCaptureStore<Animal>({
      database: Promise.resolve(db),
      key: 'herd:farm-a',
      legacyStorage,
    });
    await waitForHydration(second);

    expect(second.all()).toEqual([{ id: '1', species: 'cattle' }]);
    expect(getItemSpy).not.toHaveBeenCalled(); // marker present — legacy storage never consulted again
  });

  it('does not lose or reorder an append() made during the hydration window', async () => {
    const db = createFakeLocalDatabase() as unknown as LocalDatabase;
    const legacyStorage = memoryStorage({
      'herd:farm-a': JSON.stringify([{ id: 'legacy-1', species: 'cattle' }]),
    });
    let resolveDb!: (db: LocalDatabase) => void;
    const dbPromise = new Promise<LocalDatabase>((resolve) => {
      resolveDb = resolve;
    });

    const store = createSqliteCaptureStore<Animal>({
      database: dbPromise,
      key: 'herd:farm-a',
      legacyStorage,
    });

    // Appended before the database promise has even resolved — the whole hydration window.
    store.append({ id: 'live-1', species: 'sheep' });
    expect(store.all()).toEqual([{ id: 'live-1', species: 'sheep' }]);

    const hydrated = waitForHydration(store);
    resolveDb(db);
    await hydrated;

    // Legacy rows first (capture order the localStorage array already held), then the append
    // made during the hydration window — never dropped, never reordered ahead of history.
    expect(store.all().map((a) => a.id)).toEqual(['legacy-1', 'live-1']);

    const rows = await db.getAll<{ payload_json: string }>(
      'SELECT payload_json FROM capture_records WHERE store_key = ? ORDER BY seq ASC',
      ['herd:farm-a'],
    );
    expect(rows.map((row) => (JSON.parse(row.payload_json) as Animal).id)).toEqual([
      'legacy-1',
      'live-1',
    ]);
  });

  it('continues appending in order after hydration completes', async () => {
    const db = createFakeLocalDatabase() as unknown as LocalDatabase;
    const legacyStorage = memoryStorage();
    const store = createSqliteCaptureStore<Animal>({
      database: Promise.resolve(db),
      key: 'herd:farm-a',
      legacyStorage,
    });
    await waitForHydration(store);

    store.append({ id: '1', species: 'cattle' });
    store.append({ id: '2', species: 'sheep' });
    await Promise.resolve();
    await Promise.resolve();

    expect(store.all().map((a) => a.id)).toEqual(['1', '2']);
    const rows = await db.getAll<{ payload_json: string }>(
      'SELECT payload_json FROM capture_records WHERE store_key = ? ORDER BY seq ASC',
      ['herd:farm-a'],
    );
    expect(rows.map((row) => (JSON.parse(row.payload_json) as Animal).id)).toEqual(['1', '2']);
  });

  it('skips one corrupt DB-resident row rather than failing the whole hydration (sync-auditor Finding 1, 2026-08-09)', async () => {
    // Distinct from the legacy-localStorage corruption case below: this is a row ALREADY IN
    // capture_records (e.g. written by a future schema version this build cannot parse), found
    // on a boot where the migration marker is already committed — so before this fix, the ONE bad
    // row threw inside the hydration IIFE, the store's `catch` swallowed it as a "failure", and
    // because the marker already existed, EVERY future boot re-threw on the identical row,
    // forever: a permanent, unrecoverable read, and every append() made after it silently stopped
    // being durable (resolvedDb never got set). Tolerating the one bad row, like
    // parseLegacyArray() already tolerates a corrupt legacy value, keeps hydration succeeding for
    // everything else that IS readable, and keeps the store writable afterward.
    const db = createFakeLocalDatabase() as unknown as LocalDatabase;
    await db.execute(
      'INSERT INTO capture_migrations (id, migrated_at, record_count) VALUES (?, ?, ?)',
      ['herd:farm-a', new Date(0).toISOString(), 2],
    );
    await db.execute(
      'INSERT OR REPLACE INTO capture_records (id, store_key, farm_id, seq, payload_json) VALUES (?, ?, ?, ?, ?)',
      ['corrupt-1', 'herd:farm-a', 'farm-a', 0, '{ not valid json'],
    );
    await db.execute(
      'INSERT OR REPLACE INTO capture_records (id, store_key, farm_id, seq, payload_json) VALUES (?, ?, ?, ?, ?)',
      ['good-1', 'herd:farm-a', 'farm-a', 1, JSON.stringify({ id: 'good-1', species: 'cattle' })],
    );

    const store = createSqliteCaptureStore<Animal>({
      database: Promise.resolve(db),
      key: 'herd:farm-a',
      legacyStorage: memoryStorage(),
    });
    await waitForHydration(store);

    // The good row survived; the corrupt one was skipped, not thrown over the whole hydration.
    expect(store.all()).toEqual([{ id: 'good-1', species: 'cattle' }]);
    // And — the load-bearing part — this was NOT treated as a hydration failure: `resolvedDb` got
    // set, so the store is durable going forward, and a consumer reading multiple stores together
    // (Outbox.tsx) can trust this store's `all()` as a real, confirmed account.
    expect(store.hydrationFailed()).toBe(false);
    expect(store.settled()).toBe(true);

    // Proof the store is actually writable afterward, not merely reporting success: a fresh
    // append reaches the database, not just the in-memory snapshot.
    store.append({ id: 'new-1', species: 'sheep' });
    await Promise.resolve();
    await Promise.resolve();
    const rows = await db.getAll<{ payload_json: string }>(
      'SELECT payload_json FROM capture_records WHERE store_key = ? ORDER BY seq ASC',
      ['herd:farm-a'],
    );
    expect(rows.map((row) => row.payload_json)).toContain(
      JSON.stringify({ id: 'new-1', species: 'sheep' }),
    );
  });

  it('migrates a corrupt or missing legacy value as zero rows plus a committed marker, not a crash', async () => {
    const db = createFakeLocalDatabase() as unknown as LocalDatabase;
    const legacyStorage = memoryStorage({ 'herd:farm-a': '{ not json' });

    const store = createSqliteCaptureStore<Animal>({
      database: Promise.resolve(db),
      key: 'herd:farm-a',
      legacyStorage,
    });
    await waitForHydration(store);

    expect(store.all()).toEqual([]);
    const marker = await db.getOptional<{ record_count: number }>(
      'SELECT id FROM capture_migrations WHERE id = ?',
      ['herd:farm-a'],
    );
    expect(marker?.record_count).toBe(0);
  });

  it('an interrupted migration leaves neither rows nor a marker committed, and retries cleanly', async () => {
    const db = createFakeLocalDatabase();
    const legacyStorage = memoryStorage({
      'herd:farm-a': JSON.stringify([{ id: '1', species: 'cattle' }]),
    });
    db.failNextTransactionAfterInserts();
    const typedDb = db as unknown as LocalDatabase;

    const interrupted = createSqliteCaptureStore<Animal>({
      database: Promise.resolve(typedDb),
      key: 'herd:farm-a',
      legacyStorage,
    });
    await waitForHydration(interrupted);

    // The transaction rolled back — nothing committed, so hydration's SELECT reads nothing back,
    // and the in-memory snapshot for a fresh store is empty (no local appends were made either).
    expect(interrupted.all()).toEqual([]);
    const markerAfterFailure = await typedDb.getOptional(
      'SELECT id FROM capture_migrations WHERE id = ?',
      ['herd:farm-a'],
    );
    expect(markerAfterFailure).toBeNull();

    // Retry — legacy storage was never touched by the failed attempt, so it is still there.
    const retried = createSqliteCaptureStore<Animal>({
      database: Promise.resolve(typedDb),
      key: 'herd:farm-a',
      legacyStorage,
    });
    await waitForHydration(retried);

    expect(retried.all()).toEqual([{ id: '1', species: 'cattle' }]);
  });

  it('two stores constructed concurrently on the same key both migrate correctly, exactly once', async () => {
    // The React StrictMode shape: a provider's useMemo double-invoked in development spins up
    // TWO createSqliteCaptureStore instances for the identical key before either has migrated
    // anything — a TOCTOU race the marker check alone (outside a transaction) cannot close.
    // sqlite-capture-store.ts's `migrateIfNeeded` re-checks the marker INSIDE the write
    // transaction specifically so the loser sees the winner's committed marker and skips instead
    // of hydrating empty forever. This fake's writeTransaction serializes concurrent callers the
    // same way the real engine's exclusive write lock does (see testing.ts's `writeQueue`), so
    // this test actually exercises that serialization, not just sequential calls.
    const db = createFakeLocalDatabase() as unknown as LocalDatabase;
    const legacyStorage = memoryStorage({
      'herd:farm-a': JSON.stringify([{ id: '1', species: 'cattle' }]),
    });

    const first = createSqliteCaptureStore<Animal>({
      database: Promise.resolve(db),
      key: 'herd:farm-a',
      legacyStorage,
    });
    const second = createSqliteCaptureStore<Animal>({
      database: Promise.resolve(db),
      key: 'herd:farm-a',
      legacyStorage,
    });

    await Promise.all([waitForHydration(first), waitForHydration(second)]);

    expect(first.all()).toEqual([{ id: '1', species: 'cattle' }]);
    expect(second.all()).toEqual([{ id: '1', species: 'cattle' }]);
    const rows = await db.getAll<{ payload_json: string }>(
      'SELECT payload_json FROM capture_records WHERE store_key = ? ORDER BY seq ASC',
      ['herd:farm-a'],
    );
    // Exactly one copy — the loser's transaction returned early rather than re-inserting.
    expect(rows).toHaveLength(1);
  });

  it('gives each subscriber the same stable snapshot until the next real change', async () => {
    const db = createFakeLocalDatabase() as unknown as LocalDatabase;
    const store = createSqliteCaptureStore<Animal>({
      database: Promise.resolve(db),
      key: 'herd:farm-a',
      legacyStorage: memoryStorage(),
    });
    await waitForHydration(store);

    const before = store.all();
    expect(store.all()).toBe(before);

    store.append({ id: '1', species: 'cattle' });
    expect(store.all()).not.toBe(before);
  });

  it('does not lose the in-memory capture when persistence fails', async () => {
    const db = createFakeLocalDatabase();
    // Every execute() after hydration rejects — quota exceeded, DB closed, etc.
    db.execute = async () => {
      throw new Error('QuotaExceededError');
    };
    const store = createSqliteCaptureStore<Animal>({
      database: Promise.resolve(db as unknown as LocalDatabase),
      key: 'herd:farm-a',
      legacyStorage: memoryStorage(),
    });
    await waitForHydration(store);

    expect(() => store.append({ id: '1', species: 'cattle' })).not.toThrow();
    expect(store.all()).toEqual([{ id: '1', species: 'cattle' }]);
  });

  // ⭐ phase-checklists.md 3f: "the write queue is never bounded and never evicted." A
  // QuotaExceededError from `execute()` is exactly the storage-pressure case that line names —
  // and the test above only proves the record survives IN THIS SESSION's memory. It says nothing
  // about the reboot db.md's own words describe: "A farmer offline for six weeks... A browser
  // restart resumes it." A capture that was shown as saved and then genuinely never reached
  // durable storage, followed by a browser restart, is a lost record wearing the append-order
  // guarantee's clothes.
  it('⭐ 3f: a capture that failed to persist under quota pressure is retried and durable before the app ever restarts', async () => {
    vi.useFakeTimers();
    try {
      const db = createFakeLocalDatabase();
      let quotaExceeded = true;
      const realExecute = db.execute.bind(db);
      db.execute = async (sql: string, params?: readonly unknown[]) => {
        if (quotaExceeded && sql.startsWith('INSERT OR REPLACE INTO capture_records')) {
          throw new Error('QuotaExceededError');
        }
        return realExecute(sql, params);
      };
      const typedDb = db as unknown as LocalDatabase;

      const first = createSqliteCaptureStore<Animal>({
        database: Promise.resolve(typedDb),
        key: 'herd:farm-a',
        legacyStorage: memoryStorage(),
      });
      await waitForHydration(first);

      // The farmer's capture: shown as saved (FR-009), but storage was full at the moment it
      // tried to reach durable SQLite.
      first.append({ id: 'never-persisted', species: 'cattle' });
      await vi.advanceTimersByTimeAsync(0);
      expect(first.all()).toEqual([{ id: 'never-persisted', species: 'cattle' }]);
      expect(
        await typedDb.getAll<{ payload_json: string }>(
          'SELECT payload_json FROM capture_records WHERE store_key = ?',
          ['herd:farm-a'],
        ),
      ).toEqual([]); // not yet durable — this is the state a restart right now would lose

      // Quota pressure clears while the app is still open — the retention window degrading the
      // READ set (3f's other half) frees space, or the farmer deletes photos elsewhere on the
      // device. The store's own retry loop, not a new capture or a page reload, is what notices.
      quotaExceeded = false;
      await vi.advanceTimersByTimeAsync(PERSIST_RETRY_INTERVAL_MS);

      const rows = await typedDb.getAll<{ payload_json: string }>(
        'SELECT payload_json FROM capture_records WHERE store_key = ?',
        ['herd:farm-a'],
      );
      expect(rows.map((row) => (JSON.parse(row.payload_json) as Animal).id)).toEqual([
        'never-persisted',
      ]);

      // The restart, now that the write is genuinely durable: a SECOND store instance over the
      // SAME backing, exactly as a fresh page load re-hydrates from OPFS. Nothing in the first
      // store's in-memory state carries over.
      const secondBoot = createSqliteCaptureStore<Animal>({
        database: Promise.resolve(typedDb),
        key: 'herd:farm-a',
        legacyStorage: memoryStorage(),
      });
      await waitForHydration(secondBoot);
      expect(secondBoot.all()).toEqual([{ id: 'never-persisted', species: 'cattle' }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('settled() is false until hydration finishes, true once it succeeds', async () => {
    let resolveDb!: (db: LocalDatabase) => void;
    const dbPromise = new Promise<LocalDatabase>((resolve) => {
      resolveDb = resolve;
    });
    const store = createSqliteCaptureStore<Animal>({
      database: dbPromise,
      key: 'herd:farm-a',
      legacyStorage: memoryStorage(),
    });

    expect(store.settled()).toBe(false);
    const hydrated = waitForHydration(store);
    resolveDb(createFakeLocalDatabase() as unknown as LocalDatabase);
    await hydrated;

    expect(store.settled()).toBe(true);
  });

  it('hydrationFailed() stays false on a normal, successful hydration', async () => {
    const store = createSqliteCaptureStore<Animal>({
      database: Promise.resolve(createFakeLocalDatabase() as unknown as LocalDatabase),
      key: 'herd:farm-a',
      legacyStorage: memoryStorage(),
    });

    expect(store.hydrationFailed()).toBe(false); // false before settling too — never a false alarm
    await waitForHydration(store);

    expect(store.hydrationFailed()).toBe(false);
  });

  it('settled() also flips true on a FAILED hydration — a waiter must not hang forever', async () => {
    // A consumer waiting on settled() to decide whether it is safe to act on this store's `all()`
    // (Outbox.tsx's flush, most of all) must eventually get an answer even when hydration itself
    // never succeeds — otherwise a store that can never open strands every OTHER store's flush
    // behind it forever, which is worse than acting on a store that settled empty.
    const db = createFakeLocalDatabase();
    db.getOptional = async () => {
      throw new Error('simulated: database will not open');
    };
    const store = createSqliteCaptureStore<Animal>({
      database: Promise.resolve(db as unknown as LocalDatabase),
      key: 'herd:farm-a',
      legacyStorage: memoryStorage(),
    });

    expect(store.settled()).toBe(false);
    await waitForHydration(store);

    expect(store.settled()).toBe(true);
    expect(store.all()).toEqual([]); // no DB-backed history was ever confirmed
    // ⭐ sync-auditor Finding 1 (2026-08-09): settled-but-empty here must be distinguishable from
    // settled-and-CONFIRMED-empty — a consumer reading `hydrationFailed()` (Outbox.tsx's flush,
    // most of all) must not treat this store's `[]` as evidence the farm holds none of these.
    expect(store.hydrationFailed()).toBe(true);
  });
});
