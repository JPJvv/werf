/**
 * Purges dead `webauthn_challenges` rows: consumed ceremonies and challenges abandoned past
 * their own expiry. Tracked in docs/05-operations/security.md §10.2 — nothing swept these, so
 * they accumulated for the life of an account and slowed the per-user scan
 * `PasskeyService.consumeChallenge` does on the ceremony hot path.
 *
 * A hard DELETE, not a tombstone. This table is exempt from the soft-delete rule for the same
 * reason `user_sessions` is (packages/db/src/schema/auth.ts): a challenge is credential state
 * with an explicit lifecycle, not a domain record that syncs or that an auditor reconstructs.
 * It is also server-only — `werf_app` is granted nothing on it (migration 0006) — so no sync
 * stream, RLS policy or audit trail has ever depended on a spent challenge surviving its use.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { isNotNull, lte, or, sql } from 'drizzle-orm';
import { webauthnChallenges, type ElevatedDb } from '@werf/db';
import { ELEVATED_DB } from '../db/db.module';

export const WEBAUTHN_CHALLENGE_SWEEP_CRON = '0 * * * * *';

@Injectable()
export class WebauthnChallengeSweepService {
  private readonly logger = new Logger(WebauthnChallengeSweepService.name);

  constructor(@Inject(ELEVATED_DB) private readonly elevated: ElevatedDb) {}

  /**
   * Deletes every challenge that is either spent (`consumed_at` set) or past `expires_at`,
   * whichever comes first — an abandoned ceremony is exactly as dead as a completed one.
   * Safe under concurrent replicas: a row deleted by one statement simply is not matched by
   * another's `WHERE`, so re-running this finds nothing left to do rather than erroring.
   */
  @Cron(WEBAUTHN_CHALLENGE_SWEEP_CRON, {
    name: 'webauthn-challenge-sweep',
    waitForCompletion: true,
  })
  async sweepDeadChallenges(): Promise<number> {
    const deleted = await this.elevated.db
      .delete(webauthnChallenges)
      .where(
        or(isNotNull(webauthnChallenges.consumedAt), lte(webauthnChallenges.expiresAt, sql`now()`)),
      )
      .returning({ id: webauthnChallenges.id });

    if (deleted.length > 0) {
      this.logger.log(`Purged ${deleted.length} dead WebAuthn challenge(s)`);
    }

    return deleted.length;
  }
}
