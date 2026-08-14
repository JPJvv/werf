/**
 * A fake `LocalDatabase` for tests that exercise `createSqliteCaptureStore` (and anything else
 * that talks to the local-only capture tables) without opening a real `PowerSyncDatabase` — which
 * opens real OPFS/Worker/WASM machinery that hangs forever under plain Node and is unreliable
 * under jsdom for anything beyond a single render (see this file's own `writeTransaction`
 * comment for the specific failure mode that makes "just let jsdom construct a real one" wrong
 * for component tests, not merely slow).
 *
 * Not a mock of our own code — a narrow, hand-written stand-in for the exact `LocalDatabase`
 * surface `sqlite-capture-store.ts` calls, the same philosophy as `capture-store.spec.ts`'s
 * `memoryStorage()`. It is NOT a general SQL engine: it recognizes only the specific queries this
 * package issues and throws on anything else, so a future query shape this fake does not know
 * about fails loudly in a test rather than silently returning nothing.
 *
 * Not exported from the package index — this is `@werf/sync/testing`, kept off the runtime
 * import graph so a production bundle can never pull it in (the `@werf/db/testing` precedent).
 */

export {
  resetPersistenceRetryCoordinatorForTesting,
  resetHydrationRetryCoordinatorForTesting,
} from './sqlite-capture-store';

interface FakeRecordRow {
  id: string;
  store_key: string;
  farm_id: string;
  seq: number;
  payload_json: string;
}

interface FakeMigrationRow {
  id: string;
  migrated_at: string;
  record_count: number;
}

function applyExecute(
  targetRecords: Map<string, FakeRecordRow>,
  targetMigrations: Map<string, FakeMigrationRow>,
  sql: string,
  params: readonly unknown[],
): void {
  if (sql.startsWith('INSERT OR REPLACE INTO capture_records')) {
    const [id, store_key, farm_id, seq, payload_json] = params as [
      string,
      string,
      string,
      number,
      string,
    ];
    targetRecords.set(id, { id, store_key, farm_id, seq, payload_json });
  } else if (sql.startsWith('INSERT INTO capture_migrations')) {
    const [id, migrated_at, record_count] = params as [string, string, number];
    // Real SQLite's PRIMARY KEY constraint on `capture_migrations.id` (the store_key) throws on
    // a duplicate insert — this is a plain INSERT, not INSERT OR REPLACE, deliberately (see
    // sqlite-capture-store.ts's `migrateIfNeeded`). A fake that let this through silently would
    // not have caught the TOCTOU race that constraint is the last line of defence against.
    if (targetMigrations.has(id)) {
      throw new Error(`UNIQUE constraint failed: capture_migrations.id ("${id}")`);
    }
    targetMigrations.set(id, { id, migrated_at, record_count });
  } else {
    throw new Error(`fake database: unrecognized execute() — ${sql}`);
  }
}

/**
 * The narrow slice of `LocalDatabase` this fake implements — only what `sqlite-capture-store.ts`
 * actually calls, typed loosely (`unknown` for `tx`/params) rather than importing the real SDK's
 * types, so this file never pulls `@powersync/web` into a test's module graph. Callers that need
 * the real `LocalDatabase` type (to satisfy `SqliteCaptureStoreOptions.database`) cast explicitly
 * — the same "narrow fake, cast at the boundary" shape `capture-store.spec.ts`'s `memoryStorage()`
 * uses against `SessionStorageLike`.
 */
/** Every canonical (server-owned, down-synced) table a `HydratedTableStore` reads — `mobs`/
 *  `events` from the original 3e slice, `animals`/`animal_identifiers`/`theft_incidents` added for
 *  the animals/moves/health/identifiers/theft/weights/breeding hydration slice, `land_units`
 *  added for the land hydration slice (2026-08-14), and `theft_incident_animals` added once
 *  migration 0025 gave it a surrogate id to sync on (issue #10, P2.6) — boundary walks stay on
 *  `events` (`type = 'boundary_walk'`), narrowed the same way tallies/moves/health already are. */
