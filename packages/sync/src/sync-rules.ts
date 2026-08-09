/**
 * Pure types + a YAML renderer for PowerSync self-hosted sync rules (phase-checklists.md 3b).
 * Never imports `@powersync/web` or `@werf/db` — safe from anywhere, including a browser bundle,
 * though nothing in application code has a reason to import this today; only the generator
 * (`scripts/derive-sync-rules.ts`) and its tests do.
 *
 * A sync rule is a SEPARATE system from Postgres RLS with a silent failure mode (db.md, and
 * `tenancy.ts`'s own header): both are derived from `TENANCY` so they cannot disagree by
 * construction — but only for what classic PowerSync Sync Rules can actually EXPRESS. Confirmed
 * against docs.powersync.com/sync/supported-sql: Parameter Queries and Data Queries are each a
 * single-table `SELECT` with column selection and a restricted `WHERE` (`=`, `IS NULL`, `AND`,
 * limited `OR`, `IN` with restrictions) — "Not supported: subqueries, JOINs, CTEs, aggregation,
 * sorting, or set operations." A table whose tenancy predicate needs a JOIN to resolve from
 * `request.user_id()` in one hop cannot be expressed this way at all; `derive-sync-rules.ts`
 * documents which tables that excludes and why, the same "loud exclusion, not a silent gap" shape
 * as `local-schema.ts`'s `theft_incident_animals`/#10.
 *
 * ⛔ Known, deliberate gap vs RLS, not an oversight: `app_user_farm_ids()` (0001_rls.sql, tightened
 * by 0004_membership_acceptance.sql) filters `deleted_at IS NULL AND accepted_at IS NOT NULL AND
 * (expires_at IS NULL OR expires_at > now())`. Supported SQL has no `now()` or any time-based
 * function — "expressions must be deterministic" — so the `expires_at` half cannot be replicated
 * here. A membership with a past `expires_at` that has not been soft-deleted keeps syncing under
 * this rule after RLS would already refuse it at the API. See STATUS.md's owner decisions: closing
 * this needs a job that soft-deletes expired memberships, making `deleted_at` the one signal both
 * systems share, not a sync-rules trick — there isn't one.
 */

export interface SyncRuleTableDef {
  readonly table: string;
  /** Explicit column list — never `*`. A `SELECT *` data query ships `neverSyncColumns` bytes
   * over the wire regardless of what the client's local schema accepts; the local schema is not
   * a security boundary, this list is. */
  readonly columns: readonly string[];
  /** Row column compared to `bucket.<paramName>`. Omitted = unconditional — every instance of
   * this bucket carries the same rows. Only correct for data with no per-instance tenant (global
   * reference rows riding along in a farm bucket for convenience). */
  readonly filterColumn?: string;
}

export interface SyncRulesBucketDef {
  readonly name: string;
  /** The parameter name every table's `filterColumn` in this bucket is compared against, i.e.
   * `bucket.<paramName>` in the rendered WHERE clause. */
  readonly paramName: string;
  /** A single-table, join-free `SELECT` producing one row per bucket instance this connection
   * gets — e.g. one row per farm the connected user belongs to. */
  readonly parametersQuery: string;
  readonly tables: readonly SyncRuleTableDef[];
}

function renderDataQuery(paramName: string, t: SyncRuleTableDef): string {
  const cols = t.columns.join(', ');
  const where = t.filterColumn ? ` WHERE ${t.filterColumn} = bucket.${paramName}` : '';
  return `      - SELECT ${cols} FROM ${t.table}${where}`;
}

function renderBucket(b: SyncRulesBucketDef): string {
  const data = b.tables.map((t) => renderDataQuery(b.paramName, t)).join('\n');
  return `  ${b.name}:\n    parameters: ${b.parametersQuery}\n    data:\n${data}`;
}

/** Renders a complete `bucket_definitions` document. Callers own the header comment. */
export function renderSyncRulesYaml(buckets: readonly SyncRulesBucketDef[]): string {
  return `bucket_definitions:\n${buckets.map(renderBucket).join('\n')}\n`;
}
