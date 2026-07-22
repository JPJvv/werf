/**
 * land_units, proven against a real Postgres: the farm-scoped RLS boundary and the
 * geometry⇄GeoJSON dual-write trigger (migration 0008). Written as things a farmer or an
 * attacker would actually do — create a camp, try to plant one on someone else's farm, map
 * a boundary — and asserted on what comes back, so a policy or trigger that silently stops
 * working fails here rather than in production. We never mock the DB: RLS, the PostGIS
 * extension, and the trigger are exactly what a mock cannot see (CLAUDE.md).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { startWerfTestDatabase, type WerfTestDatabase } from './testing';
import { createAppDb, createElevatedDb, type AppDb, type ElevatedDb } from './client';
import { businesses, farmUsers, farms, landUnits, users } from './schema';

const BOOT_TIMEOUT_MS = 180_000;

// Two closed rings, deliberately different so a trigger that copied a constant would be caught.
const CAMP_A_GEOJSON =
  '{"type":"Polygon","coordinates":[[[26.10,-29.10],[26.20,-29.10],[26.20,-29.20],[26.10,-29.20],[26.10,-29.10]]]}';
const CAMP_A_GEOJSON_MOVED =
  '{"type":"Polygon","coordinates":[[[27.10,-30.10],[27.20,-30.10],[27.20,-30.20],[27.10,-30.20],[27.10,-30.10]]]}';

interface Fixture {
  readonly farmAId: string;
  readonly farmBId: string;
  readonly userAId: string;
  readonly userBId: string;
}

describe('land_units — tenancy and the geojson dual-write', () => {
  let pg: WerfTestDatabase;
  let app: AppDb;
  let elevated: ElevatedDb;
  let fx: Fixture;

  beforeAll(async () => {
    pg = await startWerfTestDatabase();
    app = createAppDb({ url: pg.appUrl });
    elevated = createElevatedDb({ url: pg.elevatedUrl });
    fx = await seedTwoFarms(elevated);
  }, BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await app?.close();
    await elevated?.close();
    await pg?.stop();
  });

  it('lets a member create a camp on their own farm', async () => {
    const created = await app.asUser(fx.userAId, (tx) =>
      tx
        .insert(landUnits)
        .values({ farmId: fx.farmAId, kind: 'camp', code: 'Camp 1', name: 'Rooikop' })
        .returning(),
    );

    expect(created).toHaveLength(1);
    expect(created[0]?.code).toBe('Camp 1');
    expect(created[0]?.boundaryGeojson).toBeNull(); // no boundary drawn yet
  });

  it('hides one farm’s camps from another farm’s user', async () => {
    await elevated.db
      .insert(landUnits)
      .values({ farmId: fx.farmBId, kind: 'camp', code: 'B-Camp' });

    const visibleToA = await app.asUser(fx.userAId, (tx) => tx.select().from(landUnits));

    expect(visibleToA.every((l) => l.farmId === fx.farmAId)).toBe(true);
    expect(visibleToA.map((l) => l.code)).not.toContain('B-Camp');
  });

  it('refuses to let a user create a camp on a farm they do not belong to (WITH CHECK)', async () => {
    await expect(
      app.asUser(fx.userAId, (tx) =>
        tx.insert(landUnits).values({ farmId: fx.farmBId, kind: 'camp', code: 'Sneaky' }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('derives boundary_geojson from the PostGIS geometry when a member maps a camp', async () => {
    // Through the app path (RLS-bound werf_app), not the elevated one: this also proves the
    // app role can execute the PostGIS functions the trigger calls.
    await app.asUser(fx.userAId, (tx) =>
      tx.execute(sql`
        INSERT INTO land_units (farm_id, kind, code, boundary)
        VALUES (${fx.farmAId}, 'camp', 'Mapped', ST_GeomFromGeoJSON(${CAMP_A_GEOJSON}))
      `),
    );

    const [row] = await elevated.db.select().from(landUnits).where(eq(landUnits.code, 'Mapped'));
    expect(row?.boundaryGeojson).toBeTruthy();
    const parsed = JSON.parse(row!.boundaryGeojson!) as { type: string; coordinates: number[][][] };
    expect(parsed.type).toBe('Polygon');
    // The trigger reflected THIS boundary, not a placeholder.
    expect(parsed.coordinates[0]?.[0]?.[0]).toBeCloseTo(26.1, 5);
  });

  it('recomputes boundary_geojson when the geometry changes', async () => {
    await elevated.db.execute(sql`
      UPDATE land_units SET boundary = ST_GeomFromGeoJSON(${CAMP_A_GEOJSON_MOVED})
      WHERE code = 'Mapped'
    `);

    const [row] = await elevated.db.select().from(landUnits).where(eq(landUnits.code, 'Mapped'));
    const parsed = JSON.parse(row!.boundaryGeojson!) as { coordinates: number[][][] };
    expect(parsed.coordinates[0]?.[0]?.[0]).toBeCloseTo(27.1, 5); // followed the geometry
  });
});

/** Two businesses, two farms, two users — each user a member of exactly one farm. */
async function seedTwoFarms(elevated: ElevatedDb): Promise<Fixture> {
  const db = elevated.db;

  const mk = async (label: string, province: string) => {
    const [business] = await db
      .insert(businesses)
      .values({ name: `${label} Boerdery` })
      .returning();
    const [farm] = await db
      .insert(farms)
      .values({
        businessId: business!.id,
        name: `${label} Plaas`,
        province,
        enterpriseTypes: ['beef_cattle'],
      })
      .returning();
    const [user] = await db
      .insert(users)
      .values({ email: `${label.toLowerCase().replace(/\s/g, '')}@werf.test`, fullName: label })
      .returning();
    // accepted_at is what makes a membership real — app_user_farm_ids() ignores pending rows.
    await db
      .insert(farmUsers)
      .values({ farmId: farm!.id, userId: user!.id, role: 'owner', acceptedAt: new Date() });
    return { farmId: farm!.id, userId: user!.id };
  };

  const a = await mk('Farm A', 'Free State');
  const b = await mk('Farm B', 'Western Cape');
  return { farmAId: a.farmId, farmBId: b.farmId, userAId: a.userId, userBId: b.userId };
}
