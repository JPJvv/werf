/**
 * Drizzle schema, migrations, and RLS policies live here. EVERY domain table carries
 * `farm_id`, `deleted_at` (soft delete only), a client-generated UUIDv7 PK, audit
 * columns, and — where regulated — `jurisdiction char(2)`. RLS + FORCE ROW LEVEL
 * SECURITY are applied in the migrations (SQL), not in the Drizzle table objects.
 * See docs/03-architecture/database-schema.md and .claude/rules/db.md.
 */

export * from './schema';
export * from './client';

/** Bumped when the schema shape changes. Phase 1 introduces the identity & tenancy core. */
export const SCHEMA_VERSION = 1;
