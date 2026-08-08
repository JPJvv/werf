/**
 * Land capture (FR-150) — creating a camp or a block, the server end of the offline flush.
 *
 * Its own module rather than a livestock endpoint, for the same reason rainfall has one: a block is
 * not a livestock fact. One table wears both words (database-schema.md § 3), and filing the create
 * action under `/livestock` would make the crop side of a mixed farm reach into the livestock module
 * to add a block — the API-layer version of the mistake that scoping the row to an enterprise would
 * be at the data layer.
 *
 * ⭐ THE DUAL-WRITE RUNS IN THIS DIRECTION TOO. The client has no PostGIS, so it authors the
 * boundary as GeoJSON; the canonical `geometry` is derived HERE, with `ST_GeomFromGeoJSON`, and the
 * `land_units_geojson` trigger then writes the normalised GeoJSON mirror back. Storing the client's
 * text and leaving `boundary` null would satisfy the client and quietly break every spatial query
 * the canonical column exists for — the trigger only fires geometry→GeoJSON, so nothing else would
 * have caught it. "Both, always" (.claude/rules/db.md) is a round trip, not a one-way street.
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { landUnits, type AppDb } from '@werf/db';
import { ConflictError, ValidationError, type schemas } from '@werf/core';
import { recordBoundaryWalk } from '@werf/domain';
import { APP_DB } from '../db/db.module';
import {
  assertCanCapture,
  assertOwnedReferences,
  insertEvent,
  type CaptureTx,
  type CapturedEvent,
} from '../common/event-capture';

/** The `land_units` columns returned to a caller — every column EXCEPT the PostGIS `boundary`,
 *  which is geometry (neverSyncColumns), has no meaning to the client, and never goes on the wire.
 *  The client reads `boundaryGeojson`, which the trigger keeps in step with it. */
const landUnitProjection = {
  id: landUnits.id,
  farmId: landUnits.farmId,
  enterpriseId: landUnits.enterpriseId,
  parentId: landUnits.parentId,
  kind: landUnits.kind,
  code: landUnits.code,
  name: landUnits.name,
  boundaryGeojson: landUnits.boundaryGeojson,
  hectares: landUnits.hectares,
  carryingCapacityLsu: landUnits.carryingCapacityLsu,
  soilType: landUnits.soilType,
  irrigation: landUnits.irrigation,
  attributes: landUnits.attributes,
  createdBy: landUnits.createdBy,
  updatedBy: landUnits.updatedBy,
  createdAt: landUnits.createdAt,
  updatedAt: landUnits.updatedAt,
  deletedAt: landUnits.deletedAt,
} as const;

/** The persisted land unit as returned to a caller — the PostGIS `boundary` is never on the wire. */
export type CapturedLandUnit = Awaited<ReturnType<LandService['createLandUnit']>>;

