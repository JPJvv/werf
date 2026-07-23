/**
 * Land unit entity — camps and blocks (FR-150, database-schema.md §3). One table, one
 * schema; the terminology layer renders "camp" or "block" per the farm's enterprise.
 *
 * Record + new shapes, exactly as entities.ts: the record is a persisted row with
 * server-owned audit timestamps; the new shape is what a client composes offline, carrying
 * its own client-generated UUIDv7 id.
 *
 * ⭐ The boundary crosses the wire as **GeoJSON text** (`boundaryGeojson`), never as the
 * PostGIS `geometry`. SQLite on the device has no PostGIS, so the canonical `geometry`
 * column stays server-side and the client reads/authors the denormalised GeoJSON mirror.
 * The server owns the conversion between the two (offline-sync.md, .claude/rules/db.md).
 * We validate that the string parses as JSON with a `type`, not the full GeoJSON grammar —
 * deep geometry validation is the mapping feature's job, not this contract's.
 */

import { z } from 'zod';
import {
  auditTimestampsSchema,
  geoJsonStringSchema,
  landUnitKindSchema,
  uuidSchema,
} from './primitives';

/** A GeoJSON geometry as a string. Nullable: a camp may exist before it is mapped. */
const boundaryGeojsonSchema = geoJsonStringSchema.nullable();

export const landUnitSchema = z.object({
  id: uuidSchema,
  farmId: uuidSchema,
  /** The enterprise this ground is attributed to, if any (grazing → beef, block → maize). */
  enterpriseId: uuidSchema.nullable(),
  /** Block splitting / camp sub-division (FR-202): a child points at its parent. */
  parentId: uuidSchema.nullable(),
  kind: landUnitKindSchema,
  /** The farmer's own label — "Camp 3", "B12". Unique per farm (enforced in the DB). */
  code: z.string().min(1),
  name: z.string().min(1).nullable(),
  boundaryGeojson: boundaryGeojsonSchema,
  hectares: z.number().nonnegative().nullable(),
  /** Large-stock-unit carrying capacity — camps only. */
  carryingCapacityLsu: z.number().nonnegative().nullable(),
  soilType: z.string().min(1).nullable(),
  irrigation: z.string().min(1).nullable(),
  attributes: z.record(z.string(), z.unknown()),
  ...auditTimestampsSchema,
});
export type LandUnit = z.infer<typeof landUnitSchema>;

export const newLandUnitSchema = landUnitSchema
  .pick({ id: true, farmId: true, kind: true, code: true })
  .extend({
    enterpriseId: landUnitSchema.shape.enterpriseId.default(null),
    parentId: landUnitSchema.shape.parentId.default(null),
    name: landUnitSchema.shape.name.default(null),
    boundaryGeojson: landUnitSchema.shape.boundaryGeojson.default(null),
    hectares: landUnitSchema.shape.hectares.default(null),
    carryingCapacityLsu: landUnitSchema.shape.carryingCapacityLsu.default(null),
    soilType: landUnitSchema.shape.soilType.default(null),
    irrigation: landUnitSchema.shape.irrigation.default(null),
    attributes: z.record(z.string(), z.unknown()).default({}),
  });
export type NewLandUnit = z.infer<typeof newLandUnitSchema>;
