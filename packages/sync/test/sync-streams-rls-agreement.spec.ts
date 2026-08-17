/**
 * Sync rules and Postgres RLS are two systems with one invariant and a silent failure mode
 * (db.md, tenancy.ts's header): a permissive sync rule leaks across farms even when every RLS
 * policy is perfect, because replication bypasses the query path RLS protects. `tenancy.spec.ts`
 * proves the ABSTRACT predicate (`syncsToUser`) is tenant-safe; this file proves the two REAL,
 * checked-in artifacts — the RLS migrations and `infra/powersync/sync-config.yaml` — actually
 * agree, by reading both off disk rather than trusting that they were kept in step by hand.
 *
 * Phase-checklists.md 3b: "PowerSync sync rules and Postgres RLS agree for every farm-scoped
 * table; the cross-farm tenancy test fails when either side is deliberately made permissive."
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderSyncStreamsYaml } from '../src/sync-streams';
import { deriveSyncStreams } from '../scripts/derive-sync-streams';
import { TENANCY, type SyncedTable } from '../src/tenancy';

const migrationsDir = fileURLToPath(new URL('../../db/migrations', import.meta.url));
const expirySweepPath = fileURLToPath(
  new URL('../../../apps/api/src/sync/membership-expiry.service.ts', import.meta.url),
);

function allMigrationsText(): string {
  return readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => readFileSync(`${migrationsDir}/${name}`, 'utf-8'))
    .join('\n');
}

describe('sync streams agree with RLS — tenant-scoped tables', () => {
  const migrations = allMigrationsText();
  const tenantScoped = deriveSyncStreams().filter((s) => {
    const kind = TENANCY[s.table as SyncedTable].scope?.kind;
    return kind === 'direct' || kind === 'via-business' || kind === 'via-membership';
  });

  it.each(tenantScoped.map((s) => s.table))(
    '%s has an RLS policy built on app_user_farm_ids(), the same function the stream mirrors',
    (table) => {
      const policyBlock = new RegExp(
        `CREATE POLICY [a-z_]+ ON "?${table}"?[\\s\\S]{0,500}?app_user_farm_ids\\(\\)`,
      );
      expect(
        migrations,
        `no RLS policy referencing app_user_farm_ids() found for "${table}" — sync stream and ` +
          'RLS may have drifted, or this table needs a new migration before it can sync',
      ).toMatch(policyBlock);
    },
  );

  it('sanity: covers more than the direct-only set the classic-rules attempt was limited to', () => {
    // businesses and users are the two tables the classic bucket_definitions format could not
    // express at all (git history) — Streams' subquery support resolves both. This is the
    // regression guard for that resolution silently disappearing.
    const tables = tenantScoped.map((s) => s.table);
    expect(tables).toContain('businesses');
    expect(tables).toContain('users');
  });
});

describe('sync streams agree with RLS — reference data is openly readable, not tenancy-gated', () => {
  const migrations = allMigrationsText();
  const referenceScoped = deriveSyncStreams().filter((s) => {
    const kind = TENANCY[s.table as SyncedTable].scope?.kind;
    return kind === 'reference-jurisdiction' || kind === 'reference-global';
  });

  it.each(referenceScoped.map((s) => s.table))(
    '%s RLS is FOR SELECT USING (true) — jurisdiction/global filtering is a sync-side concern, not an RLS one',
    (table) => {
      expect(
        migrations,
        `expected "${table}" RLS to be openly readable (FOR SELECT USING (true)) — if this ` +
          'table gained real per-tenant RLS, its stream should be checked for the same predicate',
      ).toMatch(new RegExp(`CREATE POLICY [a-z_]+ ON "?${table}"? FOR SELECT USING \\(true\\)`));
    },
  );
});

describe('sync streams agree with RLS — expires_at is bridged through the shared tombstone', () => {
  const migrations = allMigrationsText();
  const expirySweep = readFileSync(expirySweepPath, 'utf-8');
  const streams = deriveSyncStreams();

  it('RLS enforces farm_users.expires_at — proving the gap below is real, not assumed', () => {
    // 0004_membership_acceptance.sql's CREATE OR REPLACE is the LIVE definition of
    // app_user_farm_ids(); Postgres keeps only the latest body for a given function name.
    expect(migrations).toMatch(/expires_at IS NULL OR expires_at > now\(\)/);
  });

  it('no generated stream sends now() to PowerSync, whose validator rejects it', () => {
    const yaml = renderSyncStreamsYaml(streams);
    expect(
      yaml,
      'a stream started checking expires_at — either the self-hosted service gained a ' +
        'deterministic way to express it (update this test and derive-sync-streams.ts together, ' +
        'and re-confirm against a real instance), or this assertion should not have passed',
    ).not.toContain('expires_at IS NULL OR expires_at >');
  });

  it('every stream consumes the deleted_at tombstone the expiry sweep produces', () => {
    for (const stream of streams) {
      expect(
        stream.whereSql,
        `${stream.table}'s stream no longer consumes the membership tombstone`,
      ).toContain('deleted_at IS NULL');
    }

    // This intentionally reads the checked-in job just as the tests above read checked-in
    // migrations. The real-Postgres integration test proves its behaviour; this assertion proves
    // the two separately implemented security artifacts still meet on the same exact signal.
    expect(expirySweep).toMatch(/isNull\(farmUsers\.deletedAt\)/);
    expect(expirySweep).toMatch(/isNotNull\(farmUsers\.expiresAt\)/);
    expect(expirySweep).toMatch(/lte\(farmUsers\.expiresAt, sql`now\(\)`\)/);
    expect(expirySweep).toMatch(/deletedAt: sql`now\(\)`/);
  });

  it('bounds the expiry bridge to a one-minute sweep cadence', () => {
    expect(expirySweep).toContain("MEMBERSHIP_EXPIRY_SWEEP_CRON = '0 * * * * *'");
  });
});
