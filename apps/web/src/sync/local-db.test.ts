/**
 * P1.1 (2026-08-14): `getLocalDatabase()` memoizes the open attempt so every one of the 13
 * SQLite-backed capture-store providers shares one real `PowerSyncDatabase` — but a REJECTED
 * promise cannot later resolve, so before this fix a failed open (OPFS busy, WASM init glitch)
 * was cached forever and every later call replayed the identical rejection for the rest of the
 * tab's life, even once the underlying condition cleared. `sqlite-capture-store.ts`'s open-retry
 * coordinator depends on `database()` genuinely attempting a fresh open each time it is called
 * after a failure; this proves the thunk it is actually given in production does that.
 *
 * `@werf/sync/local-database` is mocked outright — constructing a real `PowerSyncDatabase` opens
 * OPFS/Worker/WASM machinery that hangs forever under jsdom (that module's own header), and this
 * file is testing `local-db.ts`'s memoization contract, not the engine underneath it.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

// `test-setup.ts` globally mocks this whole module (every OTHER test needs the fake local
// database, not the real memoization logic) — undone here so this file exercises the genuine
// `getLocalDatabase()` implementation instead of the test-wide stand-in.
vi.unmock('./local-db');

const initMock = vi.fn();
const createLocalDatabaseMock = vi.fn(() => ({ init: initMock }));

vi.mock('@werf/sync/local-database', () => ({
  createLocalDatabase: () => createLocalDatabaseMock(),
}));

describe('getLocalDatabase', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('[P1.1] retries a fresh open after a failure, instead of replaying the same rejection forever', async () => {
    initMock
      .mockRejectedValueOnce(new Error('OPFS temporarily unavailable'))
      .mockResolvedValueOnce(undefined);
    const { getLocalDatabase } = await import('./local-db');

    await expect(getLocalDatabase()).rejects.toThrow('OPFS temporarily unavailable');
    // The old implementation cached that rejection forever — this second call would have replayed
    // it with no new attempt. A genuinely fresh open is what lets a store's open-retry coordinator
    // ever recover a capture made during the outage.
    await expect(getLocalDatabase()).resolves.toBeDefined();
    expect(createLocalDatabaseMock).toHaveBeenCalledTimes(2);
  });

  it('reuses the same instance across every caller once opened successfully', async () => {
    initMock.mockResolvedValue(undefined);
    const { getLocalDatabase } = await import('./local-db');

    const first = await getLocalDatabase();
    const second = await getLocalDatabase();

    expect(second).toBe(first);
    expect(createLocalDatabaseMock).toHaveBeenCalledTimes(1);
  });

  it('does not open twice for callers racing before the first attempt has settled', async () => {
    let resolveInit!: () => void;
    initMock.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveInit = resolve;
      }),
    );
    const { getLocalDatabase } = await import('./local-db');

    const a = getLocalDatabase();
    const b = getLocalDatabase();
    resolveInit();
    const [first, second] = await Promise.all([a, b]);

    expect(second).toBe(first);
    expect(createLocalDatabaseMock).toHaveBeenCalledTimes(1);
  });
});
