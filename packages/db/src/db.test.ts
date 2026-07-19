import { describe, expect, it } from 'vitest';
import {
  SCHEMA_VERSION,
  businesses,
  enterprises,
  farmUsers,
  farms,
  userPasskeys,
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
});
