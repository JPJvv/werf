/**
 * Drizzle schema, migrations, and RLS policies live here. Phase 0 is an empty scaffold:
 * there are no domain tables yet. When they arrive (Phase 1+) EVERY domain table carries
 * `farm_id`, `deleted_at` (soft delete only), UUIDv7 PKs, `occurred_at` where something
 * happened, RLS + FORCE ROW LEVEL SECURITY, and a `jurisdiction char(2)` on anything
 * regulated. See docs/03-architecture/database-schema.md and .claude/rules/db.md.
 */

export const SCHEMA_VERSION = 0;
