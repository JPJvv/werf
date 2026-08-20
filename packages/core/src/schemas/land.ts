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
  irrigationTypeSchema,
  landUnitKindSchema,
  timestampSchema,
  uuidSchema,
  uuidV7Schema,
} from './primitives';
import { boundaryWalkPayloadSchema } from './events';

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
  /** FR-201's "irrigation type" — a closed set (@werf/core), not free text. */
  irrigation: irrigationTypeSchema.nullable(),
  attributes: z.record(z.string(), z.unknown()),
  ...auditTimestampsSchema,
});
export type LandUnit = z.infer<typeof landUnitSchema>;

export const newLandUnitSchema = landUnitSchema
  .pick({ id: true, farmId: true, kind: true, code: true })
  .extend({
    /** Client-generated UUIDv7 for the land unit row (P2.9) — not merely a well-formed UUID. */
    id: uuidV7Schema,
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

/**
 * Wire contract for a GPS boundary walk (FR-150) — the fence walked on foot, corner by corner.
 *
 * ⭐ WHAT THE BODY CANNOT CARRY IS THE POINT: no `boundaryGeojson` and no `areaHectares`. The client
 * sends the FIXES it took and the server derives the ring and its area from them, exactly as the
 * projected due date never crosses the wire (ADR-0005). A client that could send both a shape and
 * the corners behind it could send a pair that disagree, and the corners are what makes the shape
 * answerable later — a boundary whose own evidence contradicts it is worse than one with none.
 *
 * The device still closes the ring locally, because a farmer standing at a fence has to see the
 * shape and the area before deciding the walk is finished. Same computation, same module
 * (`@werf/domain`), run twice on purpose — the device's answer is a preview and the server's is
 * the record.
 *
 * No `animalId`, `mobId` or `enterpriseId`: a camp is ground, not a herd. `createdBy` and `syncedAt`
 * are absent because they are server-owned.
 */
export const recordBoundaryWalkRequestSchema = z.object({
  /** Client-generated UUIDv7 for the event row. */
  id: uuidV7Schema,
  farmId: uuidSchema,
  /** The camp or block whose fence was walked. Required — a shape with no ground is nothing. */
  landUnitId: uuidSchema,
  /** When the fence was WALKED on the farm, which is days before this arrives from a dead zone. */
  occurredAt: timestampSchema,
  notes: z.string().min(1).nullable().default(null),
  /** The fixes taken along the fence, in walk order. Reused from the payload so the two cannot drift. */
  corners: boundaryWalkPayloadSchema.shape.corners,
});
export type RecordBoundaryWalkRequest = z.infer<typeof recordBoundaryWalkRequestSchema>;
