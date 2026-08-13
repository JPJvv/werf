/**
 * events, proven against a real Postgres: the farm-scoped RLS boundary, the LIST(farm_id)
 * partitioning (`events_default` is the sole, permanent partition — STATUS.md §3, Finding 2:
 * `create_farm_partition` retired 0021 rather than ever creating a second one, because
 * PowerSync's static sync config cannot follow a partition created after the last deploy), the
 * three-timestamp discipline (occurred_at ≠ created_at), and the location⇄GeoJSON dual-write
 * trigger (migration 0010). Written as things a farmer or an attacker would actually do — weigh
 * an animal in the crush, capture a week before syncing, try to log an event on someone else's
 * farm — and asserted on what comes back. We never mock the DB (CLAUDE.md): RLS, partition
 * routing and the PostGIS trigger are exactly what a mock cannot see.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { startWerfTestDatabase, type WerfTestDatabase } from './testing';
import { createAppDb, createElevatedDb, type AppDb, type ElevatedDb } from './client';
import { businesses, events, farmUsers, farms, users } from './schema';

const BOOT_TIMEOUT_MS = 180_000;

interface Farm {
  readonly farmId: string;
  readonly userId: string;
}

describe('events — tenancy, partitioning, timestamps and the geojson dual-write', () => {
  let pg: WerfTestDatabase;
  let app: AppDb;
  let elevated: ElevatedDb;
  let a: Farm;
  let b: Farm;

  beforeAll(async () => {
    pg = await startWerfTestDatabase();
    app = createAppDb({ url: pg.appUrl });
    elevated = createElevatedDb({ url: pg.elevatedUrl });
    a = await mkFarm(elevated, 'Farm A', 'Free State');
    b = await mkFarm(elevated, 'Farm B', 'Western Cape');
  }, BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await app?.close();
    await elevated?.close();
    await pg?.stop();
  });

  it('lets a member log an event on their own farm, landing in the sole events_default partition', async () => {
    const [created] = await app.asUser(a.userId, (tx) =>
      tx
        .insert(events)
        .values({
          farmId: a.farmId,
          type: 'weight',
          occurredAt: new Date('2026-07-20T06:00:00Z'),
          payload: { kg: 412.5, method: 'scale' },
          createdBy: a.userId,
        })
        .returning(),
    );

    expect(created?.type).toBe('weight');
    expect(created?.payload).toEqual({ kg: 412.5, method: 'scale' });

    // events_default is the only partition that has ever existed since create_farm_partition's
    // retirement (0021) — this is what derive-sync-streams.ts's PARTITIONED_SOURCE_TABLE assumes.
    const rows = await partitionOf(elevated, created!.id);
    expect(rows[0]?.partition).toBe('events_default');
  });

  it('keeps occurred_at (farm time) distinct from created_at (row written) — reports use occurred_at', async () => {
    // Captured in a dead zone on the 15th, written to the server row now: they must not collapse.
    const occurred = new Date('2026-07-15T05:30:00Z');
    const [created] = await app.asUser(a.userId, (tx) =>
      tx
        .insert(events)
        .values({
          farmId: a.farmId,
          type: 'condition_score',
          occurredAt: occurred,
          payload: { score: 3 },
          createdBy: a.userId,
        })
        .returning(),
    );

    expect(created!.occurredAt.getTime()).toBe(occurred.getTime());
    expect(created!.occurredAt.getTime()).toBeLessThan(created!.createdAt.getTime());
  });

  it('hides one farm’s events from another farm’s user', async () => {
    await elevated.db.insert(events).values({
      farmId: b.farmId,
      type: 'dip',
      occurredAt: new Date('2026-07-19T06:00:00Z'),
      payload: { product: 'amitraz' },
    });

    const visibleToA = await app.asUser(a.userId, (tx) => tx.select().from(events));

    expect(visibleToA.every((e) => e.farmId === a.farmId)).toBe(true);
    expect(visibleToA.map((e) => e.type)).not.toContain('dip');
  });

  it('refuses to log an event on a farm the user does not belong to (WITH CHECK)', async () => {
    await expect(
      app.asUser(a.userId, (tx) =>
        tx.insert(events).values({
          farmId: b.farmId,
          type: 'weight',
          occurredAt: new Date('2026-07-20T06:00:00Z'),
          payload: { kg: 1, method: 'visual' },
        }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('derives location_geojson from the PostGIS geometry when a member captures a GPS fix', async () => {
    // Through the RLS-bound app role, which also proves it can execute the PostGIS the trigger calls.
    const res = await app.asUser(a.userId, (tx) =>
      tx.execute(sql`
        INSERT INTO events (farm_id, type, occurred_at, payload, location)
        VALUES (${a.farmId}, 'move', now(), '{}'::jsonb, ST_SetSRID(ST_MakePoint(26.1, -29.1), 4326))
        RETURNING id
      `),
    );
    const id = (res.rows[0] as { id: string }).id;

    const [row] = await elevated.db.select().from(events).where(eq(events.id, id));
    expect(row?.locationGeojson).toBeTruthy();
    const parsed = JSON.parse(row!.locationGeojson!) as { type: string; coordinates: number[] };
    expect(parsed.type).toBe('Point');
    // The trigger reflected THIS location, not a placeholder constant.
    expect(parsed.coordinates[0]).toBeCloseTo(26.1, 5);

    // And it recomputes when the geometry moves.
    await elevated.db.execute(sql`
      UPDATE events SET location = ST_SetSRID(ST_MakePoint(27.2, -30.2), 4326) WHERE id = ${id}
    `);
    const [moved] = await elevated.db.select().from(events).where(eq(events.id, id));
    const movedGeo = JSON.parse(moved!.locationGeojson!) as { coordinates: number[] };
    expect(movedGeo.coordinates[0]).toBeCloseTo(27.2, 5);
  });

  it('a brand new farm, never provisioned with anything special, still lands in events_default', async () => {
    // No provisioning step exists any more (0021) — every farm's events go straight to the
    // one permanent partition. The write must not fail either way (.claude/rules/db.md — the
    // write queue is never discarded by the system).
    const c = await mkFarm(elevated, 'Farm C', 'Limpopo');

    const [created] = await app.asUser(c.userId, (tx) =>
      tx
        .insert(events)
        .values({
          farmId: c.farmId,
          type: 'missing',
          occurredAt: new Date('2026-07-21T06:00:00Z'),
          payload: { count: 2 },
          createdBy: c.userId,
        })
        .returning(),
    );

    expect(created?.type).toBe('missing');
    const rows = await partitionOf(elevated, created!.id);
    expect(rows[0]?.partition).toBe('events_default');
  });

  it('create_farm_partition no longer exists (0021) — nothing can create a second partition', async () => {
    await expect(
      elevated.db.execute(sql`SELECT create_farm_partition(${a.farmId}::uuid)`),
    ).rejects.toThrow(/function create_farm_partition\(uuid\) does not exist/i);
  });
});

/** Which partition a given event physically lives in (the parent's tableoid resolved to a name). */
function partitionOf(elevated: ElevatedDb, id: string): Promise<Array<{ partition: string }>> {
  return elevated.db
    .execute(sql`SELECT tableoid::regclass::text AS partition FROM events WHERE id = ${id}`)
    .then((r) => r.rows as Array<{ partition: string }>);
}

/** One business, one farm, one owner who has accepted their membership. */
async function mkFarm(elevated: ElevatedDb, label: string, province: string): Promise<Farm> {
  const db = elevated.db;
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
  await db
    .insert(farmUsers)
    .values({ farmId: farm!.id, userId: user!.id, role: 'owner', acceptedAt: new Date() });
  return { farmId: farm!.id, userId: user!.id };
}
