/**
 * Weight capture (FR-140) and average daily gain (FR-141), tested as pure functions on observable
 * output: does a capture produce the right append-only `weight` event, does it insist on exactly
 * one subject, and is ADG computed from occurred_at, order-independent, and honest about weight
 * loss? Table-driven where the rule is a table (the ADG cases), asserted on behaviour a farmer or
 * an auditor would see — never on implementation.
 */

import { describe, expect, it } from 'vitest';
import { ValidationError } from '@werf/core';
import { averageDailyGain, recordWeight, type WeightInput } from './weights';

const EVENT_ID = '01900000-0000-7000-8000-0000000000e1';
const FARM_ID = '01900000-0000-7000-8000-000000000f01';
const ANIMAL_ID = '01900000-0000-7000-8000-0000000000a1';
const MOB_ID = '01900000-0000-7000-8000-0000000000b1';
const USER_ID = '01900000-0000-7000-8000-000000000901';
const OCCURRED = new Date('2026-07-15T05:30:00Z'); // weighed in the crush, synced later

function input(overrides: Partial<WeightInput> = {}): WeightInput {
  return {
    id: EVENT_ID,
    farmId: FARM_ID,
    animalId: ANIMAL_ID,
    occurredAt: OCCURRED,
    kg: 312.5,
    method: 'scale',
    createdBy: USER_ID,
    ...overrides,
  };
}

describe('recordWeight (FR-140)', () => {
  it('builds a weight event against an animal, keeping occurred_at and leaving status alone', () => {
    const event = recordWeight(input());

    expect(event.type).toBe('weight');
    expect(event.animalId).toBe(ANIMAL_ID);
    expect(event.mobId).toBeNull();
    expect(event.occurredAt).toBe(OCCURRED); // farm time, injected — not created_at
    expect(event.syncedAt).toBeNull(); // not sent yet
    expect(event.createdBy).toBe(USER_ID);
    expect(event.payload).toEqual({ kg: 312.5, method: 'scale' });
  });

  it('weighs a mob without individual rows (FR-140: an animal OR a mob)', () => {
    const event = recordWeight(input({ animalId: null, mobId: MOB_ID }));

    expect(event.mobId).toBe(MOB_ID);
    expect(event.animalId).toBeNull();
    expect(event.payload).toEqual({ kg: 312.5, method: 'scale' });
  });

  it('carries herd scoping and batch through for a weigh session (FR-112/113)', () => {
    const ENTERPRISE = '01900000-0000-7000-8000-000000000e01';
    const BATCH = '01900000-0000-7000-8000-000000000ba7';
    const event = recordWeight(input({ enterpriseId: ENTERPRISE, batchId: BATCH }));

    expect(event.enterpriseId).toBe(ENTERPRISE);
    expect(event.batchId).toBe(BATCH);
  });

  it('rejects a capture with neither an animal nor a mob', () => {
    expect(() => recordWeight(input({ animalId: null, mobId: null }))).toThrow(ValidationError);
  });

  it('rejects a capture pinned to both an animal and a mob', () => {
    expect(() => recordWeight(input({ animalId: ANIMAL_ID, mobId: MOB_ID }))).toThrow(
      ValidationError,
    );
  });

  it('rejects an impossible reading at the domain boundary, not silently into the log', () => {
    expect(() => recordWeight(input({ kg: 0 }))).toThrow(ValidationError);
    expect(() => recordWeight(input({ kg: -5 }))).toThrow(ValidationError);
    // @ts-expect-error a method outside the enum is a capture bug
    expect(() => recordWeight(input({ method: 'guess' }))).toThrow(ValidationError);
  });
});

describe('averageDailyGain (FR-141)', () => {
  const day = (d: string) => new Date(`2026-${d}T06:00:00Z`);

  // [name, earlier reading, later reading, expected kg/day]. The rule is a table, so the test is.
  const cases: ReadonlyArray<
    [string, { kg: number; occurredAt: Date }, { kg: number; occurredAt: Date }, number]
  > = [
    [
      'a plain gain over 10 days',
      { kg: 200, occurredAt: day('07-01') },
      { kg: 212, occurredAt: day('07-11') },
      1.2,
    ],
    [
      'a fractional-kg gain',
      { kg: 45, occurredAt: day('07-01') },
      { kg: 60, occurredAt: day('07-31') },
      0.5,
    ],
    [
      'weight LOSS is a real, negative signal, not an error',
      { kg: 480, occurredAt: day('07-01') },
      { kg: 470, occurredAt: day('07-11') },
      -1,
    ],
    ['no gain', { kg: 300, occurredAt: day('07-01') }, { kg: 300, occurredAt: day('07-06') }, 0],
    [
      'a sub-day interval is honoured as a fraction of a day',
      { kg: 300, occurredAt: new Date('2026-07-01T06:00:00Z') },
      { kg: 301, occurredAt: new Date('2026-07-01T18:00:00Z') },
      2,
    ],
  ];

  it.each(cases)('%s', (_name, earlier, later, expected) => {
    expect(averageDailyGain(earlier, later)).toBeCloseTo(expected, 10);
  });

  it('is order-independent: the earlier reading is always the baseline', () => {
    const first = { kg: 200, occurredAt: day('07-01') };
    const second = { kg: 212, occurredAt: day('07-11') };
    expect(averageDailyGain(second, first)).toBeCloseTo(averageDailyGain(first, second), 10);
    expect(averageDailyGain(second, first)).toBeCloseTo(1.2, 10);
  });

  it('throws on two readings at the same instant — there is no rate without elapsed time', () => {
    const at = day('07-01');
    expect(() =>
      averageDailyGain({ kg: 200, occurredAt: at }, { kg: 210, occurredAt: at }),
    ).toThrow(ValidationError);
  });
});
