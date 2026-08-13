import { describe, expect, it } from 'vitest';
// Dev-only dependency, and only for the checks that compare the registry against the REAL
// schema — the table list and the credential columns below. A hand-copied list would defeat
// the point of both.
import { SCHEMA_TABLE_NAMES, users } from '@werf/db';
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
  farmJurisdiction: { [FARM_A]: 'ZA', [FARM_B]: 'ZA' },
};

// A row from each table, all belonging to farm B / business B / user B.
const farmBRows: Record<SyncedTable, Record<string, unknown>> = {
  businesses: { id: BIZ_B },
  farms: { id: FARM_B, business_id: BIZ_B },
  users: { id: USER_B },
  user_passkeys: { id: 'pk-b', user_id: USER_B },
  user_sessions: { id: 'sess-b', user_id: USER_B, active_farm_id: FARM_B },
  webauthn_challenges: { id: 'chal-b', user_id: USER_B },
  farm_users: { id: 'fu-b', farm_id: FARM_B, user_id: USER_B },
  enterprises: { id: 'ent-b', farm_id: FARM_B },
  land_units: { id: 'lu-b', farm_id: FARM_B },
  mobs: { id: 'mob-b', farm_id: FARM_B },
  animals: { id: 'animal-b', farm_id: FARM_B },
  animal_identifiers: { id: 'aid-b', farm_id: FARM_B },
  branding_registers: { id: 'brand-b', farm_id: FARM_B },
  events: { id: 'event-b', farm_id: FARM_B },
  regulatory_rates: { id: 'rate-za', jurisdiction: 'ZA' },
  veterinary_products: { id: 'vet-za', jurisdiction: 'ZA' },
  species_gestation: { id: 'gest-cattle', species: 'cattle', gestation_days: 283 },
  theft_incidents: { id: 'theft-b', farm_id: FARM_B },
  theft_incident_animals: { incident_id: 'theft-b', animal_id: 'animal-b', farm_id: FARM_B },
  attachments: {
    id: 'attach-b',
    farm_id: FARM_B,
    subject_type: 'animal',
    subject_id: 'animal-b',
  },
};

const userAFarms = [FARM_A];

describe('sync tenancy — classification vocabulary', () => {
  it('classifies every core table with a known classification', () => {
    const allowed: SyncClassification[] = ['farm-scoped', 'reference', 'server-only'];
    for (const c of Object.values(SYNC_CLASSIFICATIONS)) {
      expect(allowed).toContain(c);
    }

    // Sanity: an empty derivation would make the comparison below pass vacuously and the
    // guard would silently stop guarding.
    expect(SCHEMA_TABLE_NAMES.length).toBeGreaterThan(10);

    // Both directions on purpose. A table in the schema but not the registry is the leak this
    // guards against; a table in the registry but not the schema is a stale entry that would keep
    // emitting a sync rule for something that no longer exists.
    expect(Object.keys(SYNC_CLASSIFICATIONS).sort()).toEqual([...SCHEMA_TABLE_NAMES].sort());
  });

  it('gives farm-scoped and reference tables a scope, and server-only tables none', () => {
    for (const table of Object.keys(TENANCY) as SyncedTable[]) {
      const entry = TENANCY[table];
      if (entry.classification === 'server-only') {
        expect(entry.scope, `${table} is server-only and must not sync`).toBeUndefined();
      } else {
        expect(entry.scope, `${table} must declare how it ties to a tenant`).toBeDefined();
      }
    }
  });
});

