/**
 * `foldCampActivity` (FR-151, 4e·1), tested as a pure function on observable output: arrival and
 * departure timestamps derived from a move log, never on how the fold walks it.
 */

import { describe, expect, it } from 'vitest';
import { foldCampActivity, type CampMoveEvent } from './grazing';

const ANIMAL = 'animal:a1';
const MOB = 'mob:m1';
const CAMP_A = 'camp-a';
const CAMP_B = 'camp-b';

function event(
  overrides: Partial<CampMoveEvent> & Pick<CampMoveEvent, 'id' | 'occurredAt'>,
): CampMoveEvent {
  return { entityId: ANIMAL, ...overrides };
}

describe('foldCampActivity (FR-151)', () => {
  it('records an arrival the first time an entity is placed on a camp', () => {
    const { entityArrivedAt } = foldCampActivity([
      event({ id: '1', occurredAt: '2026-08-01T06:00:00Z', toLandUnitId: CAMP_A }),
    ]);
    expect(entityArrivedAt.get(ANIMAL)).toEqual({
      landUnitId: CAMP_A,
      arrivedAt: '2026-08-01T06:00:00Z',
    });
  });

  it('a walk from one camp to another records the departure AND the new arrival', () => {
    const { entityArrivedAt, landUnitLastDeparture } = foldCampActivity([
      event({ id: '1', occurredAt: '2026-08-01T06:00:00Z', toLandUnitId: CAMP_A }),
      event({ id: '2', occurredAt: '2026-08-05T06:00:00Z', toLandUnitId: CAMP_B }),
    ]);
    expect(entityArrivedAt.get(ANIMAL)).toEqual({
      landUnitId: CAMP_B,
      arrivedAt: '2026-08-05T06:00:00Z',
    });
    expect(landUnitLastDeparture.get(CAMP_A)).toBe('2026-08-05T06:00:00Z');
    expect(landUnitLastDeparture.has(CAMP_B)).toBe(false);
  });

  it('an omitted toLandUnitId (a move that only changed the mob) does not reset the arrival clock', () => {
    const { entityArrivedAt, landUnitLastDeparture } = foldCampActivity([
      event({ id: '1', occurredAt: '2026-08-01T06:00:00Z', toLandUnitId: CAMP_A }),
      event({ id: '2', occurredAt: '2026-08-10T06:00:00Z', toLandUnitId: undefined }),
    ]);
    expect(entityArrivedAt.get(ANIMAL)).toEqual({
      landUnitId: CAMP_A,
      arrivedAt: '2026-08-01T06:00:00Z',
    });
    expect(landUnitLastDeparture.size).toBe(0);
  });

  it('a hydrated move resolving toLandUnitId back to the SAME camp is not a departure either', () => {
    // `mapHydratedMove` always resolves `toLandUnitId`, even when the server's own event carried an
    // unchanged camp — the fold must treat "resolved to what I already hold" as a no-op regardless
    // of whether the event says so explicitly (hydrated) or by omission (local).
    const { landUnitLastDeparture } = foldCampActivity([
      event({ id: '1', occurredAt: '2026-08-01T06:00:00Z', toLandUnitId: CAMP_A }),
      event({ id: '2', occurredAt: '2026-08-10T06:00:00Z', toLandUnitId: CAMP_A }),
    ]);
    expect(landUnitLastDeparture.size).toBe(0);
  });

  it('unassigning an entity (toLandUnitId: null) departs the camp and drops the arrival', () => {
    const { entityArrivedAt, landUnitLastDeparture } = foldCampActivity([
      event({ id: '1', occurredAt: '2026-08-01T06:00:00Z', toLandUnitId: CAMP_A }),
      event({ id: '2', occurredAt: '2026-08-05T06:00:00Z', toLandUnitId: null }),
    ]);
    expect(entityArrivedAt.has(ANIMAL)).toBe(false);
    expect(landUnitLastDeparture.get(CAMP_A)).toBe('2026-08-05T06:00:00Z');
  });

  it('a reoccupy-then-vacate cycle overwrites the departure with the LATEST one', () => {
    const { landUnitLastDeparture } = foldCampActivity([
      event({ id: '1', occurredAt: '2026-06-01T06:00:00Z', toLandUnitId: CAMP_A }),
      event({ id: '2', occurredAt: '2026-06-10T06:00:00Z', toLandUnitId: CAMP_B }), // first vacate of A
      event({ id: '3', occurredAt: '2026-07-01T06:00:00Z', toLandUnitId: CAMP_A }), // reoccupy A
      event({ id: '4', occurredAt: '2026-07-20T06:00:00Z', toLandUnitId: CAMP_B }), // vacate A again
    ]);
    expect(landUnitLastDeparture.get(CAMP_A)).toBe('2026-07-20T06:00:00Z');
  });

  it('two entities in the same camp keep independent arrival dates — the caller decides which wins', () => {
    const { entityArrivedAt } = foldCampActivity([
      event({
        id: '1',
        occurredAt: '2026-08-01T06:00:00Z',
        entityId: ANIMAL,
        toLandUnitId: CAMP_A,
      }),
      event({ id: '2', occurredAt: '2026-08-05T06:00:00Z', entityId: MOB, toLandUnitId: CAMP_A }),
    ]);
    expect(entityArrivedAt.get(ANIMAL)?.arrivedAt).toBe('2026-08-01T06:00:00Z');
    expect(entityArrivedAt.get(MOB)?.arrivedAt).toBe('2026-08-05T06:00:00Z');
  });

  it('orders by (occurredAt, id) as a TOTAL order — same-instant captures resolve by id, not input order', () => {
    // Two moves stamped on the same day (the capture screen gives every move on a day one instant),
    // deliberately supplied out of id order — the fold must still land on the higher id's camp.
    const { entityArrivedAt } = foldCampActivity([
      event({ id: 'z-second', occurredAt: '2026-08-01T00:00:00Z', toLandUnitId: CAMP_B }),
      event({ id: 'a-first', occurredAt: '2026-08-01T00:00:00Z', toLandUnitId: CAMP_A }),
    ]);
    expect(entityArrivedAt.get(ANIMAL)).toEqual({
      landUnitId: CAMP_B,
      arrivedAt: '2026-08-01T00:00:00Z',
    });
  });

  it('an empty log produces empty maps', () => {
    const { entityArrivedAt, landUnitLastDeparture } = foldCampActivity([]);
    expect(entityArrivedAt.size).toBe(0);
    expect(landUnitLastDeparture.size).toBe(0);
  });
});
