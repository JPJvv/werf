/**
 * Veterinary products — regulated reference data (Phase 2, FR-131). Implements
 * docs/03-architecture/database-schema.md § 7 and legal-compliance.md § 3. The withdrawal
 * period a treatment stores on its event (meat/milk) is the product's REGISTERED figure, resolved
 * from here — never a number typed into code (.claude/rules/domain.md). A ZA device downloads only
 * ZA products (reference-jurisdiction sync); the withdrawal check then works offline, in the crush.
 *
 * Like `regulatory_rates`, this is reference data, NOT farm data: no `farm_id`, no soft-delete,
 * versioned by `effective_from`/`effective_to`. It is readable by any authenticated app connection
 * (the client needs it offline) and writable only by the elevated migration/admin path — never by
 * `werf_app`. The RLS + GRANT that enforce that are hand-authored in the migration.
 *
 * ⭐ `milk_withdrawal_hours` is HOURS while `meat_withdrawal_days` is DAYS — that is how the
 * registrations are published (milk clears in hours, meat in days). The service converts hours to
 * whole days (rounding UP, so a partial day never under-withholds) at the I/O boundary before the
 * pure domain, which reasons in calendar days to match a day-grained capture.
 */

import { char, date, integer, numeric, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { primaryId } from './columns';

export const veterinaryProducts = pgTable('veterinary_products', {
  id: primaryId(),
  /** A registration is per-country: reference data is filtered by the FARM's jurisdiction. */
  jurisdiction: char('jurisdiction', { length: 2 }).notNull().default('ZA'),
  name: text('name').notNull(),
  /** ZA: registered under the relevant medicines/stock-remedies Act. May be absent for older stock. */
  registrationNumber: text('registration_number'),
  activeIngredients: text('active_ingredients').array().notNull(),
  /** The species this product is registered for. */
  species: text('species').array().notNull(),
  /** Meat withdrawal, in whole DAYS. Null = no meat withdrawal. */
  meatWithdrawalDays: integer('meat_withdrawal_days'),
  /** Milk withdrawal, in HOURS (that is how it is published). Null = no milk withdrawal. */
  milkWithdrawalHours: integer('milk_withdrawal_hours'),
  dosePerKg: numeric('dose_per_kg', { precision: 10, scale: 4 }),
  route: text('route'),
  /** Bumped when a registration changes; the old row keeps its `effective_to`. */
  version: integer('version').notNull().default(1),
  effectiveFrom: date('effective_from').notNull(),
  effectiveTo: date('effective_to'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
