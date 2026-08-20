/**
 * Recording a spray (FR-204), tested as a pure function on observable output: does a capture
 * produce the right append-only `spray` event, is the PHI clear date computed and stored (never
 * recomputed later — ADR-0005), is it omitted rather than zeroed when the product carries none,
 * and is it scoped to the BLOCK rather than a herd? Asserted on what a farmer or an auditor would
 * see — never on implementation.
 */

import { describe, expect, it } from 'vitest';
import { ValidationError, isFarmScopedEventType, schemas } from '@werf/core';
import { earliestHarvestDateFor, recordSpray, type SprayInput } from './spray';

const EVENT_ID = '01900000-0000-7000-8000-0000000000a1';
const FARM_ID = '01900000-0000-7000-8000-000000000f01';
const LAND_UNIT_ID = '01900000-0000-7000-8000-0000000000d1';
const PRODUCT_ID = '01900000-0000-7000-8000-000000000c01';
const USER_ID = '01900000-0000-7000-8000-000000000901';
const OCCURRED = new Date('2026-10-05T05:00:00Z');

function input(overrides: Partial<SprayInput> = {}): SprayInput {
  return {
    id: EVENT_ID,
    farmId: FARM_ID,
    landUnitId: LAND_UNIT_ID,
    occurredAt: OCCURRED,
    sprayedOn: '2026-10-05',
    productId: PRODUCT_ID,
    activeIngredients: ['cyprodinil'],
    createdBy: USER_ID,
    ...overrides,
  };
}

describe('earliestHarvestDateFor', () => {
  it('adds the PHI to the spray day', () => {
    expect(earliestHarvestDateFor('2026-10-05', 7)).toBe('2026-10-12');
  });

  it('accepts a zero-day PHI (registered, cleared the same day)', () => {
    expect(earliestHarvestDateFor('2026-10-05', 0)).toBe('2026-10-05');
  });

  it.each([
    ['a negative PHI', -1],
    ['a fractional PHI', 2.5],
  ])('refuses %s', (_case, days) => {
    expect(() => earliestHarvestDateFor('2026-10-05', days)).toThrow(ValidationError);
  });
});

describe('recordSpray (FR-204)', () => {
  it('builds a spray event holding the product, ingredients and when it was applied', () => {
    const event = recordSpray(input());

    expect(event.type).toBe('spray');
    expect(event.payload).toEqual({
      productId: PRODUCT_ID,
      activeIngredients: ['cyprodinil'],
      sprayedOn: '2026-10-05',
    });
    expect(event.occurredAt).toBe(OCCURRED);
    expect(event.landUnitId).toBe(LAND_UNIT_ID);
    expect(event.syncedAt).toBeNull();
    expect(event.createdBy).toBe(USER_ID);
  });

  it('scopes the spray to the block, never to a herd — the FR-113 exception', () => {
    const event = recordSpray(input());

    expect(event.enterpriseId).toBeNull();
    expect(event.animalId).toBeNull();
    expect(event.mobId).toBeNull();
    expect(isFarmScopedEventType('spray')).toBe(true);
  });

  it('computes and stores the PHI clear date when a PHI is injected (ADR-0005)', () => {
    const event = recordSpray(input({ phiDays: 7 }));

    expect(event.payload).toMatchObject({ phiDays: 7, earliestHarvestDate: '2026-10-12' });
  });

  it('⭐ OMITS phiDays/earliestHarvestDate rather than storing zero when none is injected', () => {
    // A product with no PHI on record and a device that has not resolved one yet must not look
    // the same as a product registered with a zero-day PHI — the P1.3 lesson, one field over.
    const event = recordSpray(input());

    expect('phiDays' in event.payload).toBe(false);
    expect('earliestHarvestDate' in event.payload).toBe(false);
  });

  it('stores a zero-day PHI as a real 0, not as "none"', () => {
    const event = recordSpray(input({ phiDays: 0 }));

    expect(event.payload).toMatchObject({ phiDays: 0, earliestHarvestDate: '2026-10-05' });
  });

  it('carries the optional detail through untouched when it is given', () => {
    const event = recordSpray(
      input({
        rateLPerHa: 2.5,
        waterLPerHa: 200,
        operator: 'Sipho',
        equipment: 'Boom sprayer',
        windKph: 8,
        tempC: 22,
        targetPest: 'Powdery mildew',
      }),
    );

    expect(event.payload).toEqual({
      productId: PRODUCT_ID,
      activeIngredients: ['cyprodinil'],
      sprayedOn: '2026-10-05',
      rateLPerHa: 2.5,
      waterLPerHa: 200,
      operator: 'Sipho',
      equipment: 'Boom sprayer',
      windKph: 8,
      tempC: 22,
      targetPest: 'Powdery mildew',
    });
  });

  it('validates the payload against the schema the wire and the database share', () => {
    const event = recordSpray(input({ phiDays: 7 }));

    const parsed = schemas.sprayPayloadSchema.safeParse(event.payload);
    expect(parsed.success).toBe(true);
  });

  it('refuses no active ingredients', () => {
    expect(() => recordSpray(input({ activeIngredients: [] }))).toThrow(ValidationError);
  });

  it('refuses a spray day that is not a calendar date', () => {
    expect(() => recordSpray(input({ sprayedOn: '5 October 2026' }))).toThrow(ValidationError);
  });

  const LOT_ID = '01900000-0000-7000-8000-000000000e01';

  it('⭐ stores an optional inventory lot on the event COLUMN, never the payload (FR-502)', () => {
    const event = recordSpray(input({ inventoryLotId: LOT_ID }));

    expect(event.inventoryLotId).toBe(LOT_ID);
    expect('inventoryLotId' in event.payload).toBe(false);
  });

  it('leaves the inventory lot null when a farm is not tracking stock for this spray', () => {
    const event = recordSpray(input());

    expect(event.inventoryLotId).toBeNull();
  });
});