export type CanonicalTable =
  | 'mobs'
  | 'events'
  | 'animals'
  | 'animal_identifiers'
  | 'theft_incidents'
  | 'theft_incident_animals'
  | 'land_units';

export interface FakeLocalDatabase {
  init(): Promise<void>;
  getOptional<T>(sql: string, params?: readonly unknown[]): Promise<T | null>;
  getAll<T>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  execute(sql: string, params?: readonly unknown[]): Promise<unknown>;
  writeTransaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T>;
  /**
   * The narrow slice of `watch()` a `HydratedTableStore` needs: recognizes a `SELECT ... FROM
   * <table> WHERE farm_id = ? ... AND deleted_at IS NULL` against any `CanonicalTable`, farm-scoped
   * by `params[0]`. For an `events` query, the row's `type` is additionally checked against
   * whatever `type = '...'` / `type IN (...)` clause THIS watcher's own SQL carries — parsed once
   * at `watch()` time (`eventTypesFor`) — not a single hard-coded type, since `events` now backs
   * several distinct hydrated stores (tallies, lifecycle, moves, health, weights, breeding), each
   * narrowed to its own type set. Fires `onResult` once immediately (mirroring the real SDK's
   * `triggerImmediate: true`) and again every time a matching row is seeded via
   * `hydrateRow`/`hydrateRows` — the fake's stand-in for a down-sync delivery landing.
   */
  watch(
    sql: string,
    params: readonly unknown[],
    handler: { onResult: (result: unknown) => void; onError?: (error: Error) => void },
    /** `signal`, honoured: aborting it deregisters the watcher — the fake's stand-in for the real
     *  SDK's `SQLOnChangeOptions.signal`, so a store's `close()` is actually testable. */
    options?: { signal?: AbortSignal },
  ): void;
  /** True after `connect()` resolves and until `disconnect()` is called. Mirrors the real SDK's
   *  `connected` getter narrowly enough for a lifecycle test to assert against. */
  readonly connected: boolean;
  /** Records every connector `connect()` was called with, so a test can assert `getAccessToken`
   *  was wired to the live session rather than a stale closure. */
  readonly connectCalls: number;
  connect(connector: unknown): Promise<void>;
  disconnect(): Promise<void>;
  /**
   * Simulates a down-sync delivery: inserts/updates one row in the given canonical table and
   * re-fires every `watch()` registered against it whose farm-scope (and, for `events`, type set)
   * matches. Never touches `capture_records` — a hydrated row and a locally-captured one are
   * always distinct rows in this fake, exactly as they are two distinct tables in the real schema.
   */
  hydrateRow(table: CanonicalTable, row: Record<string, unknown>): void;
  /** `hydrateRow`, plural — the common case of a device receiving more than one row per delivery. */
  hydrateRows(table: CanonicalTable, rows: readonly Record<string, unknown>[]): void;
  /** Every later `watch()` against this table's `onError` instead of `onResult`, and any watcher
   *  already registered against it re-fires into `onError` immediately — simulating the local
   *  query itself failing, not a single malformed row (see `HydratedTableStore`'s own header). */
  failWatch(table: CanonicalTable): void;
  /** The NEXT writeTransaction's callback runs to completion, then the "commit" throws instead —
   *  simulating a browser kill after every insert but before the transaction lands. */
  failNextTransactionAfterInserts(): void;
  /**
   * Suspends every getOptional()/getAll() call naming this store_key until the returned function
   * is called — lets a test pin ONE capture store's hydration open on demand while every other
   * store on the same fake db hydrates and settles normally, instead of relying on whatever
   * interleaving `Promise.resolve()` microtask ordering happens to produce for a given legacy-data
   * shape (see `apps/web/src/sync/Outbox.test.tsx`'s "the flush waits for every store" test, which
   * exists precisely because that natural ordering is not a promise, only an observation).
   */
  holdHydrationFor(storeKey: string): () => void;
  /**
   * Every getOptional()/getAll() call naming this store_key throws from this point on —
   * simulating the database genuinely refusing to open or read this ONE store's rows (not the
   * whole fake db), the way a real corrupted OPFS file or a schema the running build cannot read
   * would. Lets a test target `sqlite-capture-store.ts`'s `hydrationFailed()` signal at a single
   * store while every OTHER store on the same fake db hydrates and settles normally (see
   * `apps/web/src/sync/Outbox.test.tsx`'s hydration-failure tests) — a targeted failure a test
   * cannot get by overriding `getOptional`/`getAll` wholesale, which would fail every store.
   */
  failHydrationFor(storeKey: string): void;
}

