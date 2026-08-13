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
 *     evaluated here, the same ceiling classic Sync Rules had. RLS enforces it immediately at the
 *     API, while `apps/api/src/sync/membership-expiry.service.ts` converts elapsed grants into the
 *     `deleted_at` tombstone every stream already evaluates, bounding the replication gap to its
 *     one-minute sweep cadence plus processing/propagation time.
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
 *
 * ⛔ EMPIRICALLY CONFIRMED, 2026-08-13, against the same instance, while investigating phase-
 * checklists.md 3f's retention read-set window (STATUS.md § 3 has the full decision record):
 *   - Client-supplied STREAM PARAMETERS are real: `subscribe(name, {ttl, priority})`'s SDK type
 *     (`SyncStreamSubscribeOptions`, `@powersync/common`) doesn't carry them, but the wire
 *     protocol and the service's own SQL compiler do — confirmed by reading
 *     `packages/sync-rules/dist/legacy/streams/functions.js` inside the running
 *     `journeyapps/powersync-service:1.23.3` image, not by trusting docs a prior investigation
 *     already found paraphrasing inconsistently. `subscription.parameter('key')` and
 *     `subscription.parameters()` extract client-supplied, UNAUTHENTICATED JSON — the same
 *     "any value the client sends" posture `auth.parameters()` has for the JWT, just a different
 *     source. Unauthenticated is fine for a read-set BOUND (this farm's own data, never another
 *     farm's — tenancy is still `auth.user_id()`), not fine for anything security-relevant.
 *   - ⛔ THE ACTUAL WALL: an expression that references BOTH row data (a column) AND a
 *     subscription/connection parameter may combine them ONLY with `=`. Attempting
 *     `occurred_at > subscription.parameter('cutoff')` fails to load with the service's own exact
 *     words: *"This expression already references row data, so it can't also reference
 *     connection parameters unless the two are compared with an equals operator."* A range-based
 *     retention cutoff is therefore NOT directly expressible as a stream predicate — the same
 *     class of gap `now()`'s rejection left for `expires_at` (above), and the reason a naive
 *     "pass today's cutoff as a parameter" design for 3f's read-set window does not work. Making
 *     it work needs equality-bucketed partitioning or a server-side sweep converting the boundary
 *     into something equality CAN test. 3f chose equality buckets: the event stream compares the
 *     UTC `YYYY-MM` substring to a subscription parameter, while `event-retention.ts` maintains
 *     each farm's configured number of month subscriptions and evicts expired buckets with TTL 0.
 *     The membership predicate remains independent, so client-controlled parameters can narrow a
 *     farm's authorised rows but can never widen them.
 */

export interface SyncStreamDef {
  readonly name: string;
  readonly table: string;
  /**
   * The Postgres table the QUERY actually reads, when it differs from `table` (the TENANCY key
   * every other consumer — `sync-streams.spec.ts`, `sync-streams-rls-agreement.spec.ts`, RLS
   * comparison — matches against). Set ONLY for a partitioned source with no partition-root
   * publishing: PowerSync attributes replicated rows to the PARTITION's own relid, not the
   * parent's (`publish_via_partition_root` is explicitly unsupported — `PSYNC_S1143`, empirically
   * confirmed 2026-08-10 against journeyapps/powersync-service:1.23.3), so `FROM events` against
   * the partitioned parent validates and "replicates" with zero rows ever reaching a client —
   * no error, silently wrong. `derive-sync-streams.ts`'s `PARTITIONED_SOURCE_TABLE` is the one
   * place this is decided; this field only renders what that decided.
   */
  readonly sourceTable?: string;
  /** Explicit column list — never `*`. A `SELECT *` data query ships `neverSyncColumns` bytes
   * over the wire regardless of what the client's local schema accepts; the local schema is not
   * a security boundary, this list is. */
  readonly columns: readonly string[];
  /** The full `WHERE` clause body (no leading `WHERE`), built on `auth.user_id()`. */
  readonly whereSql: string;
  /** Defaults to true. Retention-bounded streams are subscribed by the client with parameters. */
  readonly autoSubscribe?: boolean;
  /** Required when client-controlled parameters only narrow an independently authorised set. */
  readonly acceptPotentiallyDangerousQueries?: boolean;
}

function renderStream(s: SyncStreamDef): string {
  const cols = s.columns.join(', ');
  // Alias back to the logical name so the local client schema (which matches by STREAM NAME, not
  // by the Postgres FROM text) sees no difference — see `sourceTable`'s own doc for why this
  // exists at all.
  const from =
    s.sourceTable !== undefined && s.sourceTable !== s.table
      ? `${s.sourceTable} AS ${s.table}`
      : s.table;
  // auto_subscribe: streams are an opt-in subscription model — without this, a connected client
  // receives nothing until it explicitly subscribes to each stream, which nothing in this repo
  // does yet (empirically found 2026-08-09: a real .connect() completed with operations_synced: 0
  // against a service confirmed to hold correctly-indexed bucket_parameters for the connecting
  // user). Offline-first means a device holds its whole farm by default; per-stream on-demand
  // subscription is a bandwidth optimisation a later phase can opt back into, not the default.
  const options = [
    `    auto_subscribe: ${s.autoSubscribe ?? true}`,
    ...(s.acceptPotentiallyDangerousQueries === true
      ? ['    accept_potentially_dangerous_queries: true']
      : []),
  ].join('\n');
  return `  ${s.name}:\n    query: |\n      SELECT ${cols} FROM ${from}\n      WHERE ${s.whereSql}\n${options}`;
}

/** Renders a complete `config: {edition: 3}` + `streams:` document. Callers own the header comment. */
export function renderSyncStreamsYaml(streams: readonly SyncStreamDef[]): string {
  return `config:\n  edition: 3\n\nstreams:\n${streams.map(renderStream).join('\n')}\n`;
}
