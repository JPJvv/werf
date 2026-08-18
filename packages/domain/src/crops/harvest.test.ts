/**
 * Recording a harvest (FR-207), tested as a pure function on observable output: does a capture
 * produce the right append-only `harvest` event, is it scoped to the BLOCK rather than a herd, and
 * is an override carried through untouched (never resolved or judged here — that is `phi-guard.ts`
 * and the caller composing the two). Asserted on what a farmer or an auditor would see — never on
 * implementation.
 */

import { describe, expect, it } from 'vitest';
import { ValidationError, isFarmScopedEventType, schemas } from '@werf/core';
import { recordHarvest, type HarvestInput } from './harvest';

const EVENT_ID = '01900000-0000-7000-8000-0000000000a1';
const FARM_ID = '01900000-0000-7000-8000-000000000f01';
const LAND_UNIT_ID = '01900000-0000-7000-8000-0000000000d1';
const USER_ID = '01900000-0000-7000-8000-000000000901';
const OCCURRED = new Date('2026-10-05T05:00:00Z');

function input(overrides: Partial<HarvestInput> = {}): HarvestInput {
  return {
    id: EVENT_ID,
    farmId: FARM_ID,
    landUnitId: LAND_UNIT_ID,
    occurredAt: OCCURRED,
    harvestedOn: '2026-10-05',
    quantity: 12.5,
    unit: 'ton',
    createdBy: USER_ID,
    ...overrides,
  };
}

describe('recordHarvest (FR-207)', () => {
  it('builds a harvest event holding the day, quantity and unit', () => {
    const event = recordHarvest(input());

    expect(event.type).toBe('harvest');
    expect(event.payload).toEqual({ harvestedOn: '2026-10-05', quantity: 12.5, unit: 'ton' });
    expect(event.occurredAt).toBe(OCCURRED);
    expect(event.landUnitId).toBe(LAND_UNIT_ID);
    expect(event.syncedAt).toBeNull();
    expect(event.createdBy).toBe(USER_ID);
  });

  it('scopes the harvest to the block, never to a herd — the FR-113 exception', () => {
    const event = recordHarvest(input());

    expect(event.enterpriseId).toBeNull();
    expect(event.animalId).toBeNull();
    expect(event.mobId).toBeNull();
    expect(isFarmScopedEventType('harvest')).toBe(true);
  });

  it('carries grade and destination through untouched when given', () => {
    const event = recordHarvest(input({ grade: 'Class 1', destination: 'Pack shed A' }));

    expect(event.payload).toEqual({
      harvestedOn: '2026-10-05',
      quantity: 12.5,
      unit: 'ton',
      grade: 'Class 1',
      destination: 'Pack shed A',
    });
  });

  it('carries an override through untouched — never judged or resolved here', () => {
    const event = recordHarvest(
      input({ phiOverride: { reason: 'Export deadline — reason on file', by: USER_ID } }),
    );

    expect(event.payload).toMatchObject({
      phiOverride: { reason: 'Export deadline — reason on file', by: USER_ID },
    });
  });

  it('⭐ accepts an override with `by` OMITTED — a local capture that has a reason but no server-trusted actor to give yet', () => {
    const event = recordHarvest(input({ phiOverride: { reason: 'Export deadline' } }));

    expect(event.payload).toMatchObject({ phiOverride: { reason: 'Export deadline' } });
    expect('by' in (event.payload as { phiOverride: object }).phiOverride).toBe(false);
  });

  it('validates the payload against the schema the wire and the database share', () => {
    const event = recordHarvest(input());

    const parsed = schemas.harvestPayloadSchema.safeParse(event.payload);
    expect(parsed.success).toBe(true);
  });

  it('refuses a non-positive quantity', () => {
    expect(() => recordHarvest(input({ quantity: 0 }))).toThrow(ValidationError);
  });

  it('refuses a harvest day that is not a calendar date', () => {
    expect(() => recordHarvest(input({ harvestedOn: '5 October 2026' }))).toThrow(ValidationError);
  });
});
