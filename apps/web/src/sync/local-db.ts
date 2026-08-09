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
 */

import type { LocalDatabase } from '@werf/sync';

let dbPromise: Promise<LocalDatabase> | null = null;

/** Opens the shared local database on first call; every later call returns the same promise. */
export function getLocalDatabase(): Promise<LocalDatabase> {
  dbPromise ??= (async () => {
    const { createLocalDatabase } = await import('@werf/sync/local-database');
    const db = createLocalDatabase();
    await db.init();
    return db;
  })();
  return dbPromise;
}
