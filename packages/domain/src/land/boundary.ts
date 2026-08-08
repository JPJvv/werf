/**
 * Walking a camp boundary (FR-150, § 4 B7): turning a sequence of GPS fixes taken on foot along a
 * fence into a closed GeoJSON ring, and recording it as an append-only `boundary_walk` event.
 *
 * The gap this closes: the land API has accepted a GeoJSON polygon and dual-written it to PostGIS
 * since the land slice, and nothing in the product has ever produced one — a boundary could only be
 * TYPED, which nobody does. This is the producer.
 *
 * ⭐ GPS is the one capability that genuinely works with no signal: a receiver, not a connection.
 * That is what makes walking a fence in a dead zone a promise the app can keep, and it is why every
 * decision below is made on the device rather than deferred to the server. A refusal that only the
 * server can compute arrives after the farmer has walked home.
 *
 * This module is pure (.claude/rules/domain.md): no I/O, no clock. The event id and `occurredAt` are
 * injected at the boundary, exactly as they are for rainfall.
 *
 * ⭐ A BOUNDARY IS AN ABSOLUTE THAT RESETS, NOT A DELTA THAT COMPOSES. It is the same shape as a
 * recount and for the same reason: "I walked this fence and it goes here" supersedes whatever the
 * record held, and it cannot be expressed as a change to a previous shape because the device does
 * not know the previous shape is wrong until it has the new one. So the log holds every walk and the
 * CURRENT boundary is the latest walk by the total order `(occurredAt, id)` — re-derived, never
 * stepped on arrival, so two phones walking the same camp in a dead zone cannot land on whichever
 * one reconnected last.
 */

import { schemas, ValidationError } from '@werf/core';

/**
 * One GPS fix taken on the walk: where the phone was, and how well it knew.
 *
 * `accuracyM` is carried rather than discarded because it is the only honest measure of how much
 * this shape can be trusted. A fix taken under a thorn tree at 40 m is a boundary that is wrong by
 * 40 m in every direction, and a document showing the shape without it over-claims.
 */
export interface WalkFix {
  /** Degrees east. GeoJSON order is [lon, lat] — the opposite of how everyone says it out loud. */
  readonly lon: number;
  /** Degrees north. */
  readonly lat: number;
  /** The radius the phone reports around this fix, in metres. */
  readonly accuracyM: number;
}

/** Why a walk cannot become a boundary. Each is a different sentence to the farmer, so they are
 *  not collapsed into one "invalid". */
export type RingRefusal =
  /** Fewer than three corners — a line is not a piece of ground. */
  | 'too_few_corners'
  /** The fence crosses itself: a figure of eight, not a camp. */
  | 'self_intersecting'
  /** Three or more corners that enclose nothing — every fix on one line, or all in one spot. */
  | 'no_area';

export type RingResult =
  | {
      readonly ok: true;
      /** The closed ring as GeoJSON Polygon text — what crosses the wire, never PostGIS. */
      readonly boundaryGeojson: string;
      /** The area the ring encloses, in hectares, as measured on the device. */
      readonly areaHectares: number;
    }
  | { readonly ok: false; readonly reason: RingRefusal };

/** A ring needs three corners before it encloses anything. */
export const MIN_WALK_CORNERS = 3;

/**
 * Coordinates are rounded to this many decimals before anything is computed from them.
 *
 * Seven decimals is about 11 mm at this latitude — two orders of magnitude finer than the best fix a
 * phone will ever report, so nothing real is lost, and it keeps the stored ring compact and
 * deterministic. Rounding happens FIRST, so the area shown to the farmer is the area of the ring
 * that was actually stored rather than of a fuller-precision one that no longer exists.
 */
export const COORDINATE_DECIMALS = 7;

/**
 * Mean Earth radius in metres (IUGG). A physical constant, not a regulated figure — it is not
 * something a Gazette can change, so it does not belong in `regulatory_rates`.
 */
const EARTH_RADIUS_M = 6_371_008.8;

const SQUARE_METRES_PER_HECTARE = 10_000;

