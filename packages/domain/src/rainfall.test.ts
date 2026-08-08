/**
 * Rainfall capture (FR-213), tested as a pure function on observable output: does a gauge reading
 * produce the right append-only `rainfall` event, is it scoped to the FARM rather than a herd, and
 * is a dry gauge kept as data instead of rejected? Asserted on what a farmer or an auditor would
 * see — never on implementation.
 */

import { describe, expect, it } from 'vitest';
import { ValidationError } from '@werf/core';
import { recordRainfall, type RainfallInput } from './rainfall';

const EVENT_ID = '01900000-0000-7000-8000-0000000000c1';
const FARM_ID = '01900000-0000-7000-8000-000000000f01';
const LAND_UNIT_ID = '01900000-0000-7000-8000-0000000000d1';
const USER_ID = '01900000-0000-7000-8000-000000000901';
/** Read off the gauge on the farm at first light; captured in a dead zone, synced days later. */
const OCCURRED = new Date('2026-03-02T04:10:00Z');

function input(overrides: Partial<RainfallInput> = {}): RainfallInput {
  return {
    id: EVENT_ID,
    farmId: FARM_ID,
    occurredAt: OCCURRED,
    mm: 18.5,
    createdBy: USER_ID,
    ...overrides,
  };
}

describe('recordRainfall (FR-213)', () => {
  it('builds a rainfall event holding the millimetres and when the gauge was read', () => {
    const event = recordRainfall(input());

    expect(event.type).toBe('rainfall');
    expect(event.payload).toEqual({ mm: 18.5 });
    expect(event.occurredAt).toBe(OCCURRED); // farm time, injected — not created_at
    expect(event.syncedAt).toBeNull(); // not sent yet
    expect(event.createdBy).toBe(USER_ID);
  });

  it('scopes the reading to the farm, never to a herd — both enterprises read the same rain', () => {
    const event = recordRainfall(input());

    // The FR-113 exception, asserted rather than trusted: a mixed farm's crop side must see the
    // rain its cattle side captured, and it cannot if the event is filed under an enterprise.
    expect(event.enterpriseId).toBeNull();
    expect(event.animalId).toBeNull();
    expect(event.mobId).toBeNull();
  });

  it('names the gauge when a farm reads more than one', () => {
    const event = recordRainfall(input({ gauge: 'Homestead' }));

    expect(event.payload).toEqual({ mm: 18.5, gauge: 'Homestead' });
  });

  it('pins the reading to the camp the gauge stands in, when the farm records it that way', () => {
    const event = recordRainfall(input({ landUnitId: LAND_UNIT_ID }));

    expect(event.landUnitId).toBe(LAND_UNIT_ID);
  });

  it('keeps a DRY gauge as a real reading (0 mm is data, not a missing capture)', () => {
    const event = recordRainfall(input({ mm: 0 }));

    // "I looked on Tuesday and it was empty" is the fact that separates a drought from a farmer
    // who forgot to look. A rest-period calculation that cannot tell those apart is worthless.
    expect(event.payload).toEqual({ mm: 0 });
  });

  it.each([
    ['negative millimetres', -1],
    ['not a finite number', Number.POSITIVE_INFINITY],
  ])('refuses a reading that is %s', (_case, mm) => {
    expect(() => recordRainfall(input({ mm }))).toThrow(ValidationError);
  });
});
