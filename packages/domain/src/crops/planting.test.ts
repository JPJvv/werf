/**
 * Recording a planting (FR-203), tested as a pure function on observable output: does a capture
 * produce the right append-only `planting` event, is it scoped to the BLOCK rather than a herd, and
 * does the optional detail survive intact? Asserted on what a farmer or an auditor would see — never
 * on implementation.
 */

import { describe, expect, it } from 'vitest';
import { ValidationError, isFarmScopedEventType, schemas } from '@werf/core';
import {
  currentPlantingFor,
  recordPlanting,
  type PlantingFact,
  type PlantingInput,
} from './planting';

const EVENT_ID = '01900000-0000-7000-8000-0000000000e1';
const FARM_ID = '01900000-0000-7000-8000-000000000f01';
const LAND_UNIT_ID = '01900000-0000-7000-8000-0000000000d1';
const USER_ID = '01900000-0000-7000-8000-000000000901';
/** Planted at first light; captured that evening, days before the next reconnect. */
const OCCURRED = new Date('2026-09-14T04:30:00Z');

function input(overrides: Partial<PlantingInput> = {}): PlantingInput {
  return {
    id: EVENT_ID,
    farmId: FARM_ID,
    landUnitId: LAND_UNIT_ID,
    occurredAt: OCCURRED,
    crop: 'Maize',
    createdBy: USER_ID,
    ...overrides,
  };
}

describe('recordPlanting (FR-203)', () => {
  it('builds a planting event holding the crop and when it went in the ground', () => {
    const event = recordPlanting(input());

    expect(event.type).toBe('planting');
    expect(event.payload).toEqual({ crop: 'Maize' });
    // The planted date IS occurredAt — there is no separate field for it.
    expect(event.occurredAt).toBe(OCCURRED);
    expect(event.landUnitId).toBe(LAND_UNIT_ID);
    expect(event.syncedAt).toBeNull();
    expect(event.createdBy).toBe(USER_ID);
  });

  it('scopes the planting to the block, never to a herd — the FR-113 exception', () => {
    const event = recordPlanting(input());

    expect(event.enterpriseId).toBeNull();
    expect(event.animalId).toBeNull();
    expect(event.mobId).toBeNull();
    // The escape is real rather than assumed: without this, `insertEvent` would refuse the event
    // outright for naming no herd, because a mixed farm's blocks are not filed under one.
    expect(isFarmScopedEventType('planting')).toBe(true);
  });

  it('carries the optional detail through untouched when it is given', () => {
    const event = recordPlanting(
      input({
        cultivar: 'PAN 6479',
        density: { value: 32_000, unit: 'plants/ha' },
        seedSource: 'Klein Karoo Seed',
        expectedHarvestDate: '2027-04-15',
      }),
    );

    expect(event.payload).toEqual({
      crop: 'Maize',
      cultivar: 'PAN 6479',
      density: { value: 32_000, unit: 'plants/ha' },
      seedSource: 'Klein Karoo Seed',
      expectedHarvestDate: '2027-04-15',
    });
  });

  it('omits detail that was not given, rather than writing it as null', () => {
    const event = recordPlanting(input());

    expect(Object.keys(event.payload)).toEqual(['crop']);
  });

  it('validates the payload against the schema the wire and the database share', () => {
    const event = recordPlanting(input({ cultivar: 'PAN 6479' }));

    const parsed = schemas.plantingPayloadSchema.safeParse(event.payload);
    expect(parsed.success).toBe(true);
  });

  it('refuses a blank crop', () => {
    expect(() => recordPlanting(input({ crop: '' }))).toThrow(ValidationError);
  });

  it.each([
    ['a non-positive density value', { value: 0, unit: 'plants/ha' }],
    ['a density with no unit', { value: 32_000, unit: '' }],
  ])('refuses %s', (_case, density) => {
    expect(() => recordPlanting(input({ density }))).toThrow(ValidationError);
  });

  it('refuses an expected harvest date that is not a calendar date', () => {
    expect(() => recordPlanting(input({ expectedHarvestDate: '15 April 2027' }))).toThrow(
      ValidationError,
    );
  });
});

describe('currentPlantingFor', () => {
  function planting(overrides: Partial<PlantingFact> & { id: string }): PlantingFact {
    return { landUnitId: LAND_UNIT_ID, occurredAt: '2026-08-01T00:00:00Z', ...overrides };
  }

  it('is undefined when the block has never been planted', () => {
    expect(currentPlantingFor([], [LAND_UNIT_ID])).toBeUndefined();
  });

  it('picks the latest planting by occurredAt when there is more than one', () => {
    const earlier = planting({ id: 'p1', occurredAt: '2026-08-01T00:00:00Z' });
    const later = planting({ id: 'p2', occurredAt: '2026-09-01T00:00:00Z' });
    expect(currentPlantingFor([earlier, later], [LAND_UNIT_ID])).toEqual(later);
  });

  it('breaks a same-instant tie by id — the total order, not array order', () => {
    // Day-grained captures stamp every event on a day with the same instant; array order must not
    // decide the winner, or two devices folding the identical log could disagree.
    const a = planting({ id: 'p-aaaa', occurredAt: '2026-08-01T00:00:00Z' });
    const b = planting({ id: 'p-bbbb', occurredAt: '2026-08-01T00:00:00Z' });
    expect(currentPlantingFor([a, b], [LAND_UNIT_ID])).toEqual(b);
    expect(currentPlantingFor([b, a], [LAND_UNIT_ID])).toEqual(b);
  });

  it('ignores a planting on an unrelated block', () => {
    const other = planting({ id: 'p1', landUnitId: 'other-block' });
    expect(currentPlantingFor([other], [LAND_UNIT_ID])).toBeUndefined();
  });

  it('FR-202: a later ancestor id in the chain can still win — the caller decides the chain, this only folds it', () => {
    const parent = planting({
      id: 'p1',
      landUnitId: 'parent',
      occurredAt: '2026-01-01T00:00:00Z',
      expectedHarvestDate: '2026-06-01',
    });
    const child = planting({
      id: 'p2',
      landUnitId: LAND_UNIT_ID,
      occurredAt: '2026-08-01T00:00:00Z',
    });
    // A fresh planting on the child (no expectedHarvestDate) supersedes the inherited parent one.
    expect(currentPlantingFor([parent, child], [LAND_UNIT_ID, 'parent'])).toEqual(child);
  });
});
