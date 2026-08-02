/**
 * Walking a camp boundary (FR-150), tested on what a farmer would observe: does the shape they
 * walked come back as the ground they walked around, does the app refuse the walks that are not a
 * piece of ground, and is the area the one that is actually enclosed rather than a number that
 * happens to look plausible?
 *
 * ⭐ The area assertions are the sharp ones, and they are written to FAIL against the obvious wrong
 * implementation rather than merely to pass against the right one. Treating degrees as a flat grid —
 * the thing anyone writes first — over-reads an east–west distance at this latitude by 1/cos(29°),
 * about 14%, which on a grazing figure is the difference between a camp that carries the herd and
 * one that is overgrazed by a quarter. The bands below exclude that answer.
 */

import { describe, expect, it } from 'vitest';
import { ValidationError, isFarmScopedEventType, schemas } from '@werf/core';
import {
  MIN_WALK_CORNERS,
  closeWalk,
  recordBoundaryWalk,
  ringSelfIntersects,
  walkAreaHectares,
  worstAccuracyM,
  type BoundaryWalkInput,
  type WalkFix,
} from './boundary';

const EVENT_ID = '01900000-0000-7000-8000-0000000000e1';
const FARM_ID = '01900000-0000-7000-8000-000000000f01';
const LAND_UNIT_ID = '01900000-0000-7000-8000-0000000000d1';
const USER_ID = '01900000-0000-7000-8000-000000000901';
/** Walked at first light; captured in a dead zone and synced days later. */
const OCCURRED = new Date('2026-03-02T04:10:00Z');

/** A fix with a good open-veld accuracy, so accuracy is not what any geometry test is about. */
const at = (lon: number, lat: number, accuracyM = 4): WalkFix => ({ lon, lat, accuracyM });

/**
 * A 0.01° box in the Free State — about 1112 m north–south and 973 m east–west at −29°, so roughly
 * 108 ha. Walked anticlockwise.
 */
const FREE_STATE_BOX: readonly WalkFix[] = [
  at(26.2, -29.0),
  at(26.21, -29.0),
  at(26.21, -28.99),
  at(26.2, -28.99),
];

/** The same 0.01° box of DEGREES, on the equator. Wider on the ground, because lines of longitude
 *  are furthest apart there — which is the whole reason a flat-grid area is wrong. */
const EQUATOR_BOX: readonly WalkFix[] = [
  at(26.2, 0),
  at(26.21, 0),
  at(26.21, 0.01),
  at(26.2, 0.01),
];

function input(overrides: Partial<BoundaryWalkInput> = {}): BoundaryWalkInput {
  return {
    id: EVENT_ID,
    farmId: FARM_ID,
    landUnitId: LAND_UNIT_ID,
    occurredAt: OCCURRED,
    corners: FREE_STATE_BOX,
    createdBy: USER_ID,
    ...overrides,
  };
}

/** The ring out of a successful close, parsed back — the shape as it will be stored. */
function ringOf(fixes: readonly WalkFix[]): number[][] {
  const closed = closeWalk(fixes);
  if (!closed.ok) throw new Error(`expected a ring, got ${closed.reason}`);
  return (JSON.parse(closed.boundaryGeojson) as { coordinates: number[][][] }).coordinates[0]!;
}

describe('walkAreaHectares (FR-150)', () => {
  it('measures the ground a walked box encloses, not the degrees it spans', () => {
    // 1112 m × 973 m ≈ 108.2 ha. A flat-degree implementation answers ≈123.6 ha and fails here,
    // which is the point of the band rather than a loose tolerance.
    expect(walkAreaHectares(FREE_STATE_BOX)).toBeGreaterThan(107);
    expect(walkAreaHectares(FREE_STATE_BOX)).toBeLessThan(109);
  });

  it('gives the SAME degrees more ground at the equator than in the Free State', () => {
    // The single assertion no flat-grid implementation can pass: it would call these two identical.
    expect(walkAreaHectares(EQUATOR_BOX)).toBeGreaterThan(walkAreaHectares(FREE_STATE_BOX));
  });

  it('does not care which way round the fence was walked', () => {
    const clockwise = [...FREE_STATE_BOX].reverse();

    expect(walkAreaHectares(clockwise)).toBeCloseTo(walkAreaHectares(FREE_STATE_BOX), 6);
  });

  it('is zero for a walk too short to enclose anything, so a screen can ask on every tap', () => {
    expect(walkAreaHectares([])).toBe(0);
    expect(walkAreaHectares([at(26.2, -29.0), at(26.21, -29.0)])).toBe(0);
  });
});

