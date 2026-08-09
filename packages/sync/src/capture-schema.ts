/**
 * The local-only SQLite tables backing `createSqliteCaptureStore` (phase-checklists.md 3c).
 *
 * Deliberately NOT derived from `TENANCY`/Postgres like `local-schema.ts` — these two tables are
 * local-only device state, not the future sync target that module represents. `localOnly: true`
 * (verified against the installed `@powersync/common` SDK) keeps every row here OUT of
 * PowerSync's CRUD upload queue: this slice keeps `apps/web/src/sync/Outbox.tsx` as the sole
 * uploader, still flushing to the existing `/api/*` REST endpoints, so a capture landing here
 * must never be picked up by a future `uploadData` as if it were a queued sync write.
 *
 * One GENERIC table across every capture kind, not one per kind, because that is what the
 * current `localStorage` behaviour already is: `capture-store.ts`'s `persist()` does exactly one
 * `JSON.stringify(records)` per key, no per-field decomposition. Keeping `capture_records` shaped
 * this way means `createSqliteCaptureStore<T>` stays generic — the seam contract forbids
 * `CaptureStore<T>` changing shape — and a future 13th capture kind touches no schema code.
 */

import { column, Table } from '@powersync/common';

/**
 * One row per captured record, across every capture kind. Row `id` (PowerSync's implicit TEXT
 * primary key on every table) is the record's own client-generated UUIDv7 `id` — already
 * globally unique, so no composite key is needed.
 */
export const captureRecordsTable = Table.createLocalOnly({
  // "werf-<name>:<farmId>" — the exact string the old localStorage key was, and still is: it is
  // how `createSqliteCaptureStore` finds this store's rows and how `migrateIfNeeded` finds the
  // legacy array to migrate from.
  store_key: column.text,
  // Redundant with store_key's suffix; kept only so a debug query can filter by farm directly
  // without parsing the key.
  farm_id: column.text,
  // Monotonic order within one store_key, assigned at append/migration time. `ORDER BY seq ASC`
  // reproduces the exact append order a JSON array already preserved — not "whatever order the
  // ids happen to sort to" — which is the ordering `Outbox.tsx`'s FK/guardedBy/needsHead logic
  // depends on.
  seq: column.integer,
  // The whole record, `JSON.stringify`d — the record's own `id` is duplicated inside this blob,
  // which is fine: the row id is the source of truth for storage, this is the source of truth
  // for the record's shape.
  payload_json: column.text,
});

/**
 * One row per migrated store_key. Row `id` = the store_key itself; the row's PRESENCE is the
 * marker — no boolean column, so "has this key migrated" is a single indexed lookup, not a
 * lookup-then-branch-on-a-field.
 */
export const captureMigrationsTable = Table.createLocalOnly({
  migrated_at: column.text, // ISO 8601, when the transaction committed
  record_count: column.integer,
});

export const CAPTURE_SCHEMA_TABLES = {
  capture_records: captureRecordsTable,
  capture_migrations: captureMigrationsTable,
};
