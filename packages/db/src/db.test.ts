import { describe, expect, it } from 'vitest';
import {
  SCHEMA_VERSION,
  businesses,
  enterprises,
  farmUsers,
  farms,
  regulatoryRates,
  userPasskeys,
  userSessions,
  users,
} from './index';
import { getTableConfig } from 'drizzle-orm/pg-core';

describe('@werf/db identity & tenancy core', () => {
  it('is at schema version 1 (Phase 1 introduces the core tables)', () => {
    expect(SCHEMA_VERSION).toBe(1);
  });

  it('every domain table carries a soft-delete tombstone', () => {
    for (const table of [businesses, farms, users, userPasskeys, farmUsers, enterprises]) {
      const cols = getTableConfig(table).columns.map((c) => c.name);
      expect(cols).toContain('deleted_at');
    }
  });

  it('every tenanted table carries farm_id', () => {
    for (const table of [farmUsers, enterprises]) {
      const cols = getTableConfig(table).columns.map((c) => c.name);
      expect(cols).toContain('farm_id');
    }
  });

  it('locks farms.jurisdiction to ZA with a CHECK', () => {
    const checks = getTableConfig(farms).checks.map((c) => c.name);
    expect(checks).toContain('farms_jurisdiction_v1');
  });

  it('keeps passkey material to public keys — no secret column', () => {
    const cols = getTableConfig(userPasskeys).columns.map((c) => c.name);
    expect(cols).toContain('public_key');
    expect(cols).not.toContain('private_key');
  });

  it('stores refresh tokens only as hashes, never as tokens', () => {
    const cols = getTableConfig(userSessions).columns.map((c) => c.name);
    expect(cols).toContain('refresh_token_hash');
    expect(cols).not.toContain('refresh_token');
  });

  it('keeps sessions per-person, not per-farm, so switching farms needs no re-login (FR-004)', () => {
    const cols = getTableConfig(userSessions).columns.map((c) => c.name);
    // active_farm_id is a pointer the session carries; it is NOT the tenancy key, and a
    // farm_id here would force a fresh login on every farm switch.
    expect(cols).toContain('active_farm_id');
    expect(cols).not.toContain('farm_id');
  });

  it('regulatory_rates is regulated reference data: jurisdiction, no farm_id, no ZA-lock', () => {
    const config = getTableConfig(regulatoryRates);
    const cols = config.columns.map((c) => c.name);
    expect(cols).toContain('jurisdiction'); // regulated -> carries jurisdiction
    expect(cols).toContain('gazette_reference'); // every rate traces to a source
    expect(cols).not.toContain('farm_id'); // reference data, not farm-scoped
    // Unlike farms, NO jurisdiction CHECK: a second country's rates live in this same table.
    expect(config.checks).toHaveLength(0);
  });
});
