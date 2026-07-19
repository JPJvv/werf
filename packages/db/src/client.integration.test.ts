/**
 * The tenancy boundary, proven against a real Postgres.
 *
 * These assertions are all of the form "farm B's data does not reach farm A's user" and
 * "credential state does not reach the request path". They are deliberately written as
 * things an attacker would try, not as things the implementation does — the queries below
 * ask for everything and assert on what comes back, so a policy that silently stops
 * filtering fails here rather than in production.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { startWerfTestDatabase, type WerfTestDatabase } from './testing';
import { createAppDb, createElevatedDb, type AppDb, type ElevatedDb } from './client';
import { businesses, enterprises, farmUsers, farms, userSessions, users } from './schema';

/** Container start + image pull + migrations. Generous, because a cold CI machine pulls. */
const BOOT_TIMEOUT_MS = 180_000;

interface Fixture {
  readonly farmAId: string;
  readonly farmBId: string;
  readonly userAId: string;
  readonly userBId: string;
}

describe('RLS tenancy boundary', () => {
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

  it('shows a user only the farm they belong to, however broadly they ask', async () => {
    const visible = await app.asUser(fx.userAId, (tx) => tx.select().from(farms));

    expect(visible.map((f) => f.id)).toEqual([fx.farmAId]);
  });

  it('hides the other business entirely, not just its farms', async () => {
    const visible = await app.asUser(fx.userAId, (tx) => tx.select().from(businesses));

    expect(visible).toHaveLength(1);
    expect(visible[0]?.name).toBe('Farm A Boerdery');
  });

  it('hides the other farm’s enterprises and memberships', async () => {
    const [ents, memberships] = await app.asUser(fx.userAId, async (tx) => [
      await tx.select().from(enterprises),
      await tx.select().from(farmUsers),
    ]);

    expect(ents.every((e) => e.farmId === fx.farmAId)).toBe(true);
    expect(memberships.every((m) => m.farmId === fx.farmAId)).toBe(true);
  });

  it('does not let a user read a stranger they share no farm with', async () => {
    const visible = await app.asUser(fx.userAId, (tx) => tx.select().from(users));

    expect(visible.map((u) => u.id)).toEqual([fx.userAId]);
  });

  it('scopes each call independently, so a pooled connection never inherits an identity', async () => {
    // The failure this guards is subtle and severe: a session-level `SET app.user_id`
    // would survive on the pooled connection and hand the NEXT request the previous
    // user's tenancy. Interleaving the two users forces connection reuse.
    const [first, second, third] = await Promise.all([
      app.asUser(fx.userAId, (tx) => tx.select().from(farms)),
      app.asUser(fx.userBId, (tx) => tx.select().from(farms)),
      app.asUser(fx.userAId, (tx) => tx.select().from(farms)),
    ]);

    expect(first.map((f) => f.id)).toEqual([fx.farmAId]);
    expect(second.map((f) => f.id)).toEqual([fx.farmBId]);
    expect(third.map((f) => f.id)).toEqual([fx.farmAId]);
  });

  it('shows nothing at all to a connection with no user set', async () => {
    // An unauthenticated request must see an empty database, not error and not leak.
    const visible = await app.asUser('00000000-0000-0000-0000-000000000000', (tx) =>
      tx.select().from(farms),
    );

    expect(visible).toEqual([]);
  });

  describe('user_sessions', () => {
    it('is unreachable from the request path even though the session exists', async () => {
      await elevated.db.insert(userSessions).values({
        userId: fx.userAId,
        refreshTokenHash: 'deadbeef',
        familyId: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      });

      // Not "returns no rows" — the app role has no privilege on the table at all.
      await expect(app.asUser(fx.userAId, (tx) => tx.select().from(userSessions))).rejects.toThrow(
        /permission denied/i,
      );
    });

    it('is readable by the elevated auth path, which is the only thing that may', async () => {
      const found = await elevated.db
        .select()
        .from(userSessions)
        .where(eq(userSessions.userId, fx.userAId));

      expect(found).toHaveLength(1);
      expect(found[0]?.secondFactorAt).toBeNull(); // not yet through the second factor
    });
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
    // `accepted_at` is what makes a membership real — `app_user_farm_ids()` ignores
    // pending invitations, so a fixture that omits it grants nothing at all.
    await db.insert(farmUsers).values({
      farmId: farm!.id,
      userId: user!.id,
      role: 'owner',
      acceptedAt: new Date(),
    });
    await db
      .insert(enterprises)
      .values({ farmId: farm!.id, name: `${label} Beef`, type: 'beef_cattle' });

    return { farmId: farm!.id, userId: user!.id };
  };

  const a = await mk('Farm A', 'Free State');
  const b = await mk('Farm B', 'Western Cape');

  return { farmAId: a.farmId, farmBId: b.farmId, userAId: a.userId, userBId: b.userId };
}
