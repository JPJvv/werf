/**
 * Land — camps (livestock) and blocks (crops), one table (Phase 2). Implements
 * docs/03-architecture/database-schema.md § 3. A camp and a block are the same fenced
 * ground wearing different words; the terminology layer decides which the farmer sees.
 *
 * ⭐ Geometry is dual-written: the canonical `boundary` (PostGIS) for spatial queries and
 * a denormalised `boundary_geojson` (text) the client reads, because SQLite has no PostGIS.
 * The `sync_geojson` trigger and the `postgis` extension are hand-authored in the migration
 * (drizzle does not know PostGIS), exactly as RLS and the UUIDv7 function are.
 */

import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { auditColumns, geometry, primaryId } from './columns';
import { landUnitKindEnum } from './enums';
import { enterprises, farms, users } from './core';

export const landUnits = pgTable(
  'land_units',
  {
    id: primaryId(),
    farmId: uuid('farm_id')
      .notNull()
      .references(() => farms.id),
    /** What this ground is attributed to financially (grazing → beef, block → maize). */
    enterpriseId: uuid('enterprise_id').references(() => enterprises.id),
    /** Block/camp sub-division (FR-202): a child points at its parent land unit. */
    parentId: uuid('parent_id').references((): AnyPgColumn => landUnits.id),
    kind: landUnitKindEnum('kind').notNull(),
    code: text('code').notNull(), // "Camp 3", "B12" — the farmer's own label
    name: text('name'),
    /** Canonical boundary. Not read through drizzle; spatial queries are raw SQL. */
    boundary: geometry('boundary', { type: 'Polygon', srid: 4326 }),
    /** ⭐ The client reads this. Kept in step with `boundary` by the sync_geojson trigger. */
    boundaryGeojson: text('boundary_geojson'),
    hectares: numeric('hectares', { precision: 10, scale: 2 }),
    carryingCapacityLsu: numeric('carrying_capacity_lsu', { precision: 8, scale: 2 }), // camps
    soilType: text('soil_type'), // blocks
    irrigation: text('irrigation'),
    attributes: jsonb('attributes').notNull().default({}),
    ...auditColumns,
    createdBy: uuid('created_by').references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
  },
  (t) => [
    unique('land_units_farm_code_unique').on(t.farmId, t.code),
    index('land_units_farm_idx')
      .on(t.farmId)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);
