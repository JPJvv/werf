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
import { createSqliteCaptureStore, type SessionStorageLike } from '../src/index';
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
  });
});
