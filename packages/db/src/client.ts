/**
 * Database connections. There are exactly two, and the difference between them is a
 * security boundary, so this module makes them different TYPES rather than two calls to
 * the same factory with a different URL.
 *
 * - `AppDb` connects as `werf_app`, a non-superuser subject to RLS. It has no method
 *   that runs a query outside `asUser()`, so "a query without a farm scope" (CLAUDE.md)
 *   is not something you can express through it — you cannot forget the scope, because
 *   there is no unscoped door.
 * - `ElevatedDb` bypasses RLS. It exists for the handful of operations that legitimately
 *   precede a membership: registering a business, creating its first farm, and reading
 *   `user_sessions` on the refresh path (a refresh must find the session BEFORE it knows
 *   whose it is). The membership-expiry sweep is one lifecycle exception: it must tombstone
 *   rows the RLS clock condition has already hidden. Immutable auth evidence is the other:
 *   pre-auth failures have no user scope, and `auth_audit_log` is deliberately granted nothing
 *   to `werf_app`. Everything else belongs on `AppDb`.
 *
 * Reaching for `ElevatedDb` in a feature module is the thing to be suspicious of in review.
 */

import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export type WerfDb = NodePgDatabase<typeof schema>;

/** A transaction handle — what `asUser` hands your callback. Same query API as `WerfDb`. */
export type WerfTx = Parameters<Parameters<WerfDb['transaction']>[0]>[0];

export interface DbConfig {
  /** Postgres connection string. */
  readonly url: string;
  /** Pool ceiling. Defaults to pg's own. */
  readonly maxConnections?: number;
}

/**
 * The RLS-bound connection. Every query runs inside `asUser`, which opens a transaction
 * and sets the `app.user_id` GUC that `app_current_user_id()` — and therefore every RLS
 * policy — reads.
 */
export interface AppDb {
  /**
   * Runs `fn` in a transaction scoped to `userId`. The GUC is set with `is_local = true`,
   * so it is bound to THIS transaction and reverts on commit or rollback. That detail is
   * load-bearing: with a pooled connection and a session-level `SET`, the next request to
   * borrow the connection would inherit the previous user's identity, and RLS would
   * cheerfully serve it another farm's rows.
   */
  asUser<T>(userId: string, fn: (tx: WerfTx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** The RLS-bypassing connection. Provisioning, auth and explicit lifecycle maintenance only. */
export interface ElevatedDb {
  readonly db: WerfDb;
  close(): Promise<void>;
}

function createPool(config: DbConfig): pg.Pool {
  return new pg.Pool({
    connectionString: config.url,
    ...(config.maxConnections === undefined ? {} : { max: config.maxConnections }),
  });
}

/** Connects as `werf_app`. The URL must name the RLS-bound role, not the owner. */
export function createAppDb(config: DbConfig): AppDb {
  const pool = createPool(config);
  const db = drizzle(pool, { schema });

  return {
    async asUser<T>(userId: string, fn: (tx: WerfTx) => Promise<T>): Promise<T> {
      return db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
        return fn(tx);
      });
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}

/**
 * Connects as the elevated role. Keep this pool small: it is not for request traffic,
 * and a large one mostly widens the blast radius of a mistake.
 */
export function createElevatedDb(config: DbConfig): ElevatedDb {
  const pool = createPool({ ...config, maxConnections: config.maxConnections ?? 4 });
  const db = drizzle(pool, { schema });

  return {
    db,
    async close(): Promise<void> {
      await pool.end();
    },
  };
}