/**
 * The floor below which a ring is treated as enclosing nothing: 1e-6 ha, which is 0.01 m².
 *
 * ⭐ This is a NOISE FLOOR, not a minimum camp size, and the distinction matters. Three fixes on one
 * line do not sum to exactly zero in floating point — measured at 1.1e-10 ha for three corners along
 * a line of latitude — so an `=== 0` test lets a straight line through as a boundary. A floor sits
 * four orders of magnitude above that noise and eleven below the smallest thing anyone could walk
 * around, which is what makes it safe: no real piece of ground is refused by it, because a GPS
 * cannot resolve 0.01 m² and neither can a person with a phone.
 */
const AREA_NOISE_FLOOR_HECTARES = 1e-6;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

const round = (value: number): number => {
  const factor = 10 ** COORDINATE_DECIMALS;
  return Math.round(value * factor) / factor;
};

/** The fixes as they will be stored: rounded, in walk order, nothing dropped. */
function normalise(fixes: readonly WalkFix[]): readonly WalkFix[] {
  return fixes.map((fix) => ({
    lon: round(fix.lon),
    lat: round(fix.lat),
    accuracyM: fix.accuracyM,
  }));
}

/**
 * The area a ring encloses, in hectares, by spherical excess — the standard sum used for polygons on
 * a sphere. Planar arithmetic on degrees would be wrong by the cosine of the latitude: treating a
 * degree of longitude as a degree of latitude OVER-reads every east–west measurement by 1/cos(φ),
 * which at −29° is about 14% — enough to matter on a grazing figure. (This comment said "a 13%
 * under-read" and had the direction backwards as well as the number; `phase-checklists.md` said 14%
 * over-read, and it was the one that was right.)
 *
 * Returns 0 for anything that encloses nothing, including fewer than three corners, so a screen can
 * call it on every tap without guarding first.
 *
 * Known limitation, stated rather than hidden: this is wrong for a ring that crosses the
 * antimeridian. No farm does, and pretending to handle it would add a branch nothing can test.
 */
export function walkAreaHectares(fixes: readonly WalkFix[]): number {
  const ring = normalise(fixes);
  if (ring.length < MIN_WALK_CORNERS) return 0;

  let total = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    total +=
      (toRadians(b.lon) - toRadians(a.lon)) *
      (2 + Math.sin(toRadians(a.lat)) + Math.sin(toRadians(b.lat)));
  }

  const squareMetres = Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
  return squareMetres / SQUARE_METRES_PER_HECTARE;
}

/** The worst fix in the walk, in metres — how far out the whole shape could be. 0 for no fixes. */
export function worstAccuracyM(fixes: readonly WalkFix[]): number {
  return fixes.reduce((worst, fix) => Math.max(worst, fix.accuracyM), 0);
}

/**
 * Whether the closed ring crosses itself.
 *
 * ⭐ Checked on the DEVICE, while the farmer is still standing at the fence. PostGIS would refuse
 * the same shape days later with a message about geometry validity, by which time nobody can
 * remember which corner was wrong — and the walk cannot be repeated from a kitchen table.
 *
 * Segments are compared as planar lon/lat. Over a camp — kilometres, not hundreds — the curvature
 * error is far below the metres of GPS noise the corners already carry, and a crossing that this
 * misses at that scale is one no farmer could have walked.
 */
