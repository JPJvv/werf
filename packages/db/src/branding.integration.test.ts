/**
 * branding_registers and the animals.brand_id link, proven against a real Postgres (migration
 * 0011): the farm-scoped RLS boundary, the ZA ≤3-character mark CHECK (Animal Identification Act 6
 * of 2002), and linking an animal to a mark on its own farm. Written as things a farmer or an
 * attacker would do — register a mark, try to register a four-character one, try to see another
 * farm's marks — and asserted on what comes back. We never mock the DB (CLAUDE.md).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startWerfTestDatabase, type WerfTestDatabase } from './testing';
import { createAppDb, createElevatedDb, type AppDb, type ElevatedDb } from './client';
import { animals, brandingRegisters, businesses, farmUsers, farms, users } from './schema';

const BOOT_TIMEOUT_MS = 180_000;

interface Fixture {
  readonly farmAId: string;
  readonly farmBId: string;
  readonly userAId: string;
}

describe('branding_registers — tenancy, the mark CHECK, and the animal link', () => {
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

  it('lets a member register a mark and link an animal to it, on their own farm', async () => {
    const { brand, animal } = await app.asUser(fx.userAId, async (tx) => {
      const [brand] = await tx
        .insert(brandingRegisters)
        .values({
          farmId: fx.farmAId,
          mark: 'JV7',
          markType: 'hot_brand',
          species: ['cattle'],
          bodyPosition: 'left hip',
          certificateReference: 'AIS-2026-0042',
        })
        .returning();
      const [animal] = await tx
        .insert(animals)
        .values({
          farmId: fx.farmAId,
          species: 'cattle',
          sex: 'female',
          brandId: brand!.id,
          brandAppliedAt: '2026-07-01',
        })
        .returning();
      return { brand: brand!, animal: animal! };
    });

    expect(brand.jurisdiction).toBe('ZA'); // default
    expect(animal.brandId).toBe(brand.id);
  });

  it('refuses a mark longer than three characters (ZA Animal Identification Act CHECK)', async () => {
    await expect(
      elevated.db
        .insert(brandingRegisters)
        .values({ farmId: fx.farmAId, mark: 'FOUR', markType: 'tattoo', species: ['sheep'] }),
    ).rejects.toThrow(/branding_registers_mark_length|check/i);
  });

  it('hides another farm’s marks (RLS)', async () => {
    await elevated.db
      .insert(brandingRegisters)
      .values({ farmId: fx.farmBId, mark: 'B9', markType: 'freeze_brand', species: ['sheep'] });

    const visible = await app.asUser(fx.userAId, (tx) => tx.select().from(brandingRegisters));
    expect(visible.every((b) => b.farmId === fx.farmAId)).toBe(true);
    expect(visible.map((b) => b.mark)).not.toContain('B9');
  });

  it('refuses to register a mark on a farm the user does not belong to (WITH CHECK)', async () => {
    await expect(
      app.asUser(fx.userAId, (tx) =>
        tx
          .insert(brandingRegisters)
          .values({ farmId: fx.farmBId, mark: 'X1', markType: 'tattoo', species: ['cattle'] }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});

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

  const a = await mk('Brand A', 'Free State');
  const b = await mk('Brand B', 'Western Cape');
  return { farmAId: a.farmId, farmBId: b.farmId, userAId: a.userId };
}
