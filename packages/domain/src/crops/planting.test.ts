/**
 * Recording a planting (FR-203), tested as a pure function on observable output: does a capture
 * produce the right append-only `planting` event, is it scoped to the BLOCK rather than a herd, and
 * does the optional detail survive intact? Asserted on what a farmer or an auditor would see — never
 * on implementation.
 */

import { describe, expect, it } from 'vitest';
import { ValidationError, isFarmScopedEventType, schemas } from '@werf/core';
import { recordPlanting, type PlantingInput } from './planting';

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