/**
 * Creates a fresh, isolated fake `LocalDatabase` — one instance per call, so per-test isolation
 * (a fresh `vi.mock` return value, or a fresh instance for a scenario that needs its own history)
 * never shares state with any other test through a leaked singleton.
 */
/** One registered `watch()` call: which canonical table, this watcher's own farm-scope param
 *  (params[0] on every query this fake recognizes), the `events`-only type narrowing this
 *  watcher's SQL carries (null for every non-`events` table, which needs none), and the handler
 *  to re-fire. */
interface CanonicalWatcher {
  readonly table: CanonicalTable;
  readonly farmId: string;
  readonly eventTypes: ReadonlySet<string> | null;
  readonly onResult: (result: unknown) => void;
  readonly onError?: ((error: Error) => void) | undefined;
}

/**
 * Parses the `type = '...'` or `type IN (...)` clause out of an `events` query — each hydrated
 * store built on `events` (tallies, lifecycle, moves, health, weights, breeding) narrows to its
 * own type set, and this fake has to tell them apart to avoid firing a lifecycle watcher's
 * `onResult` for a hydrated tally. Not general SQL parsing: this package only ever issues one of
 * these two shapes, quoted single-type or a comma-separated quoted list, so a regex on the literal
 * is exact rather than an approximation. Throws on an `events` query with neither shape, same
 * "fail loud on an unrecognized query" discipline as the rest of this fake.
 */
function eventTypesFor(sql: string): ReadonlySet<string> | null {
  if (!sql.includes('FROM events')) return null;
  const single = /type\s*=\s*'(\w+)'/.exec(sql);
  if (single) return new Set([single[1] as string]);
  const list = /type\s+IN\s*\(([^)]+)\)/.exec(sql);
  if (list) {
    return new Set((list[1] as string).split(',').map((s) => s.trim().replace(/^'|'$/g, '')));
  }
  throw new Error(`fake database: events query with no recognizable type filter — ${sql}`);
}

/** Matches a canonical row against one watcher's farm scope, `deleted_at IS NULL`, and — for
 *  `events` — this watcher's own parsed type set — kept in one place so the INITIAL fire and
 *  every later re-fire filter identically. */
function matchesWatcher(w: CanonicalWatcher, row: Record<string, unknown>): boolean {
  if (row['farm_id'] !== w.farmId) return false;
  if (row['deleted_at'] != null) return false;
  if (w.eventTypes !== null && !w.eventTypes.has(row['type'] as string)) return false;
  return true;
}