/** Postgres' unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = '23505';

@Injectable()
export class LandService {
  constructor(@Inject(APP_DB) private readonly app: AppDb) {}

  /**
   * Creates a camp or block (FR-150). Everything runs through `AppDb.asUser`, so RLS — not this
   * file — is the tenancy boundary, and the insert is idempotent on the client-generated id so an
   * at-least-once flush never produces a second copy of the same camp.
   *
   * A DIFFERENT id carrying a code the farm already uses is a genuine conflict, not a retry, and is
   * refused with a message a farmer can act on. Two devices naming a camp "3" in the same week while
   * both offline is a real conflict this cannot resolve on its own — recognising it and saying so is
   * the honest Phase 2 answer; merging them silently would lose one farmer's boundary. The client
   * avoids the common case by checking the codes it already holds before it lets the name be saved.
   */
  async createLandUnit(userId: string, input: schemas.NewLandUnit) {
    return this.app.asUser(userId, async (tx) => {
      await assertCanCapture(tx, userId, input.farmId);
      // A camp's enterprise and its parent camp are both FKs to farm-scoped tables, and neither
      // the foreign key nor RLS checks that they belong to THIS farm — see `assertOwnedReferences`.
      await assertOwnedReferences(tx, input.farmId, {
        enterpriseId: input.enterpriseId,
        parentLandUnitId: input.parentId,
      });

      const [row] = await tx
        .insert(landUnits)
        .values({
          id: input.id,
          farmId: input.farmId,
          enterpriseId: input.enterpriseId,
          parentId: input.parentId,
          kind: input.kind,
          code: input.code,
          name: input.name,
          // ⭐ GeoJSON → the canonical PostGIS geometry. The trigger writes the mirror back, so the
          // stored GeoJSON is PostGIS' own normalisation of the shape rather than whatever text the
          // client happened to send — which is what makes the two columns provably the same shape.
          boundary: boundaryGeometry(input.boundaryGeojson),
          // numeric(p,s) round-trips as a string in the driver; the wire contract is a number.
          hectares: numericText(input.hectares),
          carryingCapacityLsu: numericText(input.carryingCapacityLsu),
          soilType: input.soilType,
          irrigation: input.irrigation,
          attributes: input.attributes,
          createdBy: userId,
        })
        // Idempotent on the id ONLY. A bare onConflictDoNothing() would also swallow a duplicate
        // CODE, and the read-back below would then return someone else's camp under this id.
        .onConflictDoNothing({ target: landUnits.id })
        .returning(landUnitProjection)
        .catch(rethrowDuplicateCode(input.code));

      if (row) return row;

      // The row was already here (a retried flush). Read it back through the farm's RLS scope.
      const [existing] = await tx
        .select(landUnitProjection)
        .from(landUnits)
        .where(and(eq(landUnits.id, input.id), eq(landUnits.farmId, input.farmId)));
      return existing!;
    });
  }

  /**
   * Records a GPS boundary walk (FR-150) and re-derives the camp's current boundary from the log.
   *
   * The ring is built HERE from the fixes the client sent, by the same `@werf/domain` function the
   * device ran to draw it — the polygon never crosses the wire, so a client cannot send a shape and
   * a corner list that disagree (the same reason a projected due date never crosses it).
   *
   * ⭐ THE COLUMN IS RE-DERIVED FROM THE WHOLE LOG, NOT STEPPED BY THIS ARRIVAL. Two phones offline
   * in the same week can both walk this camp, and arrival order is not `occurred_at` order — a
   * server that wrote the incoming shape straight onto the row would leave the boundary at whichever
   * phone reconnected last. Re-selecting the newest walk after every insert answers from scratch
   * every time, so an older walk arriving late is kept in the log and correctly loses, and the
   * answer does not depend on the order the writes landed in.
   *
   * ⭐ On idempotency, asked explicitly because §2d's rule is that the second question must be:
   * does this capture change state its own validation reads? No. `recordBoundaryWalk` validates the
   * request's own corners (pure), and the reference and role checks are stable. The re-derivation is
   * a PROJECTION rather than a validation and gives the same answer however many times it runs — so
   * a re-flushed walk is absorbed by `insertEvent`'s conflict clause and cannot jam the queue the
   * way a move would.
   */
  async recordBoundaryWalk(
    userId: string,
    input: schemas.RecordBoundaryWalkRequest,
  ): Promise<CapturedEvent> {
    return this.app.asUser(userId, async (tx) => {
      await assertCanCapture(tx, userId, input.farmId);
      // The camp itself is checked by `insertEvent` via `assertOwnedReferences`, so a walk cannot
      // be filed against a neighbour's ground.

      const event = recordBoundaryWalk({
        id: input.id,
        farmId: input.farmId,
        landUnitId: input.landUnitId,
        occurredAt: input.occurredAt,
        corners: input.corners,
        notes: input.notes,
        createdBy: userId,
      });

      // PostGIS is the authority on whether this is a storable Polygon, and it is asked BEFORE the
      // insert. `closeWalk` has already refused the crossings a farmer can actually walk, but the
      // column is `geometry(Polygon,4326)`: anything GEOS still calls invalid would arrive as a 500
      // from a type constraint, which tells the farmer nothing and is set aside by the outbox as an
      // unrecognised error rather than as the refusal it is.
      await assertStorablePolygon(tx, boundaryGeojsonOf(event));

      const stored = await insertEvent(tx, event);
      await reprojectBoundary(tx, input.farmId, input.landUnitId, userId);
      return stored;
    });
  }

  /**
   * The farm's camps and blocks (FR-150), tombstones excluded. The client needs these to move an
   * animal somewhere, to file a rain gauge against a camp, and to know which codes are taken before
   * it lets a farmer reuse one. Read through the RLS-bound connection, so another farm's ground is
   * not merely filtered out — it is invisible.
   */
  async listLandUnits(userId: string, farmId: string) {
    return this.app.asUser(userId, async (tx) => {
      await assertCanCapture(tx, userId, farmId);
      return listFarmLandUnits(tx, farmId);
    });
  }
}

/** The ring a built `boundary_walk` event carries. Narrowed here because the event's `payload` is a
 *  `Record<string, unknown>` by the time it leaves the domain builder, and the schema it was just
 *  validated against guarantees this key. */
function boundaryGeojsonOf(event: schemas.NewEvent): string {
  return String(event.payload['boundaryGeojson']);
}

/**
 * Re-derive a camp's canonical boundary from the whole walk log.
 *
 * ⭐ ORDERED BY THE TOTAL ORDER `(occurred_at, id)`, NEVER BY `occurred_at` ALONE. A walk is a
 * day-grained fact in practice, so two walks of one camp on one day tie on `occurred_at` BY
 * CONSTRUCTION, and a tie left to the query plan is a boundary that changes when the plan does. The
 * id is a client UUIDv7 — time-ordered, and identical on the device and here — which is why the same
 * cut can be run on both sides and cannot drift. This is the rule `mob-tally` and `mobMembership`
 * both had to be corrected to follow; it is applied here from the start rather than after a review.
 *
 * The subquery re-reads the log rather than using the row just inserted, which is what makes this
 * order-independent: a walk that HAPPENED first but ARRIVED last does not become the boundary.
 *
 * `boundary_geojson` is not written here. The `land_units_geojson` trigger derives it from the
 * geometry, so the mirror is PostGIS' own normalisation of the shape rather than the client's text —
 * which is what makes the two columns provably the same shape. Both, always.
 */
