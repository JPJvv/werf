/**
 * Behavioural proof for the PowerSync expiry bridge, against real Postgres.
 *
 * The security outcome is the tombstone itself: `deleted_at IS NULL` is the revocation
 * signal every generated Sync Stream can evaluate even though it cannot evaluate `now()`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { businesses, farmUsers, farms, users, createElevatedDb, type ElevatedDb } from '@werf/db';
import { startWerfTestDatabase, type WerfTestDatabase } from '@werf/db/testing';
import { MembershipExpiryService } from './membership-expiry.service';

const BOOT_TIMEOUT_MS = 180_000;

describe('membership expiry sweep', () => {
  let pg: WerfTestDatabase;
  let elevated: ElevatedDb;
  let service: MembershipExpiryService;

  beforeAll(async () => {
    pg = await startWerfTestDatabase();
    elevated = createElevatedDb({ url: pg.elevatedUrl });
    service = new MembershipExpiryService(elevated);
  }, BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    await pg.reset();
  });

  afterAll(async () => {
    await elevated?.close();
    await pg?.stop();
  });

  it('soft-deletes only elapsed grants and is idempotent', async () => {
    const now = Date.now();
    const [business] = await elevated.db
      .insert(businesses)
      .values({ name: 'Expiry Sweep Test' })
      .returning();
    const [farm] = await elevated.db
      .insert(farms)
      .values({
        businessId: business!.id,
        name: 'Sweep Farm',
        province: 'Free State',
        enterpriseTypes: ['beef_cattle'],
      })
      .returning();
    const createdUsers = await elevated.db
      .insert(users)
      .values(
        ['expired', 'pending-expired', 'future', 'permanent', 'already-revoked'].map((name) => ({
          email: `${name}@expiry.test`,
          fullName: name,
        })),
      )
      .returning();
    const userId = new Map(createdUsers.map((user) => [user.fullName, user.id]));
    const existingTombstone = new Date(now - 60_000);

    const memberships = await elevated.db
      .insert(farmUsers)
      .values([
        {
          farmId: farm!.id,
          userId: userId.get('expired')!,
          role: 'manager',
          acceptedAt: new Date(now - 120_000),
          expiresAt: new Date(now - 1_000),
        },
        {
          farmId: farm!.id,
          userId: userId.get('pending-expired')!,
          role: 'worker',
          invitedAt: new Date(now - 120_000),
          expiresAt: new Date(now - 1_000),
        },
        {
          farmId: farm!.id,
          userId: userId.get('future')!,
          role: 'manager',
          acceptedAt: new Date(now - 120_000),
          expiresAt: new Date(now + 60_000),
        },
        {
          farmId: farm!.id,
          userId: userId.get('permanent')!,
          role: 'owner',
          acceptedAt: new Date(now - 120_000),
          expiresAt: null,
        },
        {
          farmId: farm!.id,
          userId: userId.get('already-revoked')!,
          role: 'manager',
          acceptedAt: new Date(now - 120_000),
          expiresAt: new Date(now - 2_000),
          deletedAt: existingTombstone,
        },
      ])
      .returning();

    await expect(service.sweepExpiredMemberships()).resolves.toBe(2);

    const afterFirstSweep = await elevated.db.select().from(farmUsers);
    const byUser = new Map(afterFirstSweep.map((membership) => [membership.userId, membership]));
    const expired = byUser.get(userId.get('expired')!);
    const pendingExpired = byUser.get(userId.get('pending-expired')!);

    expect(expired?.deletedAt).toBeInstanceOf(Date);
    expect(expired!.updatedAt.getTime()).toBe(expired!.deletedAt!.getTime());
    expect(pendingExpired?.deletedAt).toBeInstanceOf(Date);
    expect(pendingExpired!.updatedAt.getTime()).toBe(pendingExpired!.deletedAt!.getTime());
    expect(byUser.get(userId.get('future')!)?.deletedAt).toBeNull();
    expect(byUser.get(userId.get('permanent')!)?.deletedAt).toBeNull();
    expect(byUser.get(userId.get('already-revoked')!)?.deletedAt).toEqual(existingTombstone);

    const firstTombstone = expired!.deletedAt;
    await expect(service.sweepExpiredMemberships()).resolves.toBe(0);

    const [afterSecondSweep] = await elevated.db
      .select()
      .from(farmUsers)
      .where(eq(farmUsers.id, memberships[0]!.id));
    expect(afterSecondSweep!.deletedAt).toEqual(firstTombstone);
  });
});
