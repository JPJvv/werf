/**
 * Breeding captures (FR-120/121), tested as pure functions on observable output: does a mating
 * produce the right event, and does a pregnancy diagnosis project a due date from an INJECTED
 * gestation only when it makes sense (pregnant + a known service date), never on an open result?
 * The projection is table-driven, and gestation is always injected — no gazette/biology number is
 * hardcoded in a test either.
 */

import { describe, expect, it } from 'vitest';
import { ValidationError } from '@werf/core';
import {
  projectDueDate,
  recordMating,
  recordPregnancyDiagnosis,
  type BreedingBase,
} from './breeding';

const EVENT_ID = '01900000-0000-7000-8000-0000000000e1';
const FARM_ID = '01900000-0000-7000-8000-000000000f01';
const DAM_ID = '01900000-0000-7000-8000-0000000000a1';
const SIRE_ID = '01900000-0000-7000-8000-0000000000a2';
const USER_ID = '01900000-0000-7000-8000-000000000901';
const OCCURRED = new Date('2026-07-15T05:30:00Z');

function base(overrides: Partial<BreedingBase> = {}): BreedingBase {
  return {
    id: EVENT_ID,
    farmId: FARM_ID,
    animalId: DAM_ID,
    occurredAt: OCCURRED,
    createdBy: USER_ID,
    ...overrides,
  };
}

describe('recordMating (FR-120)', () => {
  it('records a natural service against the dam, naming an on-farm sire', () => {
    const event = recordMating({ ...base(), method: 'natural', sireId: SIRE_ID });
    expect(event.type).toBe('mating');
    expect(event.animalId).toBe(DAM_ID); // recorded against the dam
    expect(event.occurredAt).toBe(OCCURRED);
    expect(event.payload).toEqual({ method: 'natural', sireId: SIRE_ID });
  });

  it('records AI by straw code, and a bull-in/bull-out running period', () => {
    const ai = recordMating({ ...base(), method: 'ai', sireCode: 'STRAW-778' });
    expect(ai.payload).toEqual({ method: 'ai', sireCode: 'STRAW-778' });

    const running = recordMating({
      ...base(),
      method: 'natural',
      sireId: SIRE_ID,
      bullInAt: '2026-06-01',
      bullOutAt: '2026-08-31',
    });
    expect(running.payload).toMatchObject({ bullInAt: '2026-06-01', bullOutAt: '2026-08-31' });
  });
});

describe('projectDueDate (FR-121)', () => {
  // [name, service date, gestation days, expected due date]. Gestation is injected reference data.
  const cases: ReadonlyArray<[string, string, number, string]> = [
    ['cattle ~283d spans a month boundary', '2026-07-15', 283, '2027-04-24'],
    ['sheep ~150d', '2026-07-15', 150, '2026-12-12'],
    ['a leap-year February is honoured', '2024-02-01', 29, '2024-03-01'],
  ];
  it.each(cases)('%s', (_name, service, days, expected) => {
    expect(projectDueDate(service, days)).toBe(expected);
  });

  it('refuses a non-positive or non-integer gestation, and a malformed service date', () => {
    expect(() => projectDueDate('2026-07-15', 0)).toThrow(ValidationError);
    expect(() => projectDueDate('2026-07-15', 283.5)).toThrow(ValidationError);
    expect(() => projectDueDate('15/07/2026', 283)).toThrow(ValidationError);
  });
});

describe('recordPregnancyDiagnosis (FR-121)', () => {
  it('projects and stores a due date for a positive diagnosis with a known service date', () => {
    const event = recordPregnancyDiagnosis({
      ...base(),
      method: 'ultrasound',
      result: 'pregnant',
      matingDate: '2026-07-15',
      gestationDays: 283,
    });
    expect(event.type).toBe('pregnancy_test');
    // The INPUTS are stored alongside the output, so a later report reads the figure the date was
    // derived from rather than re-deriving one that may since have moved.
    expect(event.payload).toEqual({
      method: 'ultrasound',
      result: 'pregnant',
      matingDate: '2026-07-15',
      gestationDays: 283,
      dueDate: '2027-04-24', // computed AT CAPTURE, stored on the event
    });
  });

  it('keeps the service date but projects no due date when no gestation figure is supplied', () => {
    // The species-with-no-gestation-row case at the domain layer: game and poultry have a real
    // service date and a positive result, and losing that fact to protect a projection that was
    // never available is the worse trade. `matingDate` is kept; `dueDate`/`gestationDays` are not.
    const event = recordPregnancyDiagnosis({
      ...base(),
      method: 'visual',
      result: 'pregnant',
      matingDate: '2026-07-15',
    });
    expect(event.payload).toEqual({
      method: 'visual',
      result: 'pregnant',
      matingDate: '2026-07-15',
    });
    expect(event.payload).not.toHaveProperty('dueDate');
  });

  it('records a positive diagnosis with no due date when the service date is unknown', () => {
    const event = recordPregnancyDiagnosis({ ...base(), method: 'palpation', result: 'pregnant' });
    expect(event.payload).toEqual({ method: 'palpation', result: 'pregnant' });
  });

  it('never projects a due date on an open or uncertain result, even if a service date is passed', () => {
    for (const result of ['open', 'uncertain'] as const) {
      const event = recordPregnancyDiagnosis({
        ...base(),
        method: 'blood',
        result,
        matingDate: '2026-07-15',
        gestationDays: 283,
      });
      expect(event.payload).toEqual({ method: 'blood', result });
      expect(event.payload).not.toHaveProperty('dueDate');
    }
  });
});
