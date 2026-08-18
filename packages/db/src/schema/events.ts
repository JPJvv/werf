/**
 * Events — the append-only heart (Phase 2). Implements database-schema.md § 5. Everything that
 * happens on the farm is an event; this is the highest-volume table in the system.
 *
 * ⭐ PARTITIONED BY LIST (farm_id) from day one. Drizzle cannot express `PARTITION BY`, the
 * per-farm partitions, the default partition, the `location` GeoJSON trigger, the GIST/GIN
 * indexes, or RLS — all of those are hand-authored in the migration (0010_events), exactly as
 * PostGIS, the UUIDv7 function and RLS are elsewhere. This module defines the columns, the FKs,
 * and the COMPOSITE primary key that partitioning forces.
 *
 * ⭐ The primary key is (id, farm_id), not id alone: Postgres requires the partition key to be a
 * member of every unique constraint on a partitioned table. id is still a client-generated
 * UUIDv7 and unique in practice; farm_id rides along because the planner partitions on it.
 *
 * ⭐ Three timestamps, three meanings (§ 5): occurred_at (farm time — REPORTS use this),
 * created_at (row written), synced_at (reached the server). updated_at is the sync LWW clock.
 * Events are append-only and never merged; the only update is a soft-delete correction, which is
 * why there is a created_by but no updated_by.
 *
 * `location` is dual-written like land's boundary: canonical PostGIS `geometry(Point,4326)` for
 * spatial queries + a denormalised `location_geojson` the offline client reads. Kept in step by
 * the events-specific `events_sync_geojson` trigger — NOT land's, which is boundary-specific.
 * `employee_id` has no FK yet: the employees table arrives with the labour phase (additive then).
 */

import { sql } from 'drizzle-orm';
import { jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { auditColumns, geometry } from './columns';
import { eventTypeEnum } from './enums';
import { enterprises, farms, users } from './core';
import { landUnits } from './land';
import { animals, mobs } from './animals';
import { inventoryLots } from './inventory';

export const events = pgTable(
  'events',
  {
    id: uuid('id')
      .notNull()
      .default(sql`uuid_generate_v7()`),
    farmId: uuid('farm_id')
      .notNull()
      .references(() => farms.id),
    enterpriseId: uuid('enterprise_id').references(() => enterprises.id),
    type: eventTypeEnum('type').notNull(),
    /** ⭐ When it happened on the farm. REPORTS USE THIS, never created_at. */
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    /** When it reached the server. Null until it has. */
    syncedAt: timestamp('synced_at', { withTimezone: true }),
    animalId: uuid('animal_id').references(() => animals.id),
    mobId: uuid('mob_id').references(() => mobs.id),
    landUnitId: uuid('land_unit_id').references(() => landUnits.id),
    /** No FK yet — the employees table (labour phase) does not exist; the constraint is added then. */
    employeeId: uuid('employee_id'),
    /** Groups one action (a dosing run, a weigh session) across many animals (FR-112). */
    batchId: uuid('batch_id'),
    /** The inventory lot an `inventory_movement` concerns (Phase 4e, FR-501). Null otherwise. */
    inventoryLotId: uuid('inventory_lot_id').references(() => inventoryLots.id),
    /** Server-authored device/session provenance. Never synced to farm devices. */
    sourceSessionId: uuid('source_session_id'),
    payload: jsonb('payload').notNull(),
    /** Canonical location. Not read through drizzle; spatial work is raw SQL. */
    location: geometry('location', { type: 'Point', srid: 4326 }),
    /** ⭐ The client reads this. Kept in step with `location` by the events_sync_geojson trigger. */
    locationGeojson: text('location_geojson'),
    notes: text('notes'),
    ...auditColumns,
    createdBy: uuid('created_by').references(() => users.id),
  },
  (t) => [
    // Partition key must be part of the PK (Postgres LIST-partition rule). See module header.
    primaryKey({ columns: [t.id, t.farmId] }),
  ],
);
