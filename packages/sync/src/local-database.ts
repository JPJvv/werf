/**
 * The one place in this repository allowed to import `@powersync/web`. ADR-0003's exit
 * depends on that being true: everything above this seam, including every other file in this
 * package, knows only `createLocalDatabase` and the `LocalDatabase` type — never the SDK
 * itself. Enforced by eslint.config.mjs's `no-restricted-imports` override for `@powersync/*`,
 * scoped to everywhere outside this package, plus this file's own exemption from it.
 *
 * Scope for this slice (phase-checklists.md 3a): open the local SQLite/OPFS database with the
 * schema derived in `local-schema.ts`. It is deliberately NOT connected to a PowerSync service
 * here — `.connect()` needs a `PowerSyncBackendConnector` (auth + upload queue wiring), which
 * is sync-rules territory (3b) and comes in a later slice. An unconnected database still reads
 * and writes locally; that is the whole offline-first point (ADR-0003, frontend.md).
 *
 * ⛔ Constructing `PowerSyncDatabase` opens real OPFS/Worker/WASM machinery that only exists in
 * a browser — attempting it under Node (vitest, this package's own test suite) blocks forever
 * waiting on browser APIs that will never appear. That is WHY `createLocalDatabase` is never
 * called from a `.spec.ts` in this package: it is typechecked, not unit-tested. Exercising a
 * real open belongs in apps/web's Playwright suite, which runs in a real browser.
 */

import { PowerSyncDatabase } from '@powersync/web';
import { localSchema } from './local-schema';

export type LocalDatabase = PowerSyncDatabase;

export interface LocalDatabaseOptions {
  /** OPFS filename. One device may eventually hold more than one farm's data offline. */
  readonly dbFilename?: string;
}

const DEFAULT_DB_FILENAME = 'werf.db';

/** Opens (creating if needed) the device's local SQLite/OPFS database. Never connects. */
export function createLocalDatabase(options: LocalDatabaseOptions = {}): LocalDatabase {
  return new PowerSyncDatabase({
    schema: localSchema,
    database: { dbFilename: options.dbFilename ?? DEFAULT_DB_FILENAME },
  });
}
