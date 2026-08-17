import { describe, expect, it } from 'vitest';
import { renderSyncStreamsYaml, type SyncStreamDef } from '../src/sync-streams';
import { deriveSyncStreams } from '../scripts/derive-sync-streams';
import { TENANCY, type SyncedTable } from '../src/tenancy';

/**
 * `renderSyncStreamsYaml` is pure string assembly — it trusts its input completely, which is
 * why `deriveSyncStreams` (tested below and in sync-streams-freshness.spec.ts) is where the
 * tenancy guarantee actually has to live. Same split as the classic-rules attempt these tests
 * replace (git history), now targeting the format that actually validates against a real
 * self-hosted instance — see sync-streams.ts's header for the empirical evidence.
 */

describe('sync streams — renderer', () => {
  it('renders a stream with an explicit column list and a WHERE clause', () => {
    const stream: SyncStreamDef = {
      name: 'mobs',
      table: 'mobs',
      columns: ['id', 'farm_id', 'name'],
      whereSql: 'farm_id IN (SELECT farm_id FROM farm_users WHERE user_id = auth.user_id())',
    };
    const yaml = renderSyncStreamsYaml([stream]);
    expect(yaml).toContain('config:\n  edition: 3\n');
    expect(yaml).toContain('  mobs:\n    query: |\n      SELECT id, farm_id, name FROM mobs\n');
    expect(yaml).toContain(
      'WHERE farm_id IN (SELECT farm_id FROM farm_users WHERE user_id = auth.user_id())',
    );
  });
});

describe('sync streams — deriver expresses every table TENANCY says may sync', () => {
  it('emits a stream for every non-server-only TENANCY table (issue #10 closed, P2.6)', () => {
    const streams = deriveSyncStreams();
    const streamTables = new Set(streams.map((s) => s.table));
    for (const table of Object.keys(TENANCY) as SyncedTable[]) {
      if (TENANCY[table].classification === 'server-only') {
        expect(streamTables.has(table), `${table} is server-only but has a stream`).toBe(false);
        continue;
      }
      expect(streamTables.has(table), `${table} is synced by TENANCY but has no stream`).toBe(true);
    }
  });

  it('⛔ every farm-owned table filters through farm_users — proving no unconditional leak', () => {
    // The same "deliberately made permissive fails" proof as the classic-rules attempt: every
    // stream whose table has an owning farm (i.e. not reference-global) must reference
    // farm_users somewhere in its predicate. species_gestation is the one documented exception —
    // reference-global data is filtered by nothing farm-shaped, only gated on farm membership
    // existing at all (still via farm_users, so it's covered by the same assertion).
    for (const stream of deriveSyncStreams()) {
      expect(stream.whereSql, `${stream.table}'s predicate does not reference farm_users`).toMatch(
        /farm_users/,
      );
    }
  });

  it('never emits a neverSyncColumns entry in a rendered stream query', () => {
    const yaml = renderSyncStreamsYaml(deriveSyncStreams());
    const lines = yaml.split('\n');
    for (const table of Object.keys(TENANCY) as SyncedTable[]) {
      const neverSync = TENANCY[table].neverSyncColumns ?? [];
      if (neverSync.length === 0) continue;
      const selectLine = lines.find((line) => new RegExp(`FROM ${table}\\b`).test(line));
      if (!selectLine) continue; // no stream at all for this table
      for (const column of neverSync) {
        expect(
          selectLine,
          `${table}.${column} is a neverSyncColumn but appears in its rendered SELECT`,
        ).not.toMatch(new RegExp(`\\b${column}\\b`));
      }
    }
  });

  it('3f bounds events by authorised farm/month equality buckets, never a moving range', () => {
    const events = deriveSyncStreams().find((stream) => stream.table === 'events');
    expect(events).toBeDefined();
    expect(events?.autoSubscribe).toBe(false);
    expect(events?.acceptPotentiallyDangerousQueries).toBe(true);
    expect(events?.whereSql).toContain("farm_id = subscription.parameter('farm_id')");
    expect(events?.whereSql).toContain(
      "substring(occurred_at, 1, 7) = subscription.parameter('month')",
    );
    expect(events?.whereSql).toContain('farm_id IN (SELECT farm_id FROM farm_users');
    expect(events?.whereSql).not.toMatch(/occurred_at\s*[<>]=?/);

    const yaml = renderSyncStreamsYaml([events!]);
    expect(yaml).toContain('auto_subscribe: false');
    expect(yaml).toContain('accept_potentially_dangerous_queries: true');
  });
});
