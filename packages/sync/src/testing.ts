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
export interface FakeLocalDatabase {
  init(): Promise<void>;
  getOptional<T>(sql: string, params?: readonly unknown[]): Promise<T | null>;
  getAll<T>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  execute(sql: string, params?: readonly unknown[]): Promise<unknown>;
  writeTransaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T>;
  /** The NEXT writeTransaction's callback runs to completion, then the "commit" throws instead —
   *  simulating a browser kill after every insert but before the transaction lands. */
  failNextTransactionAfterInserts(): void;
}

/**
 * Creates a fresh, isolated fake `LocalDatabase` — one instance per call, so per-test isolation
 * (a fresh `vi.mock` return value, or a fresh instance for a scenario that needs its own history)
 * never shares state with any other test through a leaked singleton.
 */
export function createFakeLocalDatabase(): FakeLocalDatabase {
  let records = new Map<string, FakeRecordRow>();
  let migrations = new Map<string, FakeMigrationRow>();
  let failNext = false;
  // A real writeLock is exclusive — concurrent writeTransaction callers queue, they never
  // interleave. Emulated here by chaining onto the tail of a promise queue, so a test that
  // constructs two stores "at once" (React StrictMode's double-invoked useMemo, in practice)
  // observes the same serialization the real engine provides — the property the marker-race fix
  // in sqlite-capture-store.ts depends on.
  let writeQueue: Promise<unknown> = Promise.resolve();

  const fake = {
    async init(): Promise<void> {},

    async getOptional(sql: string, params: readonly unknown[] = []) {
      if (sql.startsWith('SELECT id FROM capture_migrations')) {
        const [key] = params as [string];
        return migrations.get(key) ?? null;
      }
      throw new Error(`fake database: unrecognized getOptional() — ${sql}`);
    },

    async getAll(sql: string, params: readonly unknown[] = []) {
      if (sql.startsWith('SELECT payload_json FROM capture_records')) {
        const [key] = params as [string];
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
  };

  // The fake's methods are deliberately non-generic (they only ever return the one row shape
  // each recognized query produces); this cast asserts the narrow, controlled query surface this
  // package actually issues, not a real generic SQL result.
  return fake as FakeLocalDatabase;
}
