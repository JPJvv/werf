import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit config. `generate` diffs the schema and writes SQL to ./migrations; that
 * SQL is a DRAFT — review it before committing (db.md). Extensions, the UUIDv7 function,
 * and RLS are hand-authored in the migrations, not generated from the table objects.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://werf:werf@localhost:5432/werf',
  },
});
