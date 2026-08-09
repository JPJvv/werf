/**
 * Sync rules and Postgres RLS are two systems with one invariant and a silent failure mode
 * (db.md, tenancy.ts's header): a permissive sync rule leaks across farms even when every RLS
 * policy is perfect, because replication bypasses the query path RLS protects. `tenancy.spec.ts`
 * proves the ABSTRACT predicate (`syncsToUser`) is tenant-safe; this file proves the two REAL,
 * checked-in artifacts — the RLS migrations and the generated sync-rules YAML — actually agree,
 * by reading both off disk rather than trusting that they were kept in step by hand.
 *
 * Phase-checklists.md 3b: "PowerSync sync rules and Postgres RLS agree for every farm-scoped
 * table; the cross-farm tenancy test fails when either side is deliberately made permissive."
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderSyncRulesYaml } from '../src/sync-rules';
import { deriveSyncRulesBuckets } from '../scripts/derive-sync-rules';

const migrationsDir = fileURLToPath(new URL('../../db/migrations', import.meta.url));

function allMigrationsText(): string {
  return readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => readFileSync(`${migrationsDir}/${name}`, 'utf-8'))
    .join('\n');
}

describe('sync rules agree with RLS — every table the generator actually syncs', () => {
  const migrations = allMigrationsText();
  const byFarm = deriveSyncRulesBuckets().find((b) => b.name === 'by_farm')!;

  it.each(byFarm.tables.filter((t) => t.filterColumn).map((t) => t.table))(
    '%s has an RLS policy built on app_user_farm_ids(), the same function the sync rule mirrors',
    (table) => {
      // Table names appear quoted ("land_units") in drizzle-generated migrations and bare
      // (regulatory_rates) in hand-written ones — match either.
      const policyBlock = new RegExp(
        `CREATE POLICY [a-z_]+ ON "?${table}"?[\\s\\S]{0,400}?app_user_farm_ids\\(\\)`,
      );
      expect(
        migrations,
        `no RLS policy referencing app_user_farm_ids() found for "${table}" — sync rule and RLS ` +
          'may have drifted, or this table needs a new migration before it can sync',
      ).toMatch(policyBlock);
    },
  );

  it('farms uses id (not farm_id) as its own tenancy column, on both sides', () => {
    const farmsTable = byFarm.tables.find((t) => t.table === 'farms');
    expect(farmsTable?.filterColumn).toBe('id');
    expect(migrations).toMatch(/CREATE POLICY farms_tenant ON farms\s+USING \(id IN/);
  });
});

describe('sync rules agree with RLS — the documented expires_at gap', () => {
  const migrations = allMigrationsText();

  it('RLS enforces farm_users.expires_at — proving the gap below is real, not assumed', () => {
    // 0004_membership_acceptance.sql's CREATE OR REPLACE is the LIVE definition of
    // app_user_farm_ids(); Postgres keeps only the latest body for a given function name.
    expect(migrations).toMatch(/expires_at IS NULL OR expires_at > now\(\)/);
  });

  it('⛔ the generated sync rule does NOT enforce expires_at — supported SQL has no now()', () => {
    const yaml = renderSyncRulesYaml(deriveSyncRulesBuckets());
    const parametersLine = yaml
      .split('\n')
      .find((line) => line.includes('parameters:') && line.includes('farm_users'));
    expect(parametersLine).toBeDefined();
    expect(
      parametersLine,
      'the by_farm parameters query started checking expires_at — either PowerSync gained a ' +
        'deterministic way to express it (update this test and derive-sync-rules.ts together), ' +
        "or this assertion should not have passed and the query won't validate against the " +
        'real service in task 3c',
    ).not.toContain('expires_at');
  });
});