describe('sync tenancy — no server-only leak', () => {
  it('never syncs a server-only table to anyone', () => {
    expect(SERVER_ONLY_TABLES).toContain('user_passkeys');
    expect(SERVER_ONLY_TABLES).toContain('user_sessions');
    expect(SERVER_ONLY_TABLES).toContain('webauthn_challenges');
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

  it('strips the PostGIS geometry from land_units — SQLite has no PostGIS', () => {
    // land_units syncs (the farmer edits camps offline) but the canonical `boundary`
    // geometry never reaches the device; the client reads `boundary_geojson` instead.
    expect(TENANCY.land_units.neverSyncColumns).toContain('boundary');
  });

  it('strips the PostGIS geometry from events — same dual-write as land', () => {
    // events sync (the farmer captures in the crush, offline) but the canonical `location`
    // geometry never reaches the device; the client reads `location_geojson` instead.
    expect(TENANCY.events.neverSyncColumns).toContain('location');
  });

  /**
   * The classification table makes an UNCLASSIFIED TABLE break the build. This does the
   * same for an unclassified credential COLUMN, which the table-level check cannot see.
   *
   * It reads the real column names out of the drizzle schema rather than a list kept by
   * hand, so adding the next `totp_…` or `…_secret` column to `users` fails here until
   * somebody decides, in writing, whether a device may hold it. That decision arriving by
   * default — because nobody remembered this file existed — is the failure mode; `users`
   * is bidirectional, so a column that syncs is a column a device can rewrite.
   */
  it('forces a decision on every new credential column in users', () => {
    const CREDENTIAL_PATTERN = /password|secret|totp|recovery|passkey|token/i;

    const credentialColumns = Object.values(users)
      .map((column) => (column as { name: string }).name)
      .filter((name) => CREDENTIAL_PATTERN.test(name));

    // Sanity: if this ever goes empty the assertion below passes vacuously and the guard
    // silently stops guarding.
    expect(credentialColumns.length).toBeGreaterThan(0);

    for (const column of credentialColumns) {
      expect(
        TENANCY.users.neverSyncColumns,
        `users.${column} looks like credential state but is not in neverSyncColumns — ` +
          'decide explicitly whether a device may hold it',
      ).toContain(column);
    }
  });
});

describe('sync tenancy — cross-farm isolation', () => {
  it('does not sync ANY of farm B’s farm-owned rows to farm A’s user', () => {
    for (const table of Object.keys(TENANCY) as SyncedTable[]) {
      // Reference data is shared — by jurisdiction, or globally where the fact is biological
      // rather than legal. Neither is owned by a farm, so both are covered separately below.
      const kind = TENANCY[table].scope?.kind;
      if (kind === 'reference-jurisdiction' || kind === 'reference-global') continue;
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

describe('sync tenancy — reference data by jurisdiction', () => {
  it('syncs a ZA rate to a ZA farm’s user', () => {
    expect(syncsToUser('regulatory_rates', { jurisdiction: 'ZA' }, userAFarms, graph)).toBe(true);
  });

  it('never syncs another jurisdiction’s rate to a ZA device', () => {
    // A ZA phone must not download Namibian withdrawal periods, even though NA farms
    // do not exist in v1 — the filter is the guard, not the absence of data.
    expect(syncsToUser('regulatory_rates', { jurisdiction: 'NA' }, userAFarms, graph)).toBe(false);
  });

  it('syncs a ZA veterinary product to a ZA farm, never another jurisdiction’s', () => {
    // The withdrawal-period source (FR-131) is filtered by the farm's jurisdiction, exactly
    // like regulatory_rates — the crush withdrawal check works offline off ZA products only.
    expect(syncsToUser('veterinary_products', { jurisdiction: 'ZA' }, userAFarms, graph)).toBe(
      true,
    );
    expect(syncsToUser('veterinary_products', { jurisdiction: 'NA' }, userAFarms, graph)).toBe(
      false,
    );
  });
});

describe('sync tenancy — global reference data', () => {
  /**
   * Species gestation (FR-121) is the first table classified `reference-global`, and the
   * distinction it draws is worth a test rather than a comment. A withdrawal period is a
   * REGISTRATION and stops at the border; a gestation period is biology and does not. So this
   * row is filtered by nothing — and the assertion below is that it reaches a farm whose
   * jurisdiction it does not carry, which is exactly what a jurisdiction-scoped table must not do.
   */
  it('syncs a gestation figure to any farm, because biology has no jurisdiction', () => {
    expect(syncsToUser('species_gestation', { species: 'cattle' }, userAFarms, graph)).toBe(true);
    expect(syncsToUser('species_gestation', { species: 'cattle' }, [FARM_B], graph)).toBe(true);
  });

  it('still syncs nothing to a connection that belongs to no farm', () => {
    // "Filtered by nothing" must not become "granted to anyone". A caller with no membership has
    // no business pulling any table, reference or otherwise.
    expect(syncsToUser('species_gestation', { species: 'cattle' }, [], graph)).toBe(false);
  });

  it('is owned by no farm, so it never appears in a farm-ownership answer', () => {
    expect(owningFarmIds('species_gestation', { species: 'cattle' }, graph)).toEqual([]);
  });
});
