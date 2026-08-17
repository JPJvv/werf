/**
 * theft_incident_animals, proven against a real Postgres (migration 0025, issue #10): the
 * surrogate `id` PowerSync needs to sync this table at all, and the partial-unique constraint
 * that replaced the dropped composite PK. Written as things a farmer or an attacker would do —
 * link an animal to an incident, unlink and relink it, try to plant a duplicate live link — and
 * asserted on what comes back. We never mock the DB (CLAUDE.md): the partial unique index is
 * exactly what a mock cannot see.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { startWerfTestDatabase, type WerfTestDatabase } from './testing';
import { createAppDb, createElevatedDb, type AppDb, type ElevatedDb } from './client';
import {
  animals,
  businesses,
  farmUsers,
  farms,
  theftIncidentAnimals,
  theftIncidents,
  users,
} from './schema';

const BOOT_TIMEOUT_MS = 180_000;

interface Fixture {
  readonly farmAId: string;
  readonly farmBId: string;
  readonly userAId: string;
}

describe('theft_incident_animals — surrogate id and the relink-after-unlink index', () => {
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

  it('assigns a client-invisible surrogate id on insert (issue #10 — PowerSync row identity)', async () => {
    const { incident, animal } = await seedIncidentAndAnimal(elevated, fx.farmAId);

    const [link] = await app.asUser(fx.userAId, (tx) =>
      tx
        .insert(theftIncidentAnimals)
        .values({ farmId: fx.farmAId, incidentId: incident.id, animalId: animal.id })
        .returning(),
    );

    // Not client-supplied (unlike every other primaryId() in this schema — see theft.ts's
    // header for why): a DB default is correct because this row is only ever written
    // server-side, inside LivestockService.createTheftIncident's already-idempotent bulk insert.
    expect(link?.id).toEqual(expect.any(String));
    expect(link?.incidentId).toBe(incident.id);
    expect(link?.animalId).toBe(animal.id);
    expect(link?.deletedAt).toBeNull();
  });

  it('refuses a second live link for the same incident+animal pair', async () => {
    const { incident, animal } = await seedIncidentAndAnimal(elevated, fx.farmAId);
    const link = () =>
      elevated.db
        .insert(theftIncidentAnimals)
        .values({ farmId: fx.farmAId, incidentId: incident.id, animalId: animal.id })
        .returning();

    await expect(link()).resolves.toHaveLength(1);
    await expect(link()).rejects.toThrow(/duplicate key|unique/i);
  });

  it('lets a farmer relink an animal to the same incident after unlinking it (partial unique index)', async () => {
    const { incident, animal } = await seedIncidentAndAnimal(elevated, fx.farmAId);

    const [first] = await elevated.db
      .insert(theftIncidentAnimals)
      .values({ farmId: fx.farmAId, incidentId: incident.id, animalId: animal.id })
      .returning();

    // Soft-delete the link (a farmer correcting "this animal was never part of this incident").
    await elevated.db
      .update(theftIncidentAnimals)
      .set({ deletedAt: new Date() })
      .where(eq(theftIncidentAnimals.id, first!.id));

    // The partial unique index only covers live rows, so the same pair can be relinked.
    await expect(
      elevated.db
        .insert(theftIncidentAnimals)
        .values({ farmId: fx.farmAId, incidentId: incident.id, animalId: animal.id })
        .returning(),
    ).resolves.toHaveLength(1);

    const live = await elevated.db
      .select()
      .from(theftIncidentAnimals)
      .where(
        and(
          eq(theftIncidentAnimals.incidentId, incident.id),
          eq(theftIncidentAnimals.animalId, animal.id),
          isNull(theftIncidentAnimals.deletedAt),
        ),
      );
    expect(live).toHaveLength(1);
  });

  it('hides another farm’s theft-animal links (RLS)', async () => {
    const { incident: incidentB, animal: animalB } = await seedIncidentAndAnimal(
      elevated,
      fx.farmBId,
    );
    await elevated.db.insert(theftIncidentAnimals).values({
      farmId: fx.farmBId,
      incidentId: incidentB.id,
      animalId: animalB.id,
    });

    const visible = await app.asUser(fx.userAId, (tx) => tx.select().from(theftIncidentAnimals));
    expect(visible.every((l) => l.farmId === fx.farmAId)).toBe(true);
    expect(visible.map((l) => l.incidentId)).not.toContain(incidentB.id);
  });
});

async function seedIncidentAndAnimal(
  elevated: ElevatedDb,
  farmId: string,
): Promise<{ incident: typeof theftIncidents.$inferSelect; animal: typeof animals.$inferSelect }> {
  const [animal] = await elevated.db
    .insert(animals)
    .values({ farmId, species: 'cattle', sex: 'female' })
    .returning();
  const [incident] = await elevated.db
    .insert(theftIncidents)
    .values({ farmId, discoveredAt: new Date(), headCount: 1 })
    .returning();
  return { incident: incident!, animal: animal! };
}

/** Two businesses, two farms, one user who belongs to farm A only. */
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

  const a = await mk('Theft A', 'Free State');
  const b = await mk('Theft B', 'Western Cape');
  return { farmAId: a.farmId, farmBId: b.farmId, userAId: a.userId };
}
