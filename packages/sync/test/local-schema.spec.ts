/**
 * The local SQLite/OPFS schema (phase-checklists.md 3a). `localSchema` is built purely from
 * `@powersync/common` — no OPFS, no WASM, no worker — so it can be exercised here in plain
 * Node, the way `local-database.ts`'s actual `PowerSyncDatabase` cannot be (see that file's
 * header): constructing one blocks forever waiting on browser APIs that do not exist under
 * vitest. This spec is what proves the SCHEMA is right; a real open is Playwright's job.
 */

import { describe, expect, it } from 'vitest';
import { localSchema } from '../src/local-schema';
import { LOCAL_SCHEMA_TABLES } from '../src/local-schema-tables.generated';
import { SERVER_ONLY_TABLES, TENANCY, type SyncedTable } from '../src/tenancy';

describe('the local schema', () => {
  it('holds a table for every non-server-only entry in TENANCY', () => {
    const localTableNames = new Set(LOCAL_SCHEMA_TABLES.map((t) => t.name));
    for (const tableName of Object.keys(TENANCY) as SyncedTable[]) {
      if (TENANCY[tableName].classification === 'server-only') continue;
      if (tableName === 'theft_incident_animals') continue; // known gap, asserted below
      expect(localTableNames, `${tableName} should have a local table`).toContain(tableName);
    }
  });

  it('never holds a server-only table — a stolen phone must not carry a payslip', () => {
    const localTableNames = new Set(LOCAL_SCHEMA_TABLES.map((t) => t.name));
    for (const table of SERVER_ONLY_TABLES) {
      expect(localTableNames.has(table), `${table} is server-only and must not sync`).toBe(false);
    }
  });

  it('never holds a neverSyncColumns column — secrets and PostGIS geometry stay on the server', () => {
    for (const tableName of Object.keys(TENANCY) as SyncedTable[]) {
      const entry = TENANCY[tableName];
      const localTable = LOCAL_SCHEMA_TABLES.find((t) => t.name === tableName);
      if (!localTable || !entry.neverSyncColumns) continue;
      const localColumnNames = localTable.columns.map((c) => c.name);
      for (const column of entry.neverSyncColumns) {
        expect(localColumnNames, `${tableName}.${column} must never reach a device`).not.toContain(
          column,
        );
      }
    }
  });

  it('excludes theft_incident_animals — no surrogate id, so no PowerSync row identity yet', () => {
    // ⛔ Known gap (derive-local-schema.ts): a composite-PK table with no `id` column cannot be
    // represented as a PowerSync row. This test is the thing that stops the exclusion going
    // stale silently — if a migration ever adds the surrogate id, this starts failing and says
    // so, rather than the table just quietly staying absent forever.
    expect(LOCAL_SCHEMA_TABLES.map((t) => t.name)).not.toContain('theft_incident_animals');
    expect(TENANCY.theft_incident_animals.classification).toBe('farm-scoped');
  });

  it('gives every local column one of the three SQLite affinities', () => {
    for (const table of LOCAL_SCHEMA_TABLES) {
      for (const column of table.columns) {
        expect(['TEXT', 'INTEGER', 'REAL'], `${table.name}.${column.name}`).toContain(column.type);
      }
    }
  });

  it('strips land_units.boundary and events.location — SQLite has no PostGIS', () => {
    const landUnits = LOCAL_SCHEMA_TABLES.find((t) => t.name === 'land_units');
    const events = LOCAL_SCHEMA_TABLES.find((t) => t.name === 'events');
    expect(landUnits?.columns.map((c) => c.name)).not.toContain('boundary');
    expect(landUnits?.columns.map((c) => c.name)).toContain('boundary_geojson');
    expect(events?.columns.map((c) => c.name)).not.toContain('location');
    expect(events?.columns.map((c) => c.name)).toContain('location_geojson');
  });

  it('builds a real @powersync/common Schema with a matching table set', () => {
    // The Schema constructor is pure (no I/O) — see local-schema.ts's header — so building and
    // reading it back is safe here, unlike opening the actual PowerSyncDatabase.
    const schemaTableNames = localSchema.tables.map((t) => t.name).sort();
    const expectedNames = LOCAL_SCHEMA_TABLES.map((t) => t.name).sort();
    expect(schemaTableNames).toEqual(expectedNames);
  });

  it('does not choke on validate() — the same check PowerSync itself runs before opening', () => {
    expect(() => localSchema.validate()).not.toThrow();
  });
});
