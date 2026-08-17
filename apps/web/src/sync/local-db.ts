/**
 * The one shared local SQLite/OPFS database instance the main app opens (phase-checklists.md
 * 3c). A module-level memoized singleton, not a React context/provider — deliberately, for two
 * reasons: the dynamic import fires exactly once regardless of how many of the 12 `Local*.tsx`
 * capture-store providers reference it, with no `App.tsx` provider-order change needed; and every
 * `defaultFactory` can close over it directly without threading a database instance through
 * component props.
 *
 * `@werf/sync/local-database` is reached ONLY via this dynamic `import()`, never a static one —
 * see that module's header (and `apps/web/vite.config.ts`'s `workbox` comment) for why: it opens
 * the PowerSync/wa-sqlite WASM engine, which Vite code-splits into its own precached-but-not-
 * interactive-path chunks, kept out of `check-bundle-size.mjs`'s JS-gz sum specifically because
 * it is precached rather than fetched on the interactive path.
 *
 * ⭐ P1.1 (2026-08-14): a REJECTED promise cannot later resolve, so a failed open used to be
 * cached forever — every one of the 14 `Local*.tsx` capture-store providers passes this function
 * (not its result) as their `database` thunk specifically so each one's own open-retry coordinator
 * (`sqlite-capture-store.ts`) can call it AGAIN after a failure and get a fresh attempt. Caching
 * only the SUCCESS path (and clearing on rejection) keeps the "one shared instance" guarantee for
 * every provider that reads it while a device is genuinely working, without turning a transient
 * open failure (another tab briefly holding the OPFS lock, a one-off WASM init glitch) into a
 * permanent one for the rest of the tab's life.
 */

import type { LocalDatabase } from '@werf/sync';

let dbPromise: Promise<LocalDatabase> | null = null;

/** Opens the shared local database on first call; every later call returns the same promise —
 *  unless the open failed, in which case the NEXT call attempts a fresh open rather than
 *  replaying the same rejection forever. */
export function getLocalDatabase(): Promise<LocalDatabase> {
  dbPromise ??= (async () => {
    const { createLocalDatabase } = await import('@werf/sync/local-database');
    const db = createLocalDatabase();
    await db.init();
    return db;
  })().catch((error: unknown) => {
    dbPromise = null;
    throw error;
  });
  return dbPromise;
}
