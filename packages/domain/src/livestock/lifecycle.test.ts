/**
 * Lifecycle captures (FR-104/105/106/111), tested as pure functions: given typed inputs, does
 * each produce the right append-only event AND the right status transition, and does it refuse a
 * capture that would step an animal backwards through the state machine? Asserted on observable
 * output (the event, the status change), never on implementation.
 */

import { describe, expect, it } from 'vitest';
import type { AnimalStatus } from '@werf/core';
import { ValidationError } from '@werf/core';
import {
  type CaptureBase,
  recordBirth,
  recordDeath,
  recordMissing,
  recordPurchase,
  recordSale,
  recordWeaning,
} from './lifecycle';

const EVENT_ID = '01900000-0000-7000-8000-0000000000e1';
const FARM_ID = '01900000-0000-7000-8000-000000000f01';
const ANIMAL_ID = '01900000-0000-7000-8000-0000000000a1';
const CALF_ID = '01900000-0000-7000-8000-0000000000c1';
const USER_ID = '01900000-0000-7000-8000-000000000901';
const OCCURRED = new Date('2026-07-15T05:30:00Z'); // captured in the field, synced later

function base(overrides: Partial<CaptureBase> = {}): CaptureBase {
  return {
    id: EVENT_ID,
    farmId: FARM_ID,
    animalId: ANIMAL_ID,
    occurredAt: OCCURRED,
    currentStatus: 'alive',
    createdBy: USER_ID,
    ...overrides,
  };
}

describe('recordDeath (FR-105)', () => {
  it('builds a death event and transitions the animal to dead, retaining occurred_at', () => {
    const { event, statusChange } = recordDeath({ ...base(), cause: 'tick-borne disease' });

    expect(event.type).toBe('death');
    expect(event.animalId).toBe(ANIMAL_ID);
    expect(event.occurredAt).toBe(OCCURRED); // farm time, injected — not created_at
    expect(event.syncedAt).toBeNull();
    expect(event.createdBy).toBe(USER_ID);
    expect(event.payload).toEqual({ cause: 'tick-borne disease' });

    expect(statusChange).toEqual({ animalId: ANIMAL_ID, status: 'dead', statusAt: OCCURRED });
  });

  it('is legal from any non-terminal state (dead is the most final)', () => {
    for (const from of ['alive', 'missing'] as AnimalStatus[]) {
      expect(() => recordDeath({ ...base({ currentStatus: from }), cause: 'x' })).not.toThrow();
    }
  });
});

describe('recordSale / recordPurchase (FR-106)', () => {
  it('a sale sends the animal out of the herd (status → sold) and stores Money as cents', () => {
    const { event, statusChange } = recordSale({
      ...base(),
      counterparty: 'Abattoir X',
      priceCents: 1_850_000, // R18,500.00 — integer cents, never a float
      weightKg: 480,
    });

    expect(event.type).toBe('sale');
    expect(event.payload).toEqual({
      counterparty: 'Abattoir X',
      priceCents: 1_850_000,
      weightKg: 480,
    });
    expect(statusChange).toEqual({ animalId: ANIMAL_ID, status: 'sold', statusAt: OCCURRED });
  });

  it('a purchase records the acquisition without changing status', () => {
    const { event, statusChange } = recordPurchase({
      ...base(),
      counterparty: 'Neighbour',
      priceCents: 900_000,
    });

    expect(event.type).toBe('purchase');
    expect(statusChange).toBeUndefined(); // the animal was, and remains, alive
  });

  it('refuses to sell an animal that is already dead (state machine guard)', () => {
    expect(() =>
      recordSale({ ...base({ currentStatus: 'dead' }), counterparty: 'X', priceCents: 1 }),
    ).toThrow(ValidationError);
  });

  it('rejects a negative price with a typed error, not a bad row', () => {
    expect(() => recordSale({ ...base(), counterparty: 'X', priceCents: -100 })).toThrow(
      ValidationError,
    );
  });
});

describe('recordWeaning (FR-111)', () => {
  it('records a weaning weight with no status change', () => {
    const { event, statusChange } = recordWeaning({ ...base(), weightKg: 210, ageDays: 205 });
    expect(event.type).toBe('weaning');
    expect(event.payload).toEqual({ weightKg: 210, ageDays: 205 });
    expect(statusChange).toBeUndefined();
  });

  it('cannot wean an animal that has left the herd', () => {
    expect(() => recordWeaning({ ...base({ currentStatus: 'sold' }), weightKg: 210 })).toThrow(
      ValidationError,
    );
  });

  it('rejects a non-positive weight', () => {
    expect(() => recordWeaning({ ...base(), weightKg: 0 })).toThrow(ValidationError);
  });
});

describe('recordBirth (FR-104)', () => {
  it('records the calving against the dam, referencing the calf in the payload', () => {
    const { event, statusChange } = recordBirth({
      ...base(),
      calfId: CALF_ID,
      easeScore: 2,
      multiples: 1,
      birthWeightKg: 34,
    });

    expect(event.type).toBe('birth');
    expect(event.animalId).toBe(ANIMAL_ID); // the dam's timeline
    expect(event.payload).toEqual({
      calfId: CALF_ID,
      damId: ANIMAL_ID,
      easeScore: 2,
      multiples: 1,
      birthWeightKg: 34,
    });
    expect(statusChange).toBeUndefined(); // the dam stays alive
  });

  it('requires a live dam', () => {
    expect(() =>
      recordBirth({
        ...base({ currentStatus: 'dead' }),
        calfId: CALF_ID,
        easeScore: 1,
        multiples: 1,
      }),
    ).toThrow(ValidationError);
  });

  it('rejects an out-of-range ease score at the domain boundary', () => {
    expect(() =>
      recordBirth({
        ...base(),
        calfId: CALF_ID,
        easeScore: 9 as unknown as 1,
        multiples: 1,
      }),
    ).toThrow(ValidationError);
  });
});

describe('recordMissing (FR-605, stock theft)', () => {
  const POINT = JSON.stringify({ type: 'Point', coordinates: [26.2, -29.1] });

  it('marks an animal missing, GPS-anchored on the event and timestamped', () => {
    const { event, statusChange } = recordMissing({ ...base(), lastSeenGeojson: POINT });
    expect(event.type).toBe('missing');
    expect(event.animalId).toBe(ANIMAL_ID);
    expect(event.locationGeojson).toBe(POINT); // the last-seen point
    expect(event.occurredAt).toBe(OCCURRED);
    expect(statusChange).toEqual({ animalId: ANIMAL_ID, status: 'missing', statusAt: OCCURRED });
  });

  it('cannot mark a sold or dead animal missing (state machine guard)', () => {
    for (const from of ['sold', 'dead', 'culled'] as AnimalStatus[]) {
      expect(() =>
        recordMissing({ ...base({ currentStatus: from }), lastSeenGeojson: POINT }),
      ).toThrow(ValidationError);
    }
  });
});