export function createFakeLocalDatabase(): FakeLocalDatabase {
  let records = new Map<string, FakeRecordRow>();
  let migrations = new Map<string, FakeMigrationRow>();
  let failNext = false;
  const held = new Map<string, Promise<void>>();
  const failing = new Set<string>();
  // A real writeLock is exclusive — concurrent writeTransaction callers queue, they never
  // interleave. Emulated here by chaining onto the tail of a promise queue, so a test that
  // constructs two stores "at once" (React StrictMode's double-invoked useMemo, in practice)
  // observes the same serialization the real engine provides — the property the marker-race fix
  // in sqlite-capture-store.ts depends on.
  let writeQueue: Promise<unknown> = Promise.resolve();

  // Canonical down-synced tables (phase-checklists.md 3e, extended by the animals/moves/health/
  // identifiers/theft/weights/breeding slice) — deliberately separate maps from `records`/
  // `migrations` above, which back `capture_records`/`capture_migrations` only. A hydrated row and
  // a locally-captured one are two different tables in the real schema and stay two different
  // Maps here.
  const canonicalTables: Record<CanonicalTable, Map<string, Record<string, unknown>>> = {
    mobs: new Map(),
    events: new Map(),
    animals: new Map(),
    animal_identifiers: new Map(),
    theft_incidents: new Map(),
    theft_incident_animals: new Map(),
    land_units: new Map(),
  };
  const canonicalTable = (table: CanonicalTable) => canonicalTables[table];
  const watchers: CanonicalWatcher[] = [];
  const failingWatch = new Set<CanonicalTable>();
  let connected = false;
  let connectCalls = 0;

  const fireWatcher = (w: CanonicalWatcher): void => {
    if (failingWatch.has(w.table)) {
      w.onError?.(new Error(`fake database: simulated watch failure for "${w.table}"`));
      return;
    }
    const rows = [...canonicalTable(w.table).values()].filter((row) => matchesWatcher(w, row));
    w.onResult({ array: rows });
  };

  const fake = {
    async init(): Promise<void> {},

    async getOptional(sql: string, params: readonly unknown[] = []) {
      if (sql.startsWith('SELECT id FROM capture_migrations')) {
        const [key] = params as [string];
        if (failing.has(key)) {
          throw new Error(`fake database: simulated hydration failure for "${key}"`);
        }
        await held.get(key);
        return migrations.get(key) ?? null;
      }
      throw new Error(`fake database: unrecognized getOptional() — ${sql}`);
    },

    async getAll(sql: string, params: readonly unknown[] = []) {
      if (sql.startsWith('SELECT payload_json FROM capture_records')) {
        const [key] = params as [string];
        if (failing.has(key)) {
          throw new Error(`fake database: simulated hydration failure for "${key}"`);
        }
        await held.get(key);
        return [...records.values()]
          .filter((row) => row.store_key === key)
          .sort((a, b) => a.seq - b.seq)
          .map((row) => ({ payload_json: row.payload_json }));
      }
      throw new Error(`fake database: unrecognized getAll() — ${sql}`);
    },

    async execute(sql: string, params: readonly unknown[] = []) {
      applyExecute(records, migrations, sql, params);
      return {} as never;
    },

    writeTransaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T> {
      const run = writeQueue.then(async () => {
        const draftRecords = new Map(records);
        const draftMigrations = new Map(migrations);
        const tx = {
          getOptional: async (sql: string, params: readonly unknown[] = []) => {
            if (sql.startsWith('SELECT id FROM capture_migrations')) {
              const [key] = params as [string];
              return draftMigrations.get(key) ?? null;
            }
            throw new Error(`fake database: unrecognized tx.getOptional() — ${sql}`);
          },
          execute: async (sql: string, params: readonly unknown[] = []) => {
            applyExecute(draftRecords, draftMigrations, sql, params);
            return {} as never;
          },
        };
        const result = await callback(tx);
        if (failNext) {
          failNext = false;
          throw new Error('simulated interruption after inserts, before commit');
        }
        records = draftRecords;
        migrations = draftMigrations;
        return result;
      });
      // Do not let one failed transaction poison the queue for the next caller.
      writeQueue = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },

    failNextTransactionAfterInserts(): void {
      failNext = true;
    },

    holdHydrationFor(storeKey: string): () => void {
      let release!: () => void;
      held.set(
        storeKey,
        new Promise((resolve) => {
          release = resolve;
        }),
      );
      return () => {
        release();
        held.delete(storeKey);
      };
    },

    failHydrationFor(storeKey: string): void {
      failing.add(storeKey);
    },

    watch(
      sql: string,
      params: readonly unknown[] = [],
      handler: { onResult: (result: unknown) => void; onError?: (error: Error) => void },
      options?: { signal?: AbortSignal },
    ): void {
      // Order matters only in that each check is a distinct, non-overlapping substring — `FROM
      // animal_identifiers` never matches `FROM animals` (different characters immediately after
      // "FROM animal"), and `FROM theft_incident_animals` never matches `FROM theft_incidents`
      // (an underscore, not an "s", follows "theft_incident" in the former) — so there is no
      // ambiguity to resolve by ordering.
      const table: CanonicalTable | undefined = sql.includes('FROM mobs')
        ? 'mobs'
        : sql.includes('FROM events')
          ? 'events'
          : sql.includes('FROM animal_identifiers')
            ? 'animal_identifiers'
            : sql.includes('FROM animals')
              ? 'animals'
              : sql.includes('FROM theft_incident_animals')
                ? 'theft_incident_animals'
                : sql.includes('FROM theft_incidents')
                  ? 'theft_incidents'
                  : sql.includes('FROM land_units')
                    ? 'land_units'
                    : undefined;
      if (table === undefined) {
        throw new Error(`fake database: unrecognized watch() — ${sql}`);
      }
      const [farmId] = params as [string];
      const watcher: CanonicalWatcher = {
        table,
        farmId,
        eventTypes: eventTypesFor(sql),
        onResult: handler.onResult,
        onError: handler.onError,
      };
      watchers.push(watcher);
      fireWatcher(watcher);
      options?.signal?.addEventListener('abort', () => {
        const index = watchers.indexOf(watcher);
        if (index !== -1) watchers.splice(index, 1);
      });
    },

    get connected(): boolean {
      return connected;
    },

    get connectCalls(): number {
      return connectCalls;
    },

    async connect(): Promise<void> {
      connectCalls += 1;
      connected = true;
    },

    async disconnect(): Promise<void> {
      connected = false;
    },

    hydrateRow(table: CanonicalTable, row: Record<string, unknown>): void {
      fake.hydrateRows(table, [row]);
    },

    hydrateRows(table: CanonicalTable, rows: readonly Record<string, unknown>[]): void {
      for (const row of rows) {
        const id = row['id'];
        if (typeof id !== 'string') {
          throw new Error(
            `fake database: hydrateRow requires a string "id" — ${JSON.stringify(row)}`,
          );
        }
        canonicalTable(table).set(id, row);
      }
      for (const w of watchers) {
        if (w.table === table) fireWatcher(w);
      }
    },

    failWatch(table: CanonicalTable): void {
      failingWatch.add(table);
      for (const w of watchers) {
        if (w.table === table) fireWatcher(w);
      }
    },
  };

  // The fake's methods are deliberately non-generic (they only ever return the one row shape
  // each recognized query produces); this cast asserts the narrow, controlled query surface this
  // package actually issues, not a real generic SQL result.
  return fake as FakeLocalDatabase;
}

/**
 * A fake `BlobStore` (phase-checklists.md 3i(c)) — a plain in-memory `Map`, since `Blob` itself
 * already works under jsdom/Node (unlike OPFS, which does not exist there — see
 * `opfs-blob-store.ts`'s header). Not a mock of our own code: the real port has three methods and
 * this implements all three against a `Map` rather than intercepting calls to the real adapter.
 */
export function createInMemoryBlobStore(): FakeBlobStore {
  const blobs = new Map<string, Blob>();
  return {
    async put(key, blob) {
      blobs.set(key, blob);
    },
    async get(key) {
      return blobs.get(key) ?? null;
    },
    async delete(key) {
      blobs.delete(key);
    },
    has(key: string): boolean {
      return blobs.has(key);
    },
  };
}

/** `BlobStore` plus one test-only escape hatch: asserting a blob was actually released, without
 *  every caller needing to `get()` and check `null` for what is really a presence question. */
export interface FakeBlobStore {
  put(key: string, blob: Blob): Promise<void>;
  get(key: string): Promise<Blob | null>;
  delete(key: string): Promise<void>;
  has(key: string): boolean;
}
