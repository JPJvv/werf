/**
 * Species gestation — biological reference data (Phase 2, FR-121). The source the pregnancy-
 * diagnosis capture injects `gestationDays` FROM, so that `projectDueDate` never has a number
 * typed into it (.claude/rules/domain.md, and @werf/domain's breeding module says the same).
 *
 * Reference data, NOT farm data: no `farm_id`, no soft-delete. Readable by any authenticated app
 * connection because the device needs it offline — a pregnancy test happens in a race, and the
 * whole value of projecting the due date is that the farmer sees it standing there — and writable
 * only by the elevated migration/admin path. The RLS + GRANT that enforce that are hand-authored
 * in migration 0019.
 *
 * ⭐ It differs from `veterinary_products` and `regulatory_rates` in two ways, both deliberate:
 *
 *  1. NO `jurisdiction`. A withdrawal period is a registration and stops at the border; a
 *     gestation period is biology and does not. Scoping this by country would make every future
 *     jurisdiction pack restate that a cow carries a calf for about 283 days — shared biology
 *     leaking into a jurisdiction seam, which is the mirror image of what ADR-0006 warns about.
 *  2. NO `effective_from`/`effective_to`. Dated reference data exists because a regulated number
 *     changes ON A DATE, and an old event must resolve the rule that applied to it (ADR-0005).
 *     Biology has no such date: a corrected gestation figure was simply wrong before, not
 *     superseded. Stored due dates are safe either way — the projection is computed AT CAPTURE
 *     and frozen onto the event, so correcting a figure never moves a date already told to a
 *     farmer.
 *
 * `source` is not decoration. It is the "says who?" answer, the same job a `gazetteReference`
 * does for a regulated rate: in three years nobody can tell whether 283 is biology or a typo
 * unless the row says where it came from.
 */

import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { primaryId } from './columns';

export const speciesGestation = pgTable('species_gestation', {
  id: primaryId(),
  /** Matches `SPECIES` in @werf/core. Unique — one figure per species, never a version history. */
  species: text('species').notNull(),
  /** The species mean, in whole days. A projection, not a promise: breeds vary by ~10 days. */
  gestationDays: integer('gestation_days').notNull(),
  /** Where the figure comes from, so a later reader can check it rather than trust it. */
  source: text('source').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
