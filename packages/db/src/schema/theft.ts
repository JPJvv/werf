/**
 * Stock-theft incidents (Phase 2, FR-603/605) — the record a farmer captures in the field, at the
 * last-seen location, offline. Implements docs/03-architecture/database-schema.md § 7 and
 * legal-compliance.md § 3.2 (Stock Theft Act 57 of 1959). The one action a farmer runs off this
 * table is the EVIDENCE PACK: a single facts-only PDF for the SAPS Stock Theft Unit.
 *
 * ⚠️ NOTE WHAT IS ABSENT: there is no `suspect` column, and there never will be. A farmer naming a
 * neighbour is a defamation exposure for them and a POPIA s26 criminal-behaviour processing exposure
 * for us (legal-compliance.md § 3.2). The pack records what was FOUND, when, where, what was
 * REPORTED, and the case number — facts only. `case_number`/`reporting_station` are neutral columns
 * (ADR-0006); in ZA copy they read "SAPS case number"/"SAPS station".
 *
 * ⭐ Geometry is dual-written like land_units/events: canonical `last_seen_location` (PostGIS) for
 * spatial queries and `last_seen_location_geojson` (text) for the offline client, kept in step by
 * the theft_incidents_sync_geojson trigger (hand-authored in the migration — drizzle has no PostGIS).
 */

import { integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { auditColumns, geometry, primaryId } from './columns';
import { farms, users } from './core';
import { animals } from './animals';
import { landUnits } from './land';

export const theftIncidents = pgTable('theft_incidents', {
  id: primaryId(),
  farmId: uuid('farm_id')
    .notNull()
    .references(() => farms.id),
  /** When the loss was discovered. */
  discoveredAt: timestamp('discovered_at', { withTimezone: true }).notNull(),
  /** When the stock was last seen — the anchor of the ownership/possession timeline. */
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  /** Canonical last-seen GPS. Not read through drizzle; spatial work is raw SQL. */
  lastSeenLocation: geometry('last_seen_location', { type: 'Point', srid: 4326 }),
  /** ⭐ The client reads this; kept in step with `last_seen_location` by the sync_geojson trigger. */
  lastSeenLocationGeojson: text('last_seen_location_geojson'),
  landUnitId: uuid('land_unit_id').references(() => landUnits.id),
  headCount: integer('head_count').notNull(),
  /** ZA copy: "SAPS case number". Neutral column (ADR-0006). */
  caseNumber: text('case_number'),
  /** ZA copy: "SAPS station". */
  reportingStation: text('reporting_station'),
  status: text('status').notNull().default('open'), // 'open' | 'recovered' | 'closed'
  /** Facts only — what was found and reported. */
  observations: text('observations'),
  /** Storage key of the generated evidence-pack PDF, once produced. */
  evidencePackKey: text('evidence_pack_key'),
  /**
   * ⭐ WHO filed this, and who last touched it. Not decoration on this table: an evidence pack is
   * handed to the SAPS Stock Theft Unit, and "who reported it, and when" is part of what makes the
   * document worth anything. db.md requires created_by/updated_by on every table; here it is
   * evidentiary. Added additively in migration 0015 — never by editing an applied migration.
   */
  createdBy: uuid('created_by').references(() => users.id),
  updatedBy: uuid('updated_by').references(() => users.id),
  ...auditColumns,
});

/**
 * The animals a theft incident concerns (FR-603 ownership chain). Carries its own `farm_id` so it
 * scopes directly under RLS — the same choice animal_identifiers made — rather than joining through
 * the incident. A link is added when the farmer marks which stock was taken; `recovered_at` is set
 * if an animal is later found.
 */
export const theftIncidentAnimals = pgTable(
  'theft_incident_animals',
  {
    farmId: uuid('farm_id')
      .notNull()
      .references(() => farms.id),
    incidentId: uuid('incident_id')
      .notNull()
      .references(() => theftIncidents.id),
    animalId: uuid('animal_id')
      .notNull()
      .references(() => animals.id),
    recoveredAt: timestamp('recovered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.incidentId, t.animalId] })],
);