async function reprojectBoundary(
  tx: CaptureTx,
  farmId: string,
  landUnitId: string,
  userId: string,
): Promise<void> {
  await tx.execute(sql`
    update land_units set
      boundary = (
        select ST_SetSRID(ST_GeomFromGeoJSON(e.payload->>'boundaryGeojson'), 4326)
        from events e
        where e.farm_id = ${farmId}
          and e.land_unit_id = ${landUnitId}
          and e.type = 'boundary_walk'
          and e.deleted_at is null
        order by e.occurred_at desc, e.id desc
        limit 1
      ),
      updated_at = now(),
      updated_by = ${userId}
    where id = ${landUnitId} and farm_id = ${farmId}
  `);
}

/**
 * Refuse a ring PostGIS cannot store, with a message rather than a crash.
 *
 * `closeWalk` in `@werf/domain` already refuses the shapes a farmer can walk into — too few corners,
 * a fence that crosses itself, corners in a straight line — and it runs on the device, which is the
 * only place a refusal reaches someone who can still walk back to the corner. This is the boundary
 * behind it: GEOS is the authority on what the `geometry(Polygon,4326)` column will accept, and a
 * server-side check that merely repeated the client's is not a boundary at all.
 */
async function assertStorablePolygon(tx: CaptureTx, boundaryGeojson: string): Promise<void> {
  const result = await tx.execute<{ valid: boolean | null }>(sql`
    select ST_IsValid(ST_SetSRID(ST_GeomFromGeoJSON(${boundaryGeojson}), 4326)) as valid
  `);
  const rows = (Array.isArray(result) ? result : result.rows) as ReadonlyArray<{
    valid: boolean | null;
  }>;
  if (rows[0]?.valid !== true) {
    throw new ValidationError(
      'This fence line does not enclose a single piece of ground. Walk it again, marking each corner once.',
    );
  }
}

/** The farm's live land units, ordered by the farmer's own code. */
async function listFarmLandUnits(tx: CaptureTx, farmId: string) {
  return tx
    .select(landUnitProjection)
    .from(landUnits)
    .where(and(eq(landUnits.farmId, farmId), sql`${landUnits.deletedAt} is null`))
    .orderBy(landUnits.code);
}

/**
 * The canonical PostGIS geometry for a client-authored GeoJSON boundary, or null for a camp that has
 * not been walked yet — which is normal and must stay cheap, because a farmer standing at a gate
 * naming a camp should not be blocked on mapping it.
 *
 * The SRID is forced to 4326 rather than trusted from the payload: `ST_GeomFromGeoJSON` returns SRID
 * 0 for plain geometry objects, and a 0-SRID value in a `geometry(Polygon,4326)` column is rejected
 * by the type constraint — so this is what makes an ordinary GeoJSON polygon storable at all.
 */
function boundaryGeometry(boundaryGeojson: string | null) {
  if (boundaryGeojson === null) return null;
  assertPolygon(boundaryGeojson);
  return sql`ST_SetSRID(ST_GeomFromGeoJSON(${boundaryGeojson}), 4326)`;
}

/**
 * A boundary must be a Polygon, because the column is `geometry(Polygon,4326)`.
 *
 * Checked here rather than left to Postgres so the refusal is a typed 400 that names the problem,
 * not a 500 from a type constraint. The shared `geoJsonStringSchema` deliberately validates only
 * that the string is a JSON object with a `type` — the deep grammar is the mapping feature's job —
 * so the column's own requirement is enforced at the edge that has the column.
 */
function assertPolygon(boundaryGeojson: string): void {
  const type = (JSON.parse(boundaryGeojson) as { type?: unknown }).type;
  if (type !== 'Polygon') {
    throw new ValidationError(
      `A boundary must be a GeoJSON Polygon; received ${typeof type === 'string' ? type : 'no type'}`,
    );
  }
}

/** numeric(p,s) columns are strings in the driver; the wire contract is a number. */
function numericText(value: number | null): string | null {
  return value === null ? null : String(value);
}

/**
 * Turns the (farm_id, code) unique violation into a ConflictError a farmer can act on. Anything
 * else is rethrown untouched — swallowing an unexpected database error here would turn a real
 * failure into a silent success, and the flush would mark the capture sent when it was not.
 */
function rethrowDuplicateCode(code: string) {
  return (error: unknown): never => {
    if (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: unknown }).code === UNIQUE_VIOLATION &&
      String((error as { constraint?: unknown }).constraint ?? '').includes('farm_code')
    ) {
      throw new ConflictError(`This farm already has a ${code}. Give this one a different name.`);
    }
    throw error;
  };
}
