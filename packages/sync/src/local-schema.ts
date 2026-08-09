/**
 * The client's local SQLite/OPFS schema (ADR-0003, phase-checklists.md 3a). Built purely from
 * `@powersync/common` — never `@powersync/web` — so this module stays safe to import from
 * anywhere in this package, including tests that run in plain Node with no OPFS/WASM engine
 * available. `@powersync/common`'s `Schema`/`Table`/`Column` classes are inert data: building
 * one does no I/O and opens nothing.
 *
 * The table list is DERIVED, not hand-written: `scripts/derive-local-schema.ts` reads it off
 * `TENANCY` (this package) and the real Postgres schema (`@werf/db`) and
 * `scripts/generate-local-schema.ts` writes the result to `local-schema-tables.generated.ts`.
 * That derivation cannot live here — `@werf/db` pulls in `pg`, which breaks the browser bundle
 * apps/web builds from this package's source (see the derivation module's own header) — so this
 * file only turns the generated DATA into the `@powersync/common` schema OBJECT the SDK wants.
 *
 * `local-database.ts` is the only other file in this package allowed to import `@powersync/web`
 * itself; everything else, including this file, touches only the pure `@powersync/common` layer.
 */

import { column, Schema, Table, type BaseColumnType } from '@powersync/common';
import { LOCAL_SCHEMA_TABLES } from './local-schema-tables.generated';

export type LocalColumnType = 'TEXT' | 'INTEGER' | 'REAL';

export interface LocalColumnDef {
  readonly name: string;
  readonly type: LocalColumnType;
}

export interface LocalTableDef {
  readonly name: string;
  readonly columns: readonly LocalColumnDef[];
}

const POWERSYNC_COLUMN_TYPE: Readonly<
  Record<LocalColumnType, BaseColumnType<string | number | null>>
> = {
  TEXT: column.text,
  INTEGER: column.integer,
  REAL: column.real,
};

function toTable(def: LocalTableDef): Table {
  return new Table(
    Object.fromEntries(def.columns.map((c) => [c.name, POWERSYNC_COLUMN_TYPE[c.type]])),
    { viewName: def.name },
  );
}

export type LocalSchema = Schema;

/**
 * One table per non-`server-only` entry in `TENANCY`. A `server-only` table (payroll,
 * sessions, WebAuthn secrets) never appears here — the same posture the sync rules enforce,
 * from the same registry, so the two cannot say different things about what a device may hold.
 */
export const localSchema: LocalSchema = new Schema(
  Object.fromEntries(LOCAL_SCHEMA_TABLES.map((table) => [table.name, toTable(table)])),
);
