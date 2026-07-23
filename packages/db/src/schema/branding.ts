/**
 * Branding registers — the South African identification mark (Phase 2, FR-601). Implements
 * docs/03-architecture/database-schema.md § 7 and legal-compliance.md § 3.1 (Animal Identification
 * Act 6 of 2002): owners of cattle, sheep, goats and pigs register a mark (up to three characters)
 * and mark their animals with it. One register row per registered mark; every `animals` row links
 * to the mark it carries via `brand_id` (added additively to the animals table in this migration).
 *
 * `jurisdiction` is `char(2)` because a mark registration is national — a mark is registered with a
 * country's Registrar, not a farm. The ≤3-character rule is a DB CHECK while ZA is the only country
 * (db.md § 7); it moves into AnimalIdentityRules (ADR-0006) when a second jurisdiction arrives,
 * because Namibia's marks are not South Africa's. This table has NO geometry, so no sync trigger.
 */

import { sql } from 'drizzle-orm';
import { char, check, date, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { auditColumns, primaryId } from './columns';
import { farms } from './core';

export const brandingRegisters = pgTable(
  'branding_registers',
  {
    id: primaryId(),
    farmId: uuid('farm_id')
      .notNull()
      .references(() => farms.id),
    jurisdiction: char('jurisdiction', { length: 2 }).notNull().default('ZA'),
    /** The registered mark. ZA: up to three characters (enforced by the CHECK below). */
    mark: text('mark').notNull(),
    /** 'tattoo' | 'freeze_brand' | 'hot_brand' — the marking method (Act 6 of 2002). */
    markType: text('mark_type').notNull(),
    /** The species this mark covers (a farm may register different marks per species). */
    species: text('species').array().notNull(),
    /** Where on the animal the mark is applied. */
    bodyPosition: text('body_position'),
    certificateReference: text('certificate_reference'),
    registeredAt: date('registered_at'),
    ...auditColumns,
  },
  (t) => [
    // ⚠️ The ≤3 rule is South African. When a second jurisdiction arrives this CHECK moves into
    // AnimalIdentityRules (ADR-0006). Fine as a CHECK while ZA is the only country (db.md § 7).
    check('branding_registers_mark_length', sql`char_length(${t.mark}) <= 3`),
  ],
);
