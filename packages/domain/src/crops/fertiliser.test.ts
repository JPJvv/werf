/**
 * Recording a fertiliser application (FR-206), tested as a pure function on observable output:
 * does a capture produce the right append-only `fertiliser` event, is it scoped to the BLOCK
 * rather than a herd, and does the method survive intact (it is what distinguishes fertigation
 * from broadcast/band, FR-206's own words)? Asserted on what a farmer or an auditor would see.
 */

import { describe, expect, it } from 'vitest';
import { ValidationError, isFarmScopedEventType, schemas } from '@werf/core';
import { recordFertiliser, type FertiliserInput } from './fertiliser';

const EVENT_ID = '01900000-0000-7000-8000-0000000000f1';
const FARM_ID = '01900000-0000-7000-8000-000000000f01';
const LAND_UNIT_ID = '01900000-0000-7000-8000-0000000000d1';
const USER_ID = '01900000-0000-7000-8000-000000000901';
const OCCURRED = new Date('2026-09-20T06:15:00Z');

function input(overrides: Partial<FertiliserInput> = {}): FertiliserInput {
  return {
    id: EVENT_ID,
    farmId: FARM_ID,
    landUnitId: LAND_UNIT_ID,
    occurredAt: OCCURRED,
    product: 'LAN 28%',
    method: 'broadcast',
    createdBy: USER_ID,
    ...overrides,
  };
}

describe('recordFertiliser (FR-206)', () => {
  it('builds a fertiliser event holding the product, method and when it was applied', () => {
    const event = recordFertiliser(input());

    expect(event.type).toBe('fertiliser');
    expect(event.payload).toEqual({ product: 'LAN 28%', method: 'broadcast' });
    expect(event.occurredAt).toBe(OCCURRED);
    expect(event.landUnitId).toBe(LAND_UNIT_ID);
    expect(event.syncedAt).toBeNull();
    expect(event.createdBy).toBe(USER_ID);
  });

  it('scopes the application to the block, never to a herd — the FR-113 exception', () => {
    const event = recordFertiliser(input());

    expect(event.enterpriseId).toBeNull();
    expect(event.animalId).toBeNull();
    expect(event.mobId).toBeNull();
    expect(isFarmScopedEventType('fertiliser')).toBe(true);
  });

  it('carries fertigation as a real method, not a note bolted onto broadcast/band', () => {
    const event = recordFertiliser(
      input({ method: 'fertigation', rate: { value: 12, unit: 'L/ha' } }),
    );

    expect(event.payload).toMatchObject({
      method: 'fertigation',
      rate: { value: 12, unit: 'L/ha' },
    });
  });

  it('carries the optional detail through untouched when it is given', () => {
    const event = recordFertiliser(
      input({ rate: { value: 250, unit: 'kg/ha' }, operator: 'Sipho' }),
    );

    expect(event.payload).toEqual({
      product: 'LAN 28%',
      method: 'broadcast',
      rate: { value: 250, unit: 'kg/ha' },
      operator: 'Sipho',
    });
  });

  it('omits detail that was not given, rather than writing it as null', () => {
    const event = recordFertiliser(input());

    expect(Object.keys(event.payload)).toEqual(['product', 'method']);
  });

  it('validates the payload against the schema the wire and the database share', () => {
    const event = recordFertiliser(input({ operator: 'Sipho' }));

    const parsed = schemas.fertiliserPayloadSchema.safeParse(event.payload);
    expect(parsed.success).toBe(true);
  });

  it('refuses a blank product', () => {
    expect(() => recordFertiliser(input({ product: '' }))).toThrow(ValidationError);
  });

  it('refuses a missing/invalid method', () => {
    // @ts-expect-error — exercising the runtime guard against a value TypeScript would refuse.
    expect(() => recordFertiliser(input({ method: 'spread' }))).toThrow(ValidationError);
  });

  it.each([
    ['a non-positive rate value', { value: 0, unit: 'kg/ha' }],
    ['a rate with no unit', { value: 250, unit: '' }],
  ])('refuses %s', (_case, rate) => {
    expect(() => recordFertiliser(input({ rate }))).toThrow(ValidationError);
  });
});
