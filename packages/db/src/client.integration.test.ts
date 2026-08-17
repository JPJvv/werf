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
import {
  attachments,
  businesses,
  conflictReviews,
  enterprises,
  farmUsers,
  farms,
  userSessions,
  users,
  webauthnChallenges,
} from './schema';

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
    // `id` alone, not `select()`: `werf_app` holds column-level grants on `users` (0029),
    // not table-wide `SELECT *` — this test is about ROW visibility, and asking for a
    // column the role does not have would fail on the grant before RLS is even reached.
    const visible = await app.asUser(fx.userAId, (tx) => tx.select({ id: users.id }).from(users));

    expect(visible.map((u) => u.id)).toEqual([fx.userAId]);
  });

  it('refuses to read credential columns on `users` even for your own row (0029)', async () => {
    // The RLS policy correctly scopes this row to its owner; the column grant is a SEPARATE
    // boundary underneath it. Without 0029's column-level REVOKE, `werf_app` could read a
    // co-member's encrypted TOTP seed or password hash through this exact query shape — the
    // row-visibility check above would have passed either way, which is why it needs its own
    // assertion rather than being inferred from the row test.
    await expect(
      app.asUser(fx.userAId, (tx) =>
        tx.select({ totpSecretEncrypted: users.totpSecretEncrypted }).from(users),
      ),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      app.asUser(fx.userAId, (tx) => tx.select({ passwordHash: users.passwordHash }).from(users)),
    ).rejects.toThrow(/permission denied/i);

    // The revoke is COLUMN-level, not a blanket lockout of the table: an ordinary
    // profile-shaped column stays readable in the very same transaction shape.
    const [row] = await app.asUser(fx.userAId, (tx) =>
      tx.select({ fullName: users.fullName }).from(users).where(eq(users.id, fx.userAId)),
    );
    expect(row?.fullName).toBeTruthy();
  });

  it('refuses to write `totp_last_used_step` through the scoped connection (0029)', async () => {
    // Mirrors the SELECT check above for UPDATE: this is the exact replay-guard column
    // security.md §10.2 named as reachable from `werf_app` before this migration.
    await expect(
      app.asUser(fx.userAId, (tx) =>
        tx.update(users).set({ totpLastUsedStep: 1 }).where(eq(users.id, fx.userAId)),
      ),
    ).rejects.toThrow(/permission denied/i);

    // Again, column-level: an ordinary profile field is still writable through `werf_app`.
    await app.asUser(fx.userAId, (tx) =>
      tx.update(users).set({ locale: 'af-ZA' }).where(eq(users.id, fx.userAId)),
    );
    const [row] = await elevated.db
      .select({ locale: users.locale })
      .from(users)
      .where(eq(users.id, fx.userAId));
    expect(row?.locale).toBe('af-ZA');
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

  describe('webauthn_challenges', () => {
    it('is unreachable from the request path, like every other credential table', async () => {
      // A device that could read this table could answer its own WebAuthn challenges,
      // which is the one thing making a passkey assertion un-replayable. Migration 0006
      // claims the same posture as user_sessions; this is that claim under test rather
      // than merely inspected.
      await elevated.db.insert(webauthnChallenges).values({
        userId: fx.userAId,
        challenge: 'a-challenge',
        ceremony: 'authentication',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      });

      await expect(
        app.asUser(fx.userAId, (tx) => tx.select().from(webauthnChallenges)),
      ).rejects.toThrow(/permission denied/i);
    });

    it('refuses a ceremony name the code does not know', async () => {
      // The CHECK is what stops a registration challenge being spent as an
      // authentication one — the enrolment-flow-as-login-bypass shape.
      await expect(
        elevated.db.insert(webauthnChallenges).values({
          userId: fx.userAId,
          challenge: 'a-challenge',
          ceremony: 'something-else',
          expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        }),
      ).rejects.toThrow(/webauthn_challenges_ceremony_v1|violates check constraint/i);
    });
  });

  describe('conflict_reviews column grants (0031)', () => {
    it('refuses to rewrite the evidence columns through the scoped connection', async () => {
      const [row] = await elevated.db
        .insert(conflictReviews)
        .values({
          farmId: fx.farmAId,
          conflictKey: `test:${crypto.randomUUID()}`,
          kind: 'field_lww',
          subjectId: crypto.randomUUID(),
          factAEventId: crypto.randomUUID(),
          factBEventId: crypto.randomUUID(),
          rule: 'later occurred_at wins',
        })
        .returning();

      // `recordConflict` writes these once, at creation — never again. Without 0031's REVOKE,
      // `werf_app` could rewrite "which rule decided" after the fact through this exact shape.
      await expect(
        app.asUser(fx.userAId, (tx) =>
          tx
            .update(conflictReviews)
            .set({ rule: 'a different story' })
            .where(eq(conflictReviews.id, row!.id)),
        ),
      ).rejects.toThrow(/permission denied/i);

      // Column-level, not table-wide: the review workflow's own columns stay writable — the
      // full set `markReviewed` actually sets, satisfying `conflict_reviews_review_state_check`.
      await app.asUser(fx.userAId, (tx) =>
        tx
          .update(conflictReviews)
          .set({
            status: 'reviewed',
            reviewNote: 'checked',
            reviewedBy: fx.userAId,
            reviewedAt: new Date(),
          })
          .where(eq(conflictReviews.id, row!.id)),
      );
      const [after] = await elevated.db
        .select({ status: conflictReviews.status })
        .from(conflictReviews)
        .where(eq(conflictReviews.id, row!.id));
      expect(after?.status).toBe('reviewed');
    });
  });

  describe('attachments column grants (0031)', () => {
    it('refuses to rewrite object_key or checksum through the scoped connection', async () => {
      const [row] = await elevated.db
        .insert(attachments)
        .values({
          farmId: fx.farmAId,
          subjectType: 'animal',
          subjectId: crypto.randomUUID(),
          mimeType: 'image/jpeg',
          sizeBytes: 1024,
          checksum: 'a'.repeat(64),
          occurredAt: new Date(),
        })
        .returning();

      // `finalizeAttachment` re-derives these from a real headObject call and never trusts a
      // client claim — a column grant that let a later scoped UPDATE overwrite them would reopen
      // exactly what that check exists to close.
      await expect(
        app.asUser(fx.userAId, (tx) =>
          tx
            .update(attachments)
            .set({ objectKey: 'attacker-chosen-key' })
            .where(eq(attachments.id, row!.id)),
        ),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        app.asUser(fx.userAId, (tx) =>
          tx
            .update(attachments)
            .set({ checksum: 'b'.repeat(64) })
            .where(eq(attachments.id, row!.id)),
        ),
      ).rejects.toThrow(/permission denied/i);

      // Column-level, not table-wide: the status transition real code performs stays writable.
      await app.asUser(fx.userAId, (tx) =>
        tx.update(attachments).set({ status: 'finalised' }).where(eq(attachments.id, row!.id)),
      );
      const [after] = await elevated.db
        .select({ status: attachments.status })
        .from(attachments)
        .where(eq(attachments.id, row!.id));
      expect(after?.status).toBe('finalised');
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
