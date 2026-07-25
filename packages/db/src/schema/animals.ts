/**
 * Animals — the core livestock records (Phase 2). Implements
 * docs/03-architecture/database-schema.md § 4. One `animals` table for every species
 * (ADR-0004); species-specific data lives in the Zod-validated `attributes` JSONB, never a
 * column per species. A `mob` is the group-only model (FR-102).
 *
 * `species` is `text`, not an enum: a new species is a code release, not a migration. The
 * branding link (`brand_id` / `brand_applied_at`, FR-601/602) was added additively with the
 * Animal Identification Act slice (migration 0011) — `branding_registers` is defined in ./branding.
 */

import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { auditColumns, primaryId } from './columns';
import { animalSexEnum, animalStatusEnum, identifierTypeEnum } from './enums';
import { enterprises, farms, users } from './core';
import { landUnits } from './land';
import { brandingRegisters } from './branding';

/**
 * A group of animals managed without individual records (FR-102). `head_count` is the whole
 * point: "Flock A: 300 head" is a valid, complete record with no `animals` rows behind it.
 */
export const mobs = pgTable('mobs', {
  id: primaryId(),
  farmId: uuid('farm_id')
    .notNull()
    .references(() => farms.id),
  enterpriseId: uuid('enterprise_id').references(() => enterprises.id),
  name: text('name').notNull(),
  species: text('species').notNull(),
  landUnitId: uuid('land_unit_id').references(() => landUnits.id),
  headCount: integer('head_count'),
  ...auditColumns,
  createdBy: uuid('created_by').references(() => users.id),
  updatedBy: uuid('updated_by').references(() => users.id),
});

export const animals = pgTable(
  'animals',
  {
    id: primaryId(),
    farmId: uuid('farm_id')
      .notNull()
      .references(() => farms.id),
    enterpriseId: uuid('enterprise_id').references(() => enterprises.id),
    species: text('species').notNull(),
    breed: text('breed'),
    sex: animalSexEnum('sex').notNull(),
    dob: date('dob'),
    dobEstimated: boolean('dob_estimated').notNull().default(false),
    status: animalStatusEnum('status').notNull().default('alive'),
    statusAt: timestamp('status_at', { withTimezone: true }),
    damId: uuid('dam_id').references((): AnyPgColumn => animals.id),
    sireId: uuid('sire_id').references((): AnyPgColumn => animals.id),
    mobId: uuid('mob_id').references(() => mobs.id),
    /** Denormalised current location; the move history is the append-only event log. */
    landUnitId: uuid('land_unit_id').references(() => landUnits.id),
    source: text('source'),
    acquiredAt: date('acquired_at'),
    /** The registered mark this animal carries (FR-602). Null = unmarked (a compliance flag once
     *  past the prescribed window after acquisition). */
    brandId: uuid('brand_id').references(() => brandingRegisters.id),
    brandAppliedAt: date('brand_applied_at'),
    attributes: jsonb('attributes').notNull().default({}),
    photoKey: text('photo_key'),
    ...auditColumns,
    createdBy: uuid('created_by').references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
  },
  (t) => [
    // Live-herd reads are the hottest query: only 'alive', by farm and species.
    index('animals_farm_live_idx')
      .on(t.farmId, t.species)
      .where(sql`${t.deletedAt} IS NULL AND ${t.status} = 'alive'`),
    index('animals_mob_idx')
      .on(t.mobId)
      .where(sql`${t.deletedAt} IS NULL`),
    index('animals_dam_idx').on(t.damId),
    index('animals_sire_idx').on(t.sireId),
    index('animals_attrs_gin').using('gin', t.attributes),
  ],
);

/**
 * Many identifiers per animal (FR-109): a visual tag, an EID, a brand, a tattoo, a national
 * LITS-SA id — all at once. Unique per farm per type among live rows, so a retired tag can be
 * reissued after the animal carrying it is gone.
 */
export const animalIdentifiers = pgTable(
  'animal_identifiers',
  {
    id: primaryId(),
    farmId: uuid('farm_id')
      .notNull()
      .references(() => farms.id),
    animalId: uuid('animal_id')
      .notNull()
      .references(() => animals.id),
    type: identifierTypeEnum('type').notNull(),
    value: text('value').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    appliedAt: date('applied_at'),
    ...auditColumns,
    createdBy: uuid('created_by').references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
  },
  (t) => [
    uniqueIndex('animal_identifiers_unique')
      .on(t.farmId, t.type, t.value)
      .where(sql`${t.deletedAt} IS NULL`),
    index('animal_identifiers_lookup')
      .on(t.farmId, t.value)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);
