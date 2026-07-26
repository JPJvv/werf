/**
 * A real Postgres for integration tests, in Docker, migrated exactly the way production
 * is migrated. We never mock the database (CLAUDE.md): RLS, the `uuid_generate_v7()`
 * function, `citext` collation and the CHECK constraints are the things most likely to be
 * wrong, and every one of them is invisible to a mock. A test that mocks the DB would pass
 * against a schema that leaks farm B's cattle to farm A.
 *
 * The image matches docker-compose.yml so dev and CI cannot drift.
 *
 * Not exported from the package index — this is `@werf/db/testing`, kept off the runtime
 * import graph so a production bundle can never pull testcontainers in.
 */

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { fileURLToPath } from 'node:url';

/** Same image as docker-compose.yml. Drift here is drift between dev, CI, and production. */
const POSTGRES_IMAGE = 'postgis/postgis:16-3.4';

/** The password the RLS-bound test role logs in with. Test-only, and obviously so. */
const APP_ROLE_PASSWORD = 'werf_app_test';

export interface WerfTestDatabase {
  /** Connection string for the owner/superuser — migrations and the elevated auth path. */
  readonly elevatedUrl: string;
  /** Connection string for `werf_app`, the non-superuser role that RLS actually constrains. */
  readonly appUrl: string;
  /** Truncates every table, leaving the schema and roles intact. Cheap per-test reset. */
  reset(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Starts Postgres, applies every migration in order, and gives `werf_app` a login.
 *
 * Migration 0001 creates `werf_app` as NOLOGIN on purpose — production hands it a password
 * out of band. Tests need it to actually connect, because a test that exercises RLS as the
 * superuser proves nothing: superusers bypass RLS entirely.
 *
 * Pulling the image on a cold machine takes a while; call this in `beforeAll` with a
 * generous timeout (60s+).
 */
/**
 * One container per WORKER PROCESS, not one per suite.
 *
 * ⭐ This is a gate-stability fix, not an optimisation. Ten suites each booted their own Postgres
 * (five in `packages/db`, five in `apps/api`), and `HealthCheckWaitStrategy`'s 120-second timeout
 * is hardcoded inside testcontainers — `vitest.workspace.ts`'s `maxWorkers: 4` and
 * `hookTimeout: 60_000` do NOT bound it. Under contention the boot simply lost the race and a
 * suite went red for no reason of its own: it happened once when a review agent ran `pnpm verify`
 * alongside the main session, and CI is a machine that is ALWAYS under contention. CI has never
 * run this suite for real, so this is being fixed before the first run rather than after it.
 *
 * Vitest gives each worker its own module registry, so memoising here means at most `maxWorkers`
 * containers exist at once (4) rather than one per suite (10). Suites inside a worker run
 * sequentially, so sharing a database between them is safe — and `reset()` truncates everything
 * between tests regardless.
 *
 * `stop()` on a shared handle is therefore a NO-OP: the first suite to finish must not pull the
 * database out from under the three that follow it in the same worker. The container is stopped
 * when the worker exits, and testcontainers' Ryuk sidecar reaps anything that outlives the run —
 * so a crashed worker cannot leak a container either.
 */
let sharedDatabase: Promise<WerfTestDatabase> | undefined;

export function startWerfTestDatabase(): Promise<WerfTestDatabase> {
  if (sharedDatabase === undefined) {
    sharedDatabase = bootWerfTestDatabase().then((db) => {
      const stopForReal = db.stop;
      process.once('beforeExit', () => void stopForReal().catch(() => {}));
      return { ...db, reset: db.reset, stop: async () => {} };
    });
  }
  return sharedDatabase;
}

/**
 * Boots a genuinely private Postgres, bypassing the shared instance above. Use only for a test
 * that must not see another suite's schema state — a migration test that runs migrations itself,
 * say. Everything else should take the shared one; ten containers is what broke the gate.
 */
export async function bootWerfTestDatabase(): Promise<WerfTestDatabase> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withDatabase('werf')
    .withUsername('werf')
    .withPassword('werf')
    .start();

  const elevatedUrl = container.getConnectionUri();
  const pool = new pg.Pool({ connectionString: elevatedUrl });
  const db = drizzle(pool);

  const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));
  await migrate(db, { migrationsFolder });

  await db.execute(sql.raw(`ALTER ROLE werf_app WITH LOGIN PASSWORD '${APP_ROLE_PASSWORD}'`));

  const appUrl = buildAppUrl(container);

  return {
    elevatedUrl,
    appUrl,
    async reset(): Promise<void> {
      // Every table except drizzle's migration bookkeeping. RESTART IDENTITY is harmless
      // (we have no sequences — IDs are client-generated UUIDv7) and CASCADE lets us
      // ignore FK ordering.
      await db.execute(sql`
        TRUNCATE TABLE
          webauthn_challenges, user_sessions, user_passkeys, theft_incident_animals, theft_incidents,
          events, animal_identifiers, animals, branding_registers, mobs, land_units, farm_users,
          enterprises, farms, businesses, users, regulatory_rates, veterinary_products
        RESTART IDENTITY CASCADE
      `);
    },
    async stop(): Promise<void> {
      await pool.end();
      await container.stop();
    },
  };
}

function buildAppUrl(container: StartedPostgreSqlContainer): string {
  const url = new URL(container.getConnectionUri());
  url.username = 'werf_app';
  url.password = APP_ROLE_PASSWORD;
  return url.toString();
}