export function ringSelfIntersects(fixes: readonly WalkFix[]): boolean {
  const ring = normalise(fixes);
  if (ring.length < MIN_WALK_CORNERS) return false;

  const count = ring.length;
  for (let i = 0; i < count; i += 1) {
    for (let j = i + 1; j < count; j += 1) {
      // Adjacent segments share a corner by construction; so do the first and the last, because the
      // ring closes. Neither is a crossing.
      const adjacent = j === i + 1 || (i === 0 && j === count - 1);
      if (adjacent) continue;
      if (segmentsCross(ring[i]!, ring[(i + 1) % count]!, ring[j]!, ring[(j + 1) % count]!)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Close a walk into a boundary, or say why it cannot be one.
 *
 * The ring is wound COUNTER-CLOCKWISE, which RFC 7946 § 3.1.6 requires of an exterior ring. PostGIS
 * accepts either winding, so this changes nothing about what we store — but the GeoJSON we emit is a
 * document other tools read, and one that quietly breaks the spec is a bug waiting for a consumer we
 * have not met yet.
 *
 * ⭐ The ring is closed BY THE APP — the first corner is repeated as the last. Asking a farmer to
 * walk back to the exact starting fix and tap again would make the shape depend on how well they
 * remembered where they began, and GPS noise guarantees the two fixes differ by metres anyway.
 */
export function closeWalk(fixes: readonly WalkFix[]): RingResult {
  const ring = normalise(fixes);
  if (ring.length < MIN_WALK_CORNERS) return { ok: false, reason: 'too_few_corners' };
  if (ringSelfIntersects(ring)) return { ok: false, reason: 'self_intersecting' };

  const areaHectares = walkAreaHectares(ring);
  // Collinear fixes, or a phone that never moved. Three corners is necessary and not sufficient —
  // and the comparison is against a noise floor rather than zero, because collinear fixes sum to
  // float dust rather than to nothing.
  if (areaHectares < AREA_NOISE_FLOOR_HECTARES) return { ok: false, reason: 'no_area' };

  const wound = signedPlanarArea(ring) < 0 ? [...ring].reverse() : ring;
  const coordinates = [...wound.map((fix) => [fix.lon, fix.lat]), [wound[0]!.lon, wound[0]!.lat]];

  return {
    ok: true,
    boundaryGeojson: JSON.stringify({ type: 'Polygon', coordinates: [coordinates] }),
    areaHectares,
  };
}

/** A boundary walk, ready to become an event. */
export interface BoundaryWalkInput {
  /** Client-generated UUIDv7 for the event row (injected — a v7 embeds a clock this package can't read). */
  readonly id: string;
  readonly farmId: string;
  /** The camp or block whose fence was walked. Not optional: a shape with no ground is nothing. */
  readonly landUnitId: string;
  /** When the fence was WALKED (injected), which is not when this reaches a server. */
  readonly occurredAt: Date;
  /** The fixes taken along the fence, in walk order. */
  readonly corners: readonly WalkFix[];
  readonly notes?: string | null;
  readonly createdBy?: string | null;
}

/**
 * Build a `boundary_walk` event from a completed walk.
 *
 * The ring is closed HERE rather than taken from the caller, so the polygon that reaches the log is
 * provably the one these corners make. A client that sent a shape and a corner list that disagreed
 * would be storing evidence for a boundary it does not describe — and the corners are the evidence:
 * they are what makes the accuracy of the shape answerable later instead of a matter of trust.
 *
 * ⭐ The measured area is stored alongside the ring, and it is not a duplicate of what PostGIS will
 * compute. It is the number the farmer was looking at when they decided the walk was finished — the
 * same division of labour as ADR-0005's withdrawal preview: the device shows what it can work out
 * standing there, the server owns the canonical value, and the two are recorded as the different
 * facts they are.
 */
export function recordBoundaryWalk(input: BoundaryWalkInput): schemas.NewEvent {
  const closed = closeWalk(input.corners);
  if (!closed.ok) throw new ValidationError(refusalMessage(closed.reason));

  const payload = {
    boundaryGeojson: closed.boundaryGeojson,
    corners: normalise(input.corners),
    areaHectares: closed.areaHectares,
  };
  if (!schemas.boundaryWalkPayloadSchema.safeParse(payload).success) {
    throw new ValidationError('A boundary walk must carry the fixes the ring was built from');
  }

  return {
    id: input.id,
    farmId: input.farmId,
    type: 'boundary_walk',
    occurredAt: input.occurredAt,
    payload,
    // A camp is ground, not a herd. The same camp carries cattle this winter and sheep next, so
    // filing its shape under one enterprise would hide it from the other — which is the documented
    // FR-113 exception rainfall already stands on. `boundary_walk` is named in
    // FARM_SCOPED_EVENT_TYPES for exactly this reason.
    enterpriseId: null,
    animalId: null,
    mobId: null,
    syncedAt: null,
    landUnitId: input.landUnitId,
    employeeId: null,
    batchId: null,
    // The walk IS the location; a single point would be a worse copy of the ring.
    locationGeojson: null,
    notes: input.notes ?? null,
    createdBy: input.createdBy ?? null,
  };
}

/** What happened, why, and what to do about it — never "Validation error". */
function refusalMessage(reason: RingRefusal): string {
  switch (reason) {
    case 'too_few_corners':
      return `A boundary needs at least ${MIN_WALK_CORNERS} corners; walk to another corner and mark it`;
    case 'self_intersecting':
      return 'This fence line crosses itself. Drop the last corner and mark it again';
    case 'no_area':
      return 'These corners are in a straight line and enclose no ground';
  }
}

/**
 * Twice the signed area of the ring on the lon/lat plane. Sign only — positive is counter-clockwise.
 * Deliberately NOT the area function above: the spherical one takes an absolute value, because area
 * is a magnitude, and winding is the one question that needs the sign kept.
 */
function signedPlanarArea(ring: readonly WalkFix[]): number {
  let total = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    total += a.lon * b.lat - b.lon * a.lat;
  }
  return total / 2;
}

/** Which side of the line ab the point c falls on: >0 left, <0 right, 0 collinear. */
function cross(a: WalkFix, b: WalkFix, c: WalkFix): number {
  return (b.lon - a.lon) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lon - a.lon);
}

/** Whether c lies within the bounding box of the segment ab (used only when the three are collinear). */
function within(a: WalkFix, b: WalkFix, c: WalkFix): boolean {
  return (
    Math.min(a.lon, b.lon) <= c.lon &&
    c.lon <= Math.max(a.lon, b.lon) &&
    Math.min(a.lat, b.lat) <= c.lat &&
    c.lat <= Math.max(a.lat, b.lat)
  );
}

/**
 * How near zero a cross product has to be before three fixes count as being on ONE LINE.
 *
 * ⭐ The same lesson as `AREA_NOISE_FLOOR_HECTARES`, in the other predicate of this module, and it
 * had to be learned twice. `=== 0` looks exact and is not: a point genuinely ON a diagonal produces
 * ~2e-17 rather than 0, because the two products cancel to the last bits instead of to nothing. It
 * DOES come out exactly 0 when the segment runs along a line of latitude or longitude, or when its
 * rise equals its run — which is precisely the geometry a test writer reaches for, so the branch
 * looked covered while it never fired for a real fence.
 *
 * The floor sits five orders above that noise and five below the smallest real signal: a fence
 * deviating by one metre (~1e-5°) over a 3 km segment (~0.03°) gives ~3e-7. So nothing a person
 * could walk is called collinear by it, and a fence doubled back along itself no longer slips past
 * the on-device check into a refusal that arrives days later from PostGIS.
 */
const COLLINEAR_EPSILON = 1e-12;

/**
 * Which side of a line a fix falls on: -1, +1, or 0 for "on it".
 *
 * ⛔ The floor is applied HERE rather than only to the collinear branch, and that is the half of
 * this that is easy to miss. Raw `> 0` / `< 0` comparisons read float dust as a real answer: three
 * fixes on one line produce cross products of ~±2e-17 whose SIGNS are essentially random, so the
 * strict-opposition test could report a proper crossing on a fence that never crossed anything —
 * refusing a boundary a farmer had just walked correctly. Collapsing the dust to 0 fixes the false
 * refusal and the missed doubling-back with one rule, which is the honest shape: both were the same
 * mistake, that an exact comparison on a computed float means what it says.
 */
const sideOf = (value: number): number =>
  Math.abs(value) < COLLINEAR_EPSILON ? 0 : value > 0 ? 1 : -1;

/** Whether segments ab and cd cross, touching included — a fence that grazes another is still crossed. */
function segmentsCross(a: WalkFix, b: WalkFix, c: WalkFix, d: WalkFix): boolean {
  const d1 = sideOf(cross(a, b, c));
  const d2 = sideOf(cross(a, b, d));
  const d3 = sideOf(cross(c, d, a));
  const d4 = sideOf(cross(c, d, b));

  // A proper crossing: each segment has the other's endpoints strictly on opposite sides.
  if (d1 * d2 < 0 && d3 * d4 < 0) return true;
  // Collinear overlap: a segment doubling back along one already walked.
  if (d1 === 0 && within(a, b, c)) return true;
  if (d2 === 0 && within(a, b, d)) return true;
  if (d3 === 0 && within(c, d, a)) return true;
  if (d4 === 0 && within(c, d, b)) return true;
  return false;
}
