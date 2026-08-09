import { describe, expect, it } from 'vitest';
import { renderSyncRulesYaml, type SyncRulesBucketDef } from '../src/sync-rules';
import { deriveSyncRulesBuckets } from '../scripts/derive-sync-rules';
import { TENANCY, type SyncedTable } from '../src/tenancy';

/**
 * `renderSyncRulesYaml` is pure string assembly — it trusts its input completely, which is why
 * `deriveSyncRulesBuckets` (tested below and in sync-rules-freshness.spec.ts) is where the
 * tenancy guarantee actually has to live. These tests prove both halves: the renderer does
 * exactly what a `filterColumn` (or its absence) tells it to, and the deriver never hands it a
 * farm-scoped table with no `filterColumn` to render.
 */

describe('sync rules — renderer', () => {
  it('filters a data query by the bucket parameter when filterColumn is set', () => {
    const bucket: SyncRulesBucketDef = {
      name: 'by_farm',
      paramName: 'farm_id',
      parametersQuery: 'SELECT farm_id FROM farm_users WHERE user_id = request.user_id()',
      tables: [{ table: 'mobs', columns: ['id', 'farm_id', 'name'], filterColumn: 'farm_id' }],
    };
    const yaml = renderSyncRulesYaml([bucket]);
    expect(yaml).toContain('SELECT id, farm_id, name FROM mobs WHERE farm_id = bucket.farm_id');
  });

  it('⛔ renders an UNFILTERED data query when filterColumn is omitted — proving the renderer', () => {
    // adds no safety of its own. This is deliberately what a leak looks like: every instance of
    // the bucket would carry every row of the table. The deriver test below is what stops a
    // farm-scoped table ever reaching the renderer in this shape.
    const bucket: SyncRulesBucketDef = {
      name: 'by_farm',
      paramName: 'farm_id',
      parametersQuery: 'SELECT farm_id FROM farm_users WHERE user_id = request.user_id()',
      tables: [{ table: 'mobs', columns: ['id', 'farm_id', 'name'] }],
    };
    const yaml = renderSyncRulesYaml([bucket]);
    const dataLine = yaml.split('\n').find((line) => line.includes('FROM mobs'));
    expect(dataLine).toBe('      - SELECT id, farm_id, name FROM mobs');
  });
});

describe('sync rules — deriver never leaks a farm-scoped table unconditionally', () => {
  it('gives every by_farm table a filterColumn, except the documented global-reference rider', () => {
    const byFarm = deriveSyncRulesBuckets().find((b) => b.name === 'by_farm');
    expect(byFarm).toBeDefined();
    for (const t of byFarm!.tables) {
      if (t.table === 'species_gestation') continue; // reference-global: no farm owns it (tenancy.ts)
      expect(
        t.filterColumn,
        `${t.table} has no filterColumn — would sync unconditionally to every farm bucket instance`,
      ).toBeDefined();
    }
  });

  it('never emits a neverSyncColumns entry in a rendered data query', () => {
    const lines = renderSyncRulesYaml(deriveSyncRulesBuckets()).split('\n');
    for (const table of Object.keys(TENANCY) as SyncedTable[]) {
      const neverSync = TENANCY[table].neverSyncColumns ?? [];
      if (neverSync.length === 0) continue;
      const dataLine = lines.find((line) => new RegExp(`FROM ${table}\\b`).test(line));
      if (!dataLine) continue; // table has no bucket at all (NOT_YET_EXPRESSIBLE) — nothing to check
      for (const column of neverSync) {
        expect(
          dataLine,
          `${table}.${column} is a neverSyncColumn but appears in its rendered data query`,
        ).not.toMatch(new RegExp(`\\b${column}\\b`));
      }
    }
  });

  it('never emits a bucket for a server-only table', () => {
    const yaml = renderSyncRulesYaml(deriveSyncRulesBuckets());
    const serverOnly = (Object.keys(TENANCY) as SyncedTable[]).filter(
      (t) => TENANCY[t].classification === 'server-only',
    );
    expect(serverOnly.length).toBeGreaterThan(0); // sanity: a vacuous list passes vacuously
    for (const table of serverOnly) {
      expect(yaml).not.toMatch(new RegExp(`FROM ${table}\\b`));
    }
  });

  it('documents, rather than silently drops, the tables classic Sync Rules cannot express', () => {
    const yaml = renderSyncRulesYaml(deriveSyncRulesBuckets());
    // businesses/regulatory_rates/veterinary_products need a two-hop JOIN classic Sync Rules
    // forbid (derive-sync-rules.ts's header) — proving they are ABSENT here is only useful
    // alongside the generated file's header comment saying so out loud; see
    // sync-rules-freshness.spec.ts for the header-drift check.
    expect(yaml).not.toMatch(/FROM businesses\b/);
    expect(yaml).not.toMatch(/FROM regulatory_rates\b/);
    expect(yaml).not.toMatch(/FROM veterinary_products\b/);
  });
});
