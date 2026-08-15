/**
 * Behavioural proof for the WebAuthn challenge sweep, against real Postgres.
 *
 * `webauthn_challenges` is unreachable from `werf_app` (migration 0006), so this uses the
 * elevated connection directly — exactly like the sweep service itself.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { users, webauthnChallenges, createElevatedDb, type ElevatedDb } from '@werf/db';
import { startWerfTestDatabase, type WerfTestDatabase } from '@werf/db/testing';
import { WebauthnChallengeSweepService } from './webauthn-challenge-sweep.service';

const BOOT_TIMEOUT_MS = 180_000;

describe('webauthn challenge sweep', () => {
  let pg: WerfTestDatabase;
  let elevated: ElevatedDb;
  let service: WebauthnChallengeSweepService;

  beforeAll(async () => {
    pg = await startWerfTestDatabase();
    elevated = createElevatedDb({ url: pg.elevatedUrl });
    service = new WebauthnChallengeSweepService(elevated);
  }, BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    await pg.reset();
  });

  afterAll(async () => {
    await elevated?.close();
    await pg?.stop();
  });

  it('purges only consumed or expired challenges, and is idempotent', async () => {
    const now = Date.now();
    const [user] = await elevated.db
      .insert(users)
      .values({ email: 'sweep@werf.test', fullName: 'Sweep Subject' })
      .returning();

    const rows = await elevated.db
      .insert(webauthnChallenges)
      .values([
        {
          userId: user!.id,
          challenge: 'consumed',
          ceremony: 'authentication',
          expiresAt: new Date(now + 60_000),
          consumedAt: new Date(now - 1_000),
        },
        {
          userId: user!.id,
          challenge: 'expired-unconsumed',
          ceremony: 'authentication',
          expiresAt: new Date(now - 1_000),
        },
        {
          userId: user!.id,
          challenge: 'live',
          ceremony: 'registration',
          expiresAt: new Date(now + 60_000),
        },
      ])
      .returning();
    const idFor = new Map(rows.map((row) => [row.challenge, row.id]));

    await expect(service.sweepDeadChallenges()).resolves.toBe(2);

    const remaining = await elevated.db.select().from(webauthnChallenges);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe(idFor.get('live'));

    // Idempotent: nothing left to purge on a second pass.
    await expect(service.sweepDeadChallenges()).resolves.toBe(0);
    const [stillLive] = await elevated.db
      .select()
      .from(webauthnChallenges)
      .where(eq(webauthnChallenges.id, idFor.get('live')!));
    expect(stillLive).toBeDefined();
  });
});
