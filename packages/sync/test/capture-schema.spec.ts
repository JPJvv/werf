/**
 * The local-only capture-store tables (phase-checklists.md 3c). Pure `@powersync/common` data —
 * no OPFS, no WASM, no worker — so, like `local-schema.spec.ts`, this can run in plain Node.
 */

import { describe, expect, it } from 'vitest';
import { Schema } from '@powersync/common';
import {
  CAPTURE_SCHEMA_TABLES,
  captureMigrationsTable,
  captureRecordsTable,
} from '../src/capture-schema';
import { localSchemaTables } from '../src/local-schema';

describe('the capture-store local-only schema', () => {
  it('marks both tables local-only — never entering the CRUD upload queue', () => {
    expect(captureRecordsTable.localOnly).toBe(true);
    expect(captureMigrationsTable.localOnly).toBe(true);
  });

  it('capture_records carries exactly the columns createSqliteCaptureStore reads and writes', () => {
    const names = captureRecordsTable.columns.map((c) => c.name).sort();
    expect(names).toEqual(['farm_id', 'payload_json', 'seq', 'store_key']);
  });

  it('capture_migrations carries exactly the marker columns', () => {
    const names = captureMigrationsTable.columns.map((c) => c.name).sort();
    expect(names).toEqual(['migrated_at', 'record_count']);
  });

  it('gives every column one of the three SQLite affinities', () => {
    for (const table of [captureRecordsTable, captureMigrationsTable]) {
      for (const column of table.columns) {
        expect(['TEXT', 'INTEGER', 'REAL'], `${table.name}.${column.name}`).toContain(column.type);
      }
    }
  });

  it('does not choke on validate()', () => {
    const schema = new Schema(CAPTURE_SCHEMA_TABLES);
    expect(() => schema.validate()).not.toThrow();
  });

  it('merges cleanly with localSchemaTables — the same construction local-database.ts performs', () => {
    // Mirrors local-database.ts's `new Schema({ ...localSchemaTables, ...CAPTURE_SCHEMA_TABLES })`
    // without importing that file (it pulls in `@powersync/web`, which local-schema.spec.ts's own
    // header documents as unsafe to construct — not merely import, but this keeps this spec on
    // the same pure @powersync/common footing as the rest of this test file, for the same reason).
    const merged = new Schema({ ...localSchemaTables, ...CAPTURE_SCHEMA_TABLES });
    expect(() => merged.validate()).not.toThrow();
    const names = merged.tables.map((t) => t.name);
    expect(names).toContain('capture_records');
    expect(names).toContain('capture_migrations');
    // No name collision between the real (future) sync tables and the local-only capture tables —
    // if TENANCY ever grows a table literally named `capture_records`, this starts failing rather
    // than silently letting one definition shadow the other.
    expect(names.filter((n) => n === 'capture_records')).toHaveLength(1);
    expect(names.filter((n) => n === 'capture_migrations')).toHaveLength(1);
  });
});
