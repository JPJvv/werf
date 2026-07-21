// Applies pending Drizzle migrations to DATABASE_URL. Migrations are plain SQL split on
// `--> statement-breakpoint`, so extensions, the UUIDv7 function, and RLS all apply here
// alongside the generated table DDL. Forward-only: never edit an applied migration, write
// a new one (db.md). Runs as the migration/owner role, which may be a superuser — that is
// fine and intended for provisioning; the app connects as the non-superuser `werf_app`.
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const url = process.env.DATABASE_URL ?? 'postgres://werf:werf@localhost:5432/werf';
const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

const pool = new pg.Pool({ connectionString: url });
try {
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder });
  console.log('[@werf/db] migrations applied ✓');
} catch (err) {
  console.error('[@werf/db] migration failed:', err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
