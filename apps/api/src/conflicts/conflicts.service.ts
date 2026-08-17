import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { auditLog, conflictReviews, farmUsers, type AppDb } from '@werf/db';
import { NotFoundError, TenancyError, schemas } from '@werf/core';
import { APP_DB } from '../db/db.module';

const projection = {
  id: conflictReviews.id,
  farmId: conflictReviews.farmId,
  kind: conflictReviews.kind,
  subjectId: conflictReviews.subjectId,
  field: conflictReviews.field,
  factAEventId: conflictReviews.factAEventId,
  factBEventId: conflictReviews.factBEventId,
  winnerEventId: conflictReviews.winnerEventId,
  rule: conflictReviews.rule,
  createdAt: conflictReviews.createdAt,
} as const;

@Injectable()
export class ConflictsService {
  constructor(@Inject(APP_DB) private readonly app: AppDb) {}

  async listOpen(userId: string, farmId: string): Promise<schemas.ConflictReviewJson[]> {
    return this.app.asUser(userId, async (tx) => {
      await membership(tx, userId, farmId);
      const rows = await tx
        .select(projection)
        .from(conflictReviews)
        .where(
          and(
            eq(conflictReviews.farmId, farmId),
            eq(conflictReviews.status, 'open'),
            isNull(conflictReviews.deletedAt),
          ),
        )
        .orderBy(desc(conflictReviews.createdAt), desc(conflictReviews.id));
      return rows.map((row) =>
        schemas.conflictReviewJsonSchema.parse({ ...row, createdAt: row.createdAt.toISOString() }),
      );
    });
  }

  async markReviewed(
    userId: string,
    reviewId: string,
    input: schemas.ReviewConflictRequest,
  ): Promise<void> {
    await this.app.asUser(userId, async (tx) => {
      const role = await membership(tx, userId, input.farmId);
      if (role !== 'owner' && role !== 'manager') {
        throw new TenancyError(`Role ${role} may not review conflicts`);
      }
      const [row] = await tx
        .select()
        .from(conflictReviews)
        .where(
          and(
            eq(conflictReviews.id, reviewId),
            eq(conflictReviews.farmId, input.farmId),
            isNull(conflictReviews.deletedAt),
          ),
        );
      if (!row) throw new NotFoundError('Conflict review not found');
      if (row.status === 'reviewed') return;

      const reviewedAt = new Date();
      await tx
        .update(conflictReviews)
        .set({
          status: 'reviewed',
          reviewNote: input.note,
          reviewedBy: userId,
          reviewedAt,
          updatedBy: userId,
          updatedAt: reviewedAt,
        })
        .where(and(eq(conflictReviews.id, reviewId), eq(conflictReviews.farmId, input.farmId)));

      await tx
        .insert(auditLog)
        .values({
          farmId: input.farmId,
          userId,
          tableName: 'conflict_reviews',
          recordId: reviewId,
          action: 'conflict_reviewed',
          rule: 'A human reviewed the surfaced conflict; source facts and the original audit row remain unchanged.',
          conflictKey: `reviewed:${row.conflictKey}`,
          facts: {
            reviewId,
            conflictKey: row.conflictKey,
            reviewedAt: reviewedAt.toISOString(),
            note: input.note ?? null,
          },
          winner: row.winnerEventId === null ? null : { eventId: row.winnerEventId },
        })
        .onConflictDoNothing({ target: auditLog.conflictKey });
    });
  }
}

async function membership(
  tx: Parameters<Parameters<AppDb['asUser']>[1]>[0],
  userId: string,
  farmId: string,
): Promise<string> {
  const [row] = await tx
    .select({ role: farmUsers.role })
    .from(farmUsers)
    .where(
      and(eq(farmUsers.userId, userId), eq(farmUsers.farmId, farmId), isNull(farmUsers.deletedAt)),
    );
  if (!row) throw new NotFoundError('Farm not found');
  return row.role;
}
