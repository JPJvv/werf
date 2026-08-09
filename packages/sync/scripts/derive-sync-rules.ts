/**
 * Computes the PowerSync self-hosted sync-rules bucket definitions from the ONE tenancy
 * registry (`src/tenancy.ts`) and the real Postgres schema (`@werf/db`) — never by hand. Same
 * "dev-only, never importable from `src/**`" reasoning as `derive-local-schema.ts`: `@werf/db`
 * pulls in `pg`, which cannot resolve in a browser bundle, and this module's OWN output (a YAML
 * config file for the PowerSync *service*, not the client) has no business shipping to a device
 * either way.
 *
 * ⛔ `NOT_YET_EXPRESSIBLE`: three `TENANCY` tables have no representable bucket at all. Classic
 * PowerSync Sync Rules forbid JOINs/subqueries in both Parameter and Data Queries (confirmed
 * against docs.powersync.com/sync/supported-sql) — a single-table `SELECT` cannot resolve
 * `request.user_id()` to `business_id` or `jurisdiction`, both of which need two hops through
 * `farm_users` → `farms`. This is not the same shape as `theft_incident_animals` (a schema gap,
 * #10) — it is a query-language ceiling. The fix, per STATUS.md's owner decision, is a migration
 * that denormalises the missing hop onto `farm_users` (this repo's existing dual-write precedent
 * — `boundary_geojson`, `location_geojson`), not a cleverer query; there isn't one. Until that
 * lands, `businesses`, `regulatory_rates` and `veterinary_products` sync to no device.
 *
 * ⛔ `users`: only the connected user's OWN row is expressible (`self` bucket, `id =
 * request.user_id()` — the documented single-table pattern). RLS additionally grants a
 * co-member's row (`users_self_and_comembers`, 0004_membership_acceptance.sql) via a `farm_users`
 * EXISTS join — the same two-hop ceiling as above. Syncing narrower than RLS is the safe
 * direction (nothing leaks), but it is a real behaviour change from what `TENANCY` declares
 * (`via-membership`, which promises co-members). Written into STATUS.md as an owner question
 * (does any offline screen need a co-member's name/locale?) rather than assumed.
 */

import { getTableColumns, getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import * as dbSchema from '@werf/db';
import { TENANCY, type SyncedTable } from '../src/tenancy';
import type { SyncRuleTableDef, SyncRulesBucketDef } from '../src/sync-rules';

/** Same gap as `local-schema.ts`'s `NO_SURROGATE_ID` (#10): PowerSync needs one TEXT `id` per
 * synced row; `theft_incident_animals` has a composite key and none. */
const NO_SURROGATE_ID: ReadonlySet<SyncedTable> = new Set(['theft_incident_animals']);

const NOT_YET_EXPRESSIBLE: ReadonlySet<SyncedTable> = new Set([
  'businesses',
  'regulatory_rates',
  'veterinary_products',
]);

/** The RLS predicate this parameter query is the sync-rules half of (0004_membership_acceptance.sql's
 * `app_user_farm_ids()`), MINUS the `expires_at` clause supported SQL cannot express — see
 * sync-rules.ts's header for why that gap is deliberate, tracked, and not a sync-rules trick. */
const BY_FARM_PARAMETERS_QUERY =
  'SELECT farm_id FROM farm_users' +
  ' WHERE user_id = request.user_id() AND deleted_at IS NULL AND accepted_at IS NOT NULL';

const SELF_PARAMETERS_QUERY = 'SELECT request.user_id() as user_id';

function allPgTables(): readonly PgTable[] {
  return Object.values(dbSchema).filter((exported): exported is PgTable => is(exported, PgTable));
}

function columnsFor(tablesByName: Map<string, PgTable>, tableName: SyncedTable): string[] {
  const table = tablesByName.get(tableName);
  if (!table) {
    throw new Error(`TENANCY names "${tableName}" but @werf/db has no such table`);
  }
  const neverSync = new Set(TENANCY[tableName].neverSyncColumns ?? []);
  return Object.values(getTableColumns(table))
    .map((c) => c.name)
    .filter((name) => !neverSync.has(name))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * The bucket definitions this repo's `TENANCY` registry can currently express as PowerSync
 * classic sync rules. Sorted so the generated output — and every diff against it — is stable.
 */
export function deriveSyncRulesBuckets(): readonly SyncRulesBucketDef[] {
  const tablesByName = new Map(allPgTables().map((table) => [getTableName(table), table]));

  const byFarmTables: SyncRuleTableDef[] = [];
  for (const tableName of Object.keys(TENANCY) as SyncedTable[]) {
    const entry = TENANCY[tableName];
    if (entry.classification !== 'farm-scoped') continue;
    if (entry.scope?.kind !== 'direct') continue; // via-business/via-membership handled separately
    if (NO_SURROGATE_ID.has(tableName)) continue;
    if (NOT_YET_EXPRESSIBLE.has(tableName)) continue;

    byFarmTables.push({
      table: tableName,
      columns: columnsFor(tablesByName, tableName),
      filterColumn: entry.scope.column,
    });
  }
  byFarmTables.sort((a, b) => a.table.localeCompare(b.table));

  // species_gestation (reference-global) rides along unconditionally in every farm bucket
  // instance — `syncsToUser` requires SOME farm membership even for global reference data, and
  // reusing farm_id's parameter query is simpler than a second bucket definition for four rows.
  byFarmTables.push({
    table: 'species_gestation',
    columns: columnsFor(tablesByName, 'species_gestation'),
    // No filterColumn: unconditional, per this function's own doc comment above.
  });

  const selfTable: SyncRuleTableDef = {
    table: 'users',
    columns: columnsFor(tablesByName, 'users'),
    filterColumn: 'id',
  };

  return [
    {
      name: 'by_farm',
      paramName: 'farm_id',
      parametersQuery: BY_FARM_PARAMETERS_QUERY,
      tables: byFarmTables,
    },
    {
      name: 'self',
      paramName: 'user_id',
      parametersQuery: SELF_PARAMETERS_QUERY,
      tables: [selfTable],
    },
  ];
}
