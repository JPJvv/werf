/**
 * Bridges the one membership condition PowerSync Sync Streams cannot express.
 *
 * Postgres RLS rejects a `farm_users` row as soon as `expires_at <= now()`, but the
 * PowerSync query validator does not support `now()`. Every stream already understands
 * `deleted_at IS NULL`, so this job turns an elapsed expiry into that shared tombstone.
 * The one-minute cadence bounds an already-connected device's extra replication window
 * to one minute plus processing/propagation time.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { farmUsers, type ElevatedDb } from '@werf/db';
import { ELEVATED_DB } from '../db/db.module';

export const MEMBERSHIP_EXPIRY_SWEEP_CRON = '0 * * * * *';

@Injectable()
export class MembershipExpiryService {
  private readonly logger = new Logger(MembershipExpiryService.name);

  constructor(@Inject(ELEVATED_DB) private readonly elevated: ElevatedDb) {}

  /**
   * Soft-deletes every elapsed membership grant using the database clock RLS also uses.
   *
   * The predicate makes this idempotent and safe when more than one API replica runs the
   * same cron: after one transaction tombstones a row, concurrent statements re-check
   * `deleted_at IS NULL` and do not update it again.
   */
  @Cron(MEMBERSHIP_EXPIRY_SWEEP_CRON, {
    name: 'membership-expiry-sweep',
    waitForCompletion: true,
  })
  async sweepExpiredMemberships(): Promise<number> {
    const expired = await this.elevated.db
      .update(farmUsers)
      .set({
        deletedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          isNull(farmUsers.deletedAt),
          isNotNull(farmUsers.expiresAt),
          lte(farmUsers.expiresAt, sql`now()`),
        ),
      )
      .returning({ id: farmUsers.id });

    if (expired.length > 0) {
      this.logger.log(`Soft-deleted ${expired.length} expired farm membership(s)`);
    }

    return expired.length;
  }
}
