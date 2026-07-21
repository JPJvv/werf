/**
 * Column primitives every table reuses. Encoding the non-negotiables (UUIDv7 PKs,
 * soft-delete tombstones, audit timestamps) in one place means a new table cannot
 * quietly forget them. See .claude/rules/db.md and docs/03-architecture/database-schema.md.
 */

import { sql } from 'drizzle-orm';
import { customType, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * `bytea`. Used for secrets that must never leave the server: the encrypted TOTP seed
 * and passkey material. Typed as Uint8Array so the schema needs no Node `Buffer` types
 * (the pg driver returns a Buffer, which is a Uint8Array).
 */
export const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType() {
    return 'bytea';
  },
});

/** `citext`. Case-insensitive text, so `Thabo@Farm.test` and `thabo@farm.test` are one email. */
export const citext = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'citext';
  },
});

/**
 * Client-generated UUIDv7 primary key. The DB `uuid_generate_v7()` default is a
 * server-side fallback (seed rows); the offline client always supplies its own id,
 * because it cannot ask a sequence for one. v7 (not v4) keeps index locality.
 */
export const primaryId = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuid_generate_v7()`);

const tz = (name: string) => timestamp(name, { withTimezone: true });

/**
 * Audit + soft-delete columns. `deleted_at` is a tombstone: a hard DELETE breaks
 * replication and destroys records the BCEA requires us to keep.
 */
export const auditColumns = {
  createdAt: tz('created_at').notNull().defaultNow(),
  updatedAt: tz('updated_at').notNull().defaultNow(),
  deletedAt: tz('deleted_at'),
};
