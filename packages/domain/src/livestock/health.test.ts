/**
 * Farmer-entered health captures and reminder arithmetic (FR-130/131/132/133), tested as pure
 * functions. The withdrawal date is computed from an injected farm value and stored on the event;
 * this layer calculates dates and never decides whether the farmer may record a disposal.
 */

import { describe, expect, it } from 'vitest';
import { ValidationError } from '@werf/core';
import {
  type HealthBase,
  isWithinWithdrawal,
  recordDip,
  recordTreatment,
  recordVaccination,
  withholdUntil,
} from './health';

const FARM_ID = '01900000-0000-7000-8000-000000000f01';
const ANIMAL_ID = '01900000-0000-7000-8000-0000000000a1';
const MOB_ID = '01900000-0000-7000-8000-0000000000b1';
const EVENT_ID = '01900000-0000-7000-8000-0000000000e1';
const USER_ID = '01900000-0000-7000-8000-000000000901';
const OCCURRED = new Date('2026-07-15T05:30:00Z');

function base(overrides: Partial<HealthBase> = {}): HealthBase {
  return {
    id: EVENT_ID,
    farmId: FARM_ID,
    animalId: ANIMAL_ID,
    occurredAt: OCCURRED,
    administeredOn: '2026-07-15',
    createdBy: USER_ID,
    ...overrides,
  };
}

describe('withholdUntil (FR-131)', () => {
  // [name, treatment date, injected withdrawal days, expected clear date]. The period is INJECTED
  // reference data — no gazette/label figure is hardcoded here.
  const cases: ReadonlyArray<[string, string, number, string]> = [
    ['a 28-day meat withdrawal', '2026-07-15', 28, '2026-08-12'],
    ['a 4-day milk withdrawal', '2026-07-15', 4, '2026-07-19'],
    ['a zero-withdrawal product clears the same day', '2026-07-15', 0, '2026-07-15'],
    ['crosses a month/leap boundary', '2024-02-20', 10, '2024-03-01'],
  ];
  it.each(cases)('%s', (_name, on, days, expected) => {
    expect(withholdUntil(on, days)).toBe(expected);
  });

  it('refuses a negative or fractional withdrawal period', () => {
    expect(() => withholdUntil('2026-07-15', -1)).toThrow(ValidationError);
    expect(() => withholdUntil('2026-07-15', 3.5)).toThrow(ValidationError);
  });
});

describe('isWithinWithdrawal (FR-131 — private interval reminder)', () => {
  it('identifies dates before the reminder date and clears on/after it', () => {
    expect(isWithinWithdrawal('2026-08-12', '2026-08-11')).toBe(true); // still withheld
    expect(isWithinWithdrawal('2026-08-12', '2026-08-12')).toBe(false); // clears on the day
    expect(isWithinWithdrawal('2026-08-12', '2026-08-13')).toBe(false);
  });

  it('treats a product with no entered interval as having no reminder', () => {
    expect(isWithinWithdrawal(undefined, '2026-08-11')).toBe(false);
  });
});

describe('recordTreatment (FR-130/131)', () => {
  it('records the product details and computes+stores both withhold dates from injected periods', () => {
    const event = recordTreatment({
      ...base(),
      product: 'Terramycin LA',
      batch: 'LOT-42',
      doseValue: 20,
      doseUnit: 'ml',
      route: 'injection_im',
      administeredBy: 'A. Farmer',
      reason: 'foot infection',
      meatWithdrawalDays: 28,
      milkWithdrawalDays: 7,
    });

    expect(event.type).toBe('treatment');
    expect(event.animalId).toBe(ANIMAL_ID);
    expect(event.occurredAt).toBe(OCCURRED);
    expect(event.payload).toMatchObject({
      product: 'Terramycin LA',
      batch: 'LOT-42',
      route: 'injection_im',
      meatWithholdUntil: '2026-08-12', // computed at capture, stored on the event
      milkWithholdUntil: '2026-07-22',
    });
  });

  it('stores no withhold date when the product carries no withdrawal', () => {
    const event = recordTreatment({ ...base(), product: 'Saline flush' });
    expect(event.payload).not.toHaveProperty('meatWithholdUntil');
    expect(event.payload).not.toHaveProperty('milkWithholdUntil');
  });

  it('demands exactly one subject — an animal or a mob, never both or neither', () => {
    expect(() => recordTreatment({ ...base({ mobId: MOB_ID }), product: 'x' })).toThrow(
      ValidationError,
    ); // both animal + mob
    expect(() =>
      recordTreatment({ ...base({ animalId: null, mobId: null }), product: 'x' }),
    ).toThrow(ValidationError);
  });
});

describe('recordVaccination (FR-132) and recordDip (FR-133)', () => {
  it('records a whole-mob vaccination against a programme', () => {
    const event = recordVaccination({
      ...base({ animalId: null, mobId: MOB_ID }),
      product: 'Multimin',
      programme: 'Spring booster',
    });
    expect(event.type).toBe('vaccination');
    expect(event.mobId).toBe(MOB_ID);
    expect(event.payload).toMatchObject({ product: 'Multimin', programme: 'Spring booster' });
  });

  it('records a dip and still computes withdrawal when the dip product carries one', () => {
    const event = recordDip({
      ...base({ animalId: null, mobId: MOB_ID }),
      product: 'Amitraz dip',
      method: 'plunge',
      meatWithdrawalDays: 3,
    });
    expect(event.type).toBe('dip');
    expect(event.payload).toMatchObject({ method: 'plunge', meatWithholdUntil: '2026-07-18' });
  });
});