describe('closeWalk (FR-150)', () => {
  it('closes the ring itself rather than asking the farmer to walk back onto their first fix', () => {
    const ring = ringOf(FREE_STATE_BOX);

    // Four corners walked, five coordinates stored: the first repeated as the last.
    expect(ring).toHaveLength(FREE_STATE_BOX.length + 1);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it('stores coordinates as [longitude, latitude] — the order that puts the camp in the Free State', () => {
    const ring = ringOf(FREE_STATE_BOX);

    // Reversed, this camp is in Somalia. Asserted because it is the mistake, not because it is hard.
    expect(ring[0]).toEqual([26.2, -29.0]);
  });

  it('winds the ring counter-clockwise however the fence was walked (RFC 7946 § 3.1.6)', () => {
    const walkedClockwise = [...FREE_STATE_BOX].reverse();

    // Walked either way round, the STORED ring is counter-clockwise — so a consumer that trusts the
    // spec's winding reads the same exterior ring whichever direction the farmer set off in.
    expect(signedArea(ringOf(walkedClockwise))).toBeGreaterThan(0);
    expect(signedArea(ringOf(FREE_STATE_BOX))).toBeGreaterThan(0);
  });

  it('rounds coordinates to the millimetre, well below anything a phone can actually report', () => {
    const noisy = [
      at(26.20000004999, -29.0),
      at(26.2100000123456, -29.0),
      at(26.21, -28.99),
      at(26.2, -28.99),
    ];

    expect(ringOf(noisy)[0]).toEqual([26.2, -29.0]);
    expect(ringOf(noisy)[1]).toEqual([26.21, -29.0]);
  });

  it.each([
    ['nothing walked at all', [] as readonly WalkFix[], 'too_few_corners'],
    ['one corner', [at(26.2, -29.0)], 'too_few_corners'],
    ['a fence line, not a camp', [at(26.2, -29.0), at(26.21, -29.0)], 'too_few_corners'],
    [
      'three corners in a straight line',
      [at(26.2, -29.0), at(26.21, -29.0), at(26.22, -29.0)],
      'no_area',
    ],
    ['a phone that never moved', [at(26.2, -29.0), at(26.2, -29.0), at(26.2, -29.0)], 'no_area'],
    [
      'a figure of eight',
      [at(26.2, -29.0), at(26.21, -28.99), at(26.21, -29.0), at(26.2, -28.99)],
      'self_intersecting',
    ],
  ])('refuses %s', (_case, corners, reason) => {
    const closed = closeWalk(corners);

    expect(closed.ok).toBe(false);
    if (!closed.ok) expect(closed.reason).toBe(reason);
  });

  it(`needs ${MIN_WALK_CORNERS} corners and says so, rather than failing at PostGIS days later`, () => {
    const closed = closeWalk([at(26.2, -29.0), at(26.21, -29.0)]);

    expect(closed.ok).toBe(false);
  });
});

describe('ringSelfIntersects (FR-150)', () => {
  it('is false for an ordinary camp, however many corners it has', () => {
    const sixCorners = [
      at(26.2, -29.0),
      at(26.21, -29.0),
      at(26.215, -28.995),
      at(26.21, -28.99),
      at(26.2, -28.99),
      at(26.195, -28.995),
    ];

    expect(ringSelfIntersects(sixCorners)).toBe(false);
  });

  it('catches a crossing the CLOSING segment makes, which is the one nobody sees coming', () => {
    // Every walked segment is fine; the leg back from the last corner to the first is what crosses.
    const corners = [at(26.2, -29.0), at(26.21, -29.0), at(26.2, -28.99), at(26.21, -28.99)];

    expect(ringSelfIntersects(corners)).toBe(true);
  });

  it('says nothing about a walk that is not yet a ring, so a screen can ask while walking', () => {
    expect(ringSelfIntersects([at(26.2, -29.0), at(26.21, -29.0)])).toBe(false);
  });
});

describe('worstAccuracyM (FR-150)', () => {
  it('reports the worst fix in the walk — one bad corner is a bad boundary', () => {
    const corners = [at(26.2, -29.0, 4), at(26.21, -29.0, 41), at(26.21, -28.99, 6)];

    expect(worstAccuracyM(corners)).toBe(41);
  });

  it('is zero when nothing has been walked', () => {
    expect(worstAccuracyM([])).toBe(0);
  });
});

describe('recordBoundaryWalk (FR-150)', () => {
  it('builds a boundary_walk event carrying the ring, the corners behind it, and the area', () => {
    const event = recordBoundaryWalk(input());

    expect(event.type).toBe('boundary_walk');
    expect(event.landUnitId).toBe(LAND_UNIT_ID);
    expect(event.occurredAt).toBe(OCCURRED); // when the fence was WALKED, not when it was written
    expect(event.syncedAt).toBeNull();
    expect(event.createdBy).toBe(USER_ID);

    const payload = event.payload as {
      boundaryGeojson: string;
      corners: unknown[];
      areaHectares: number;
    };
    expect(JSON.parse(payload.boundaryGeojson)).toMatchObject({ type: 'Polygon' });
    expect(payload.corners).toHaveLength(FREE_STATE_BOX.length);
    expect(payload.areaHectares).toBeGreaterThan(107);
  });

  it('keeps the fix accuracy of every corner — a shape without it over-claims', () => {
    // The evidence half of the payload. A boundary walked at 40 m under trees and one walked at 4 m
    // in the open are the same polygon and are not the same claim, and only this tells them apart.
    const underTrees = FREE_STATE_BOX.map((fix, i) => ({ ...fix, accuracyM: i === 1 ? 38 : 4 }));

    const event = recordBoundaryWalk(input({ corners: underTrees }));
    const { corners } = event.payload as { corners: readonly WalkFix[] };

    expect(corners.map((c) => c.accuracyM)).toEqual([4, 38, 4, 4]);
  });

  it('scopes the walk to the CAMP and to no herd — the same camp carries cattle and then sheep', () => {
    const event = recordBoundaryWalk(input());

    expect(event.animalId).toBeNull();
    expect(event.mobId).toBeNull();
    expect(event.enterpriseId).toBeNull();
    // And the FR-113 escape is real rather than assumed: without this the event above cannot enter
    // the log at all, because `insertEvent` refuses anything that names no herd.
    expect(isFarmScopedEventType('boundary_walk')).toBe(true);
  });

  it('validates the payload against the schema the wire and the database share', () => {
    const event = recordBoundaryWalk(input());

    // The PAYLOAD schema, not `newEventSchema`: `timestampSchema` parses a string INTO a Date, so
    // the envelope schema describes what arrives on the wire and not what a builder returns. Feeding
    // a built event back through it would assert the wrong thing and fail for the wrong reason —
    // the same `ResidueFlagJson` / `ResidueFlag` distinction the residue register had to make.
    expect(schemas.boundaryWalkPayloadSchema.safeParse(event.payload).success).toBe(true);
  });

  it('refuses a walk whose corners enclose only floating-point dust', () => {
    // Three fixes along one line sum to ~1e-10 ha rather than to zero. An `=== 0` test would call
    // that a boundary, and a straight fence line would be stored as a piece of ground.
    const alongOneFence = [at(26.2, -29.0), at(26.21, -29.0), at(26.22, -29.0)];

    expect(walkAreaHectares(alongOneFence)).toBeGreaterThan(0);
    expect(closeWalk(alongOneFence).ok).toBe(false);
  });

  it.each([
    [
      'a fence that crosses itself',
      [at(26.2, -29.0), at(26.21, -28.99), at(26.21, -29.0), at(26.2, -28.99)],
    ],
    ['corners in a straight line', [at(26.2, -29.0), at(26.21, -29.0), at(26.22, -29.0)]],
    ['too few corners', [at(26.2, -29.0), at(26.21, -29.0)]],
  ])('refuses %s with a typed error, not a string', (_case, corners) => {
    expect(() => recordBoundaryWalk(input({ corners }))).toThrow(ValidationError);
  });

  it('tells the farmer what to do next, never "Validation error"', () => {
    const crossing = [at(26.2, -29.0), at(26.21, -28.99), at(26.21, -29.0), at(26.2, -28.99)];

    // The next question ("so what do I do?") answered before it is asked — .claude/rules/frontend.md.
    expect(() => recordBoundaryWalk(input({ corners: crossing }))).toThrow(/drop the last corner/i);
  });
});

/** Twice the signed area on the lon/lat plane. Positive is counter-clockwise. Local to the test so
 *  the winding assertion is not proved with the same expression it is checking. */
function signedArea(ring: readonly number[][]): number {
  let total = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [ax, ay] = ring[i] as [number, number];
    const [bx, by] = ring[i + 1] as [number, number];
    total += ax * by - bx * ay;
  }
  return total;
}
