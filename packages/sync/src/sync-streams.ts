/**
 * Pure types + a YAML renderer for PowerSync self-hosted Sync Streams config (`edition: 3`),
 * phase-checklists.md 3b. Never imports `@powersync/web` or `@werf/db` — safe from anywhere,
 * though only the generator (`scripts/derive-sync-streams.ts`) and its tests use it today.
 *
 * A sync rule is a SEPARATE system from Postgres RLS with a silent failure mode (db.md,
 * `tenancy.ts`'s header): both are derived from `TENANCY` so they cannot disagree by
 * construction. This module targets Sync Streams rather than classic Sync Rules
 * (`bucket_definitions`) because classic Rules forbid JOINs/subqueries entirely, which blocked
 * `businesses`, `regulatory_rates`/`veterinary_products` and co-member `users` rows outright —
 * see git history for that first attempt. Streams support `IN (SELECT ...)` subqueries, which is
 * what every predicate below uses.
 *
 * ⛔ EMPIRICALLY CONFIRMED, 2026-08-09, against a real self-hosted instance
 * (`journeyapps/powersync-service:1.23.3`, Postgres storage, `infra/powersync/`) — not read off
 * docs, which turned out to paraphrase inconsistently earlier this same investigation:
 *   - `IN (SELECT ...)` subqueries validate and replicate correctly, including nested two-hop
 *     subqueries (`auth.user_id()` → `farm_users` → `farms` → `business_id`/`jurisdiction`).
 *   - `EXISTS (...)` does NOT validate — "Unknown function" — even non-correlated. Every
 *     predicate here uses `IN` instead, which does the same job.
 *   - `now()` does NOT validate — "Unknown function" — so `farm_users.expires_at` cannot be
 *     enforced here either, the same gap classic Sync Rules had. RLS still enforces it at the
 *     API; see this module's `FARM_MEMBERSHIP_PREDICATE` for the exact clause omitted and why.
 *   - A single stream that fails to validate makes the ENTIRE sync config fail to load — there
 *     is no partial-success mode. `derive-sync-streams.ts`'s `NOT_YET_EXPRESSIBLE`/
 *     `NO_SURROGATE_ID` exclusions exist because of this: a wrong guess for one table would break
 *     replication for every table, not just the one that was wrong.
 *   - Config validating and rows landing in the service's own storage (`powersync.current_data`,
 *     `powersync.bucket_parameters`) is NOT the same claim as a connected client receiving those
 *     rows. Streams are an opt-in subscription model: without `auto_subscribe: true`, a real
 *     `.connect()` completes cleanly with `operations_synced: 0` — no error, no warning — because
 *     the client never subscribed to anything. Every stream below sets it. This product's whole
 *     premise is a device holding its farm by default; per-stream on-demand subscription is a
 *     bandwidth optimisation a later phase can opt into, not the default.
 */

export interface SyncStreamDef {
  readonly name: string;
  readonly table: string;
  /** Explicit column list — never `*`. A `SELECT *` data query ships `neverSyncColumns` bytes
   * over the wire regardless of what the client's local schema accepts; the local schema is not
   * a security boundary, this list is. */
  readonly columns: readonly string[];
  /** The full `WHERE` clause body (no leading `WHERE`), built on `auth.user_id()`. */
  readonly whereSql: string;
}

function renderStream(s: SyncStreamDef): string {
  const cols = s.columns.join(', ');
  // auto_subscribe: streams are an opt-in subscription model — without this, a connected client
  // receives nothing until it explicitly subscribes to each stream, which nothing in this repo
  // does yet (empirically found 2026-08-09: a real .connect() completed with operations_synced: 0
  // against a service confirmed to hold correctly-indexed bucket_parameters for the connecting
  // user). Offline-first means a device holds its whole farm by default; per-stream on-demand
  // subscription is a bandwidth optimisation a later phase can opt back into, not the default.
  return `  ${s.name}:\n    query: |\n      SELECT ${cols} FROM ${s.table}\n      WHERE ${s.whereSql}\n    auto_subscribe: true`;
}

/** Renders a complete `config: {edition: 3}` + `streams:` document. Callers own the header comment. */
export function renderSyncStreamsYaml(streams: readonly SyncStreamDef[]): string {
  return `config:\n  edition: 3\n\nstreams:\n${streams.map(renderStream).join('\n')}\n`;
}
