/**
 * Computes PowerSync Sync Streams config from the ONE tenancy registry (`src/tenancy.ts`) and
 * the real Postgres schema (`@werf/db`) — never by hand. Same "dev-only, never importable from
 * `src/**`" reasoning as `derive-local-schema.ts`: `@werf/db` pulls in `pg`, which cannot resolve
 * in a browser bundle, and this module's OWN output (a YAML config file for the PowerSync
 * *service*, not the client) has no business shipping to a device either way.
 *
 * Every predicate below is built on `farm_users`, mirroring `app_user_farm_ids()`
 * (0004_membership_acceptance.sql) MINUS its `expires_at` clause — see sync-streams.ts's header
 * for why (`now()` does not validate; empirically confirmed, not assumed) and the API's
 * `MembershipExpiryService`, which bridges elapsed expiry into the shared `deleted_at` signal.
 */

import { getTableColumns, getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import * as dbSchema from '@werf/db';
import { TENANCY, type SyncedTable } from '../src/tenancy';
import type { SyncStreamDef } from '../src/sync-streams';

/** Same gap as `local-schema.ts`'s `NO_SURROGATE_ID` (#10): PowerSync needs one TEXT `id` per
 * synced row; `theft_incident_animals` has a composite key and none. Format-independent — this
 * is a schema gap, not a query-language ceiling like the one Sync Streams just resolved. */
const NO_SURROGATE_ID: ReadonlySet<SyncedTable> = new Set(['theft_incident_animals']);

/** The membership predicate every stream below is built on: `farm_users` rows for the connected
 * user, alive and accepted. Deliberately omits `expires_at` — see sync-streams.ts's header and
 * `MembershipExpiryService`, which tombstones elapsed grants once per minute.
 * `select` is the projection (`farm_id` to list the user's farms, `1` for an existence check —
 * `EXISTS` itself does not validate, empirically confirmed, so this is how that gets expressed). */
function membershipSubquery(select: 'farm_id' | '1'): string {
  return (
    `SELECT ${select} FROM farm_users` +
    ' WHERE user_id = auth.user_id() AND deleted_at IS NULL AND accepted_at IS NOT NULL'
  );
}
const OWN_FARM_IDS = membershipSubquery('farm_id');

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
 * The Sync Streams this repo's `TENANCY` registry can express — every non-`server-only` table
 * except the schema gap above. Sorted so the generated output, and every diff against it, is
 * stable.
 */
export function deriveSyncStreams(): readonly SyncStreamDef[] {
  const tablesByName = new Map(allPgTables().map((table) => [getTableName(table), table]));

  const streams: SyncStreamDef[] = [];
  for (const tableName of Object.keys(TENANCY) as SyncedTable[]) {
    const entry = TENANCY[tableName];
    if (entry.classification === 'server-only') continue;
    if (NO_SURROGATE_ID.has(tableName)) continue;

    const columns = columnsFor(tablesByName, tableName);
    const whereSql = wherePredicateFor(tableName);
    streams.push({ name: tableName, table: tableName, columns, whereSql });
  }
  return streams.sort((a, b) => a.name.localeCompare(b.name));
}

function wherePredicateFor(tableName: SyncedTable): string {
  const entry = TENANCY[tableName];
  const scope = entry.scope;
  if (!scope) {
    throw new Error(
      `"${tableName}" is ${entry.classification} but has no scope to build a predicate from`,
    );
  }
  switch (scope.kind) {
    case 'direct':
      return `${scope.column} IN (${OWN_FARM_IDS})`;
    case 'via-business':
      // businesses.id -> farms.business_id -> farms.id -> farm_users.farm_id. Classic Sync
      // Rules could not express this two-hop resolution at all (no JOINs/subqueries); Streams'
      // IN (SELECT ...) support does, empirically confirmed against the real service.
      return `${scope.column} IN (SELECT business_id FROM farms WHERE id IN (${OWN_FARM_IDS}))`;
    case 'via-membership':
      // users: the RLS shape is "self OR co-member of a shared farm" (0004's
      // users_self_and_comembers). EXISTS does not validate here (empirically confirmed), so
      // this is written as IN, which does the same job.
      return (
        `id = auth.user_id() OR id IN (` +
        `SELECT user_id FROM farm_users WHERE deleted_at IS NULL AND accepted_at IS NOT NULL ` +
        `AND farm_id IN (${OWN_FARM_IDS}))`
      );
    case 'reference-jurisdiction':
      // regulatory_rates/veterinary_products: filtered by the JURISDICTIONS of farms the user
      // belongs to, not by farm ownership. Same two-hop shape classic Sync Rules could not
      // express.
      return `${scope.column} IN (SELECT jurisdiction FROM farms WHERE id IN (${OWN_FARM_IDS}))`;
    case 'reference-global':
      // species_gestation: filtered by nothing farm-shaped (biology, not law — tenancy.ts) but
      // still gated on "belongs to some farm at all" (syncsToUser's own rule) via IN over a
      // constant, since EXISTS does not validate.
      return `1 IN (${membershipSubquery('1')})`;
  }
}
