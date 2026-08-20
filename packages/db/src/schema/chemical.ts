/**
 * Chemical products — regulated reference data (Phase 4, FR-204/FR-508). Implements
 * docs/03-architecture/database-schema.md § "Reference data" and legal-compliance.md § 4. The
 * pre-harvest interval a spray stores on its event is the product's REGISTERED figure, resolved
 * from here — never a number typed into code (.claude/rules/domain.md). Same shape and same
 * reasoning as `veterinary_products` (`veterinary.ts`), one enterprise over: a ZA device downloads
 * only ZA-registered products (reference-jurisdiction sync), so the PHI check works offline.
 *
 * Like `veterinary_products` and `regulatory_rates`, this is reference data, NOT farm data: no
 * `farm_id`, no soft-delete, versioned by `effective_from`/`effective_to`. Readable by any
 * authenticated app connection (the client needs it offline) and writable only by the elevated
 * migration/admin path — never by `werf_app`. The RLS + GRANT that enforce that are hand-authored
 * in the migration, mirroring `veterinary_products`'.
 *
 * ⭐ Unlike `veterinary_products.registrationNumber` (nullable — older vet stock may predate one),
 * `registration_number` here is NOT NULL: every Act 36 of 1947 agricultural remedy registration
 * carries one by law, so an unregistered row is not a real product (`database-schema.md:566`).
 *
 * ⭐ `phi_days` is NULLABLE, and that null is a real state distinct from zero (P1.3's own lesson,
 * `LocalVetProducts.tsx`'s header): "registered with no pre-harvest interval" and "this device has
 * no record of this product's PHI" must read as different facts to a fail-closed guard. The service
 * that resolves this table omits `phiDays` from the event entirely when it is null — never writes
 * zero — the same discipline `attachDosing` (`livestock/health.ts`) already applies to a
 * zero-withdrawal vaccine.
 */

import { char, date, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { primaryId } from './columns';

export const chemicalProducts = pgTable('chemical_products', {
  id: primaryId(),
  /** A registration is per-country: reference data is filtered by the FARM's jurisdiction. */
  jurisdiction: char('jurisdiction', { length: 2 }).notNull().default('ZA'),
  name: text('name').notNull(),
  /** ZA: registered under Act 36 of 1947. Every real registration carries one — see the module note. */
  registrationNumber: text('registration_number').notNull(),
  activeIngredients: text('active_ingredients').array().notNull(),
  /** The crop this registration covers, when the registration is crop-specific. */
  crop: text('crop'),
  /** Pre-harvest interval, in whole DAYS. Null = no PHI on record — see the module note. */
  phiDays: integer('phi_days'),
  /** Re-entry interval, in HOURS (published that way). Null = no re-entry restriction on record. */
  reentryHours: integer('reentry_hours'),
  /** Bumped when a registration changes; the old row keeps its `effective_to`. */
  version: integer('version').notNull().default(1),
  effectiveFrom: date('effective_from').notNull(),
  effectiveTo: date('effective_to'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
