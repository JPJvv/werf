/** Wire contracts for the server-only conflict review queue (US-040). */

import { z } from 'zod';
import { timestampSchema, uuidSchema } from './primitives';

export const conflictKindSchema = z.enum([
  'field_lww',
  'possible_duplicate_birth',
  'status_contradiction',
]);
export type ConflictKind = z.infer<typeof conflictKindSchema>;

export const conflictReviewJsonSchema = z.object({
  id: uuidSchema,
  farmId: uuidSchema,
  kind: conflictKindSchema,
  subjectId: uuidSchema,
  field: z.string().nullable(),
  factAEventId: uuidSchema,
  factBEventId: uuidSchema,
  winnerEventId: uuidSchema.nullable(),
  rule: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
});
export type ConflictReviewJson = z.infer<typeof conflictReviewJsonSchema>;

/** Parsed server form, useful outside JSON/local-storage boundaries. */
export const conflictReviewSchema = conflictReviewJsonSchema.extend({ createdAt: timestampSchema });
export type ConflictReview = z.infer<typeof conflictReviewSchema>;

export const reviewConflictRequestSchema = z.object({
  farmId: uuidSchema,
  note: z.string().trim().min(1).max(2_000).optional(),
});
export type ReviewConflictRequest = z.infer<typeof reviewConflictRequestSchema>;
