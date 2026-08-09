/**
 * The shared fake local database `test-setup.ts`'s global `vi.mock` of
 * `apps/web/src/sync/local-db.ts` installs, and the seam a component test uses to read back what
 * a capture screen persisted — the SQLite-era analogue of the Phase 2 pattern of reading
 * `window.localStorage` directly, now that captures land in `capture_records` instead.
 *
 * Lives here rather than inline in `test-setup.ts` so an individual test file can import
 * `getCurrentFakeLocalDatabase` to build its own read-back helper without importing the whole
 * setup file. `resetFakeLocalDatabase` is called from `test-setup.ts`'s `beforeEach` only.
 */

import { createFakeLocalDatabase, type FakeLocalDatabase } from '@werf/sync/testing';

let currentDb: Promise<FakeLocalDatabase> | null = null;

/**
 * The fake local database for the CURRENT test — memoized within one test/render, mirroring the
 * real `getLocalDatabase()` singleton's "same instance across every provider" contract (so two
 * providers rendered in the same test share one fake, exactly as they would share one real
 * database), and reset to a fresh instance before every test by `resetFakeLocalDatabase`.
 */
export function getCurrentFakeLocalDatabase(): Promise<FakeLocalDatabase> {
  currentDb ??= Promise.resolve(createFakeLocalDatabase());
  return currentDb;
}

/** Fresh fake for the next test — never carries a committed migration marker across tests. */
export function resetFakeLocalDatabase(): void {
  currentDb = null;
}

/**
 * Reads every record a capture store persisted under one localStorage-shaped key
 * (`werf-<name>:<farmId>`), in the same append order `all()` would return — the read-back helper
 * every `stored<Thing>()` test function now needs, since that data no longer lives in
 * `window.localStorage` itself.
 */
export async function storedCaptures<T>(key: string): Promise<readonly T[]> {
  const db = await getCurrentFakeLocalDatabase();
  const rows = await db.getAll<{ payload_json: string }>(
    'SELECT payload_json FROM capture_records WHERE store_key = ? ORDER BY seq ASC',
    [key],
  );
  return rows.map((row) => JSON.parse(row.payload_json) as T);
}
