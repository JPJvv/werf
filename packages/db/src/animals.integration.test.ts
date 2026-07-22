/**
 * animals, mobs and animal_identifiers, proven against a real Postgres: the farm-scoped RLS
 * boundary (migration 0009), the partial-unique identifier constraint (FR-109), and the
 * group-only mob (FR-102). Written as things a farmer or an attacker would do — tag an
 * animal, reuse a retired tag, try to plant stock on someone else's farm — and asserted on
 * what comes back. We never mock the DB (CLAUDE.md): RLS and the partial unique index are
 * exactly what a mock cannot see.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { startWerfTestDatabase, type WerfTestDatabase } from './testing';
import { createAppDb, createElevatedDb, type AppDb, type ElevatedDb } from './client';
import { animalIdentifiers, animals, businesses, farmUsers, farms, mobs, users } from './schema';

const BOOT_TIMEOUT_MS = 180_000;

interface Fixture {
  readonly farmAId: string;
  readonly farmBId: string;
  readonly userAId: string;
  readonly userBId: string;
}

describe('animals — tenancy, identifiers, and the mob model', () => {
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

  it('lets a member create an animal and tag it on their own farm', async () => {
    const created = await app.asUser(fx.userAId, async (tx) => {
      const [animal] = await tx
        .insert(animals)
        .values({ farmId: fx.farmAId, species: 'cattle', sex: 'female', createdBy: fx.userAId })
        .returning();
      await tx.insert(animalIdentifiers).values({
        farmId: fx.farmAId,
        animalId: animal!.id,
        type: 'visual_tag',
        value: 'BT 042',
        isPrimary: true,
      });
      return animal!;
    });

    expect(created.status).toBe('alive'); // default
    expect(created.attributes).toEqual({}); // default
  });

  it('hides another farm’s animals, mobs and identifiers', async () => {
    const [bAnimal] = await elevated.db
      .insert(animals)
      .values({ farmId: fx.farmBId, species: 'sheep', sex: 'male' })
      .returning();
    await elevated.db
      .insert(mobs)
      .values({ farmId: fx.farmBId, name: 'B Flock', species: 'sheep', headCount: 200 });
    await elevated.db
      .insert(animalIdentifiers)
      .values({ farmId: fx.farmBId, animalId: bAnimal!.id, type: 'visual_tag', value: 'B-1' });

    const [visibleAnimals, visibleMobs, visibleIds] = await app.asUser(fx.userAId, async (tx) => [
      await tx.select().from(animals),
      await tx.select().from(mobs),
      await tx.select().from(animalIdentifiers),
    ]);

    expect(visibleAnimals.every((a) => a.farmId === fx.farmAId)).toBe(true);
    expect(visibleMobs.every((m) => m.farmId === fx.farmAId)).toBe(true);
    expect(visibleIds.every((i) => i.farmId === fx.farmAId)).toBe(true);
    expect(visibleIds.map((i) => i.value)).not.toContain('B-1');
  });

  it('refuses to create an animal on a farm the user does not belong to (WITH CHECK)', async () => {
    await expect(
      app.asUser(fx.userAId, (tx) =>
        tx.insert(animals).values({ farmId: fx.farmBId, species: 'cattle', sex: 'female' }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('enforces one live identifier per farm per type, and frees it on soft-delete (FR-109)', async () => {
    const [animal] = await elevated.db
      .insert(animals)
      .values({ farmId: fx.farmAId, species: 'cattle', sex: 'castrated' })
      .returning();

    const tag = () =>
      elevated.db
        .insert(animalIdentifiers)
        .values({ farmId: fx.farmAId, animalId: animal!.id, type: 'eid', value: 'ZA 900 111' })
        .returning();

    const [first] = await tag();
    // Same farm + type + value while the first is live → unique violation.
    await expect(tag()).rejects.toThrow(/duplicate key|unique/i);

    // Retire the tag (soft delete), and the value is free to reissue.
    await elevated.db
      .update(animalIdentifiers)
      .set({ deletedAt: new Date() })
      .where(eq(animalIdentifiers.id, first!.id));

    await expect(tag()).resolves.toHaveLength(1);

    // And exactly one live row carries the value.
    const live = await elevated.db
      .select()
      .from(animalIdentifiers)
      .where(and(eq(animalIdentifiers.value, 'ZA 900 111'), isNull(animalIdentifiers.deletedAt)));
    expect(live).toHaveLength(1);
  });

  it('records a group-only mob by head count with no animal rows behind it (FR-102)', async () => {
    const created = await app.asUser(fx.userAId, (tx) =>
      tx
        .insert(mobs)
        .values({ farmId: fx.farmAId, name: 'Flock A', species: 'sheep', headCount: 300 })
        .returning(),
    );

    expect(created[0]?.headCount).toBe(300);
    const behind = await app.asUser(fx.userAId, (tx) =>
      tx.select().from(animals).where(eq(animals.mobId, created[0]!.id)),
    );
    expect(behind).toHaveLength(0); // a mob is a complete record on its own
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
    await db
      .insert(farmUsers)
      .values({ farmId: farm!.id, userId: user!.id, role: 'owner', acceptedAt: new Date() });
    return { farmId: farm!.id, userId: user!.id };
  };

  const a = await mk('Farm A', 'Free State');
  const b = await mk('Farm B', 'Western Cape');
  return { farmAId: a.farmId, farmBId: b.farmId, userAId: a.userId, userBId: b.userId };
}
