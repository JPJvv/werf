/**
 * Computes the client's local SQLite table shapes from the ONE tenancy registry
 * (`src/tenancy.ts`) and the real Postgres schema (`@werf/db`) — never by hand.
 *
 * ⛔ This module (and everything it imports) MUST NEVER be imported from `src/**`. `@werf/db`
 * pulls in `pg`, a Node TCP/TLS Postgres driver that cannot resolve in a browser bundle, and
 * apps/web consumes `@werf/sync` as SOURCE (no pre-build step — see apps/web/vite.config.ts),
 * so anything reachable from `src/index.ts` ships to a farmer's phone. Dev-time only: run by
 * `scripts/generate-local-schema.ts` (writes `src/local-schema-tables.generated.ts`) and by
 * `test/local-schema-freshness.spec.ts` (proves the generated file still matches the schema).
 * Both are safe: vitest's `packages/**` project runs in Node, never bundled by Vite.
 *
 * `server-only` tables (TENANCY) get no local table at all — the same posture the sync rules
 * enforce, from the same registry. `neverSyncColumns` (secrets, PostGIS geometry) are excluded
 * column-by-column, so a device can hold `land_units` without ever holding `boundary`.
 */

import { getTableColumns, getTableName, is } from 'drizzle-orm';
import {
  PgBigInt53,
  PgBigInt64,
  PgBigSerial53,
  PgBigSerial64,
  PgBoolean,
  PgDoublePrecision,
  PgInteger,
  PgNumeric,
  PgReal,
  PgSerial,
  PgSmallInt,
  PgSmallSerial,
  PgTable,
  type PgColumn,
} from 'drizzle-orm/pg-core';
import * as dbSchema from '@werf/db';
import { TENANCY, type SyncedTable } from '../src/tenancy';
import type { LocalColumnDef, LocalColumnType, LocalTableDef } from '../src/local-schema';

/**
 * Tables PowerSync cannot represent locally because they have no single-column row identity.
 * Empty since migration 0025 closed the one entry this ever held (`theft_incident_animals`,
 * issue #10) — kept as a named set, not deleted outright, because it is exactly the kind of gap
 * that recurs: a future table with a composite PK and no surrogate `id` lands here again, caught
 * loudly by the throw below rather than emitted as a broken PowerSync schema.
 */
const NO_SURROGATE_ID: ReadonlySet<SyncedTable> = new Set();

// SQLite (and PowerSync's Column DSL) has three affinities. Booleans and every integer width
// round-trip through INTEGER; money-shaped/real numbers through REAL; everything else —
// including enums, dates, JSON payloads, and arrays (JSON-encoded, since SQLite has no array
// type) — through TEXT. Unmatched column kinds (PostGIS geometry, bytea) fall through to TEXT
// too, but neither ever reaches here: geometry columns are always farm/event `neverSyncColumns`,
// and bytea columns are always on `server-only` tables (TOTP/passkey secrets) — checked by
// `local-schema-freshness.spec.ts` rather than assumed.
const INTEGER_TYPES = [
  PgBoolean,
  PgInteger,
  PgSmallInt,
  PgBigInt53,
  PgBigInt64,
  PgSerial,
  PgSmallSerial,
  PgBigSerial53,
  PgBigSerial64,
];
const REAL_TYPES = [PgNumeric, PgReal, PgDoublePrecision];

function localColumnType(column: PgColumn): LocalColumnType {
  if (INTEGER_TYPES.some((ctor) => is(column, ctor))) return 'INTEGER';
  if (REAL_TYPES.some((ctor) => is(column, ctor))) return 'REAL';
  // Arrays and everything else (uuid, text, enum, date, timestamp, jsonb) travel as TEXT —
  // arrays JSON-encoded, since SQLite has no array affinity.
  return 'TEXT';
}

function allPgTables(): readonly PgTable[] {
  return Object.values(dbSchema).filter((exported): exported is PgTable => is(exported, PgTable));
}

/**
 * Every table `TENANCY` says a device may hold, with its columns reduced to what a device
 * may hold of it. Sorted so the generated output — and every diff against it — is stable.
 */
export function deriveLocalSchemaTables(): readonly LocalTableDef[] {
  const tablesByName = new Map(allPgTables().map((table) => [getTableName(table), table]));

  const tables: LocalTableDef[] = [];
  for (const tableName of Object.keys(TENANCY) as SyncedTable[]) {
    const entry = TENANCY[tableName];
    if (entry.classification === 'server-only') continue;
    if (NO_SURROGATE_ID.has(tableName)) continue;

    const table = tablesByName.get(tableName);
    if (!table) {
      throw new Error(`TENANCY names "${tableName}" but @werf/db has no such table`);
    }
    const sourceColumnNames = new Set(Object.values(getTableColumns(table)).map((c) => c.name));
    if (!sourceColumnNames.has('id')) {
      // A table with no `id` column and not in NO_SURROGATE_ID is a new, unreviewed case of
      // the same gap — fail loudly at generation time rather than emit a schema PowerSync
      // cannot actually open.
      throw new Error(
        `"${tableName}" has no surrogate id column and is not in NO_SURROGATE_ID — ` +
          'decide explicitly whether it can sync locally before adding it to the schema',
      );
    }
    const neverSync = new Set(entry.neverSyncColumns ?? []);
    const columns: LocalColumnDef[] = Object.values(getTableColumns(table))
      .filter((column) => !neverSync.has(column.name))
      .map((column) => ({ name: column.name, type: localColumnType(column) }))
      // `id` is PowerSync's implicit primary key column — every Table<> in @powersync/common
      // gets one automatically and rejects a caller-supplied one.
      .filter((column) => column.name !== 'id')
      .sort((a, b) => a.name.localeCompare(b.name));

    tables.push({ name: tableName, columns });
  }

  return tables.sort((a, b) => a.name.localeCompare(b.name));
}
