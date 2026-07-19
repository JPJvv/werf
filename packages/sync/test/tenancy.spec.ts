import { describe, expect, it } from 'vitest';
import {
  SERVER_ONLY_TABLES,
  SYNC_CLASSIFICATIONS,
  TENANCY,
  owningFarmIds,
  syncsToUser,
  type FarmGraph,
  type SyncClassification,
  type SyncedTable,
} from '../src/index';

/**
 * The tenancy invariant: sync must not put a row on a device that its owner's RLS would
 * not grant, and no server-only table (or secret column) may ever reach a device. Because
 * sync rules and RLS are derived from the one `TENANCY` registry, "they agree" is proven
 * by exercising that registry against a concrete two-farm fixture and showing farm B never
 * leaks onto farm A's phone.
 */

// ── Fixture: two unrelated businesses, one farm each, one user each ─────────────
const BIZ_A = 'biz-a';
const BIZ_B = 'biz-b';
const FARM_A = 'farm-a';
const FARM_B = 'farm-b';
const USER_A = 'user-a';
const USER_B = 'user-b';

const graph: FarmGraph = {
  farmBusiness: { [FARM_A]: BIZ_A, [FARM_B]: BIZ_B },
  membership: { [USER_A]: [FARM_A], [USER_B]: [FARM_B] },
};

// A row from each table, all belonging to farm B / business B / user B.
const farmBRows: Record<SyncedTable, Record<string, unknown>> = {
  businesses: { id: BIZ_B },
  farms: { id: FARM_B, business_id: BIZ_B },
  users: { id: USER_B },
  user_passkeys: { id: 'pk-b', user_id: USER_B },
  farm_users: { id: 'fu-b', farm_id: FARM_B, user_id: USER_B },
  enterprises: { id: 'ent-b', farm_id: FARM_B },
};

const userAFarms = [FARM_A];

describe('sync tenancy — classification vocabulary', () => {
  it('classifies every core table with a known classification', () => {
    const allowed: SyncClassification[] = ['farm-scoped', 'reference', 'server-only'];
    for (const c of Object.values(SYNC_CLASSIFICATIONS)) {
      expect(allowed).toContain(c);
    }
    expect(Object.keys(SYNC_CLASSIFICATIONS).sort()).toEqual(
      ['businesses', 'enterprises', 'farm_users', 'farms', 'user_passkeys', 'users'].sort(),
    );
  });

  it('gives every farm-scoped table a farm scope and every server-only table none', () => {
    for (const table of Object.keys(TENANCY) as SyncedTable[]) {
      const entry = TENANCY[table];
      if (entry.classification === 'farm-scoped') {
        expect(entry.scope, `${table} must declare how it ties to a farm`).toBeDefined();
      } else {
        expect(entry.scope, `${table} is not farm-scoped`).toBeUndefined();
      }
    }
  });
});

describe('sync tenancy — no server-only leak', () => {
  it('never syncs a server-only table to anyone', () => {
    expect(SERVER_ONLY_TABLES).toContain('user_passkeys');
    for (const table of SERVER_ONLY_TABLES) {
      expect(syncsToUser(table, farmBRows[table], userAFarms, graph)).toBe(false);
      // not even to its own owner
      expect(syncsToUser(table, farmBRows[table], [FARM_B], graph)).toBe(false);
    }
  });

  it('strips secret columns from tables that do sync', () => {
    // The user row syncs (identity) but its credentials never do.
    expect(TENANCY.users.neverSyncColumns).toEqual(
      expect.arrayContaining(['password_hash', 'totp_secret_encrypted', 'recovery_codes_hashed']),
    );
  });
});

describe('sync tenancy — cross-farm isolation', () => {
  it('does not sync ANY of farm B’s rows to farm A’s user', () => {
    for (const table of Object.keys(TENANCY) as SyncedTable[]) {
      expect(
        syncsToUser(table, farmBRows[table], userAFarms, graph),
        `${table}: farm B row leaked to farm A`,
      ).toBe(false);
    }
  });

  it('does sync farm B’s farm-scoped rows to farm B’s own user', () => {
    for (const table of Object.keys(TENANCY) as SyncedTable[]) {
      if (TENANCY[table].classification !== 'farm-scoped') continue;
      expect(
        syncsToUser(table, farmBRows[table], [FARM_B], graph),
        `${table}: owner cannot see their own row`,
      ).toBe(true);
    }
  });

  it('resolves owning farms through the business and membership graph', () => {
    expect(owningFarmIds('businesses', { id: BIZ_B }, graph)).toEqual([FARM_B]);
    expect(owningFarmIds('users', { id: USER_B }, graph)).toEqual([FARM_B]);
    expect(owningFarmIds('enterprises', { farm_id: FARM_B }, graph)).toEqual([FARM_B]);
  });
});
