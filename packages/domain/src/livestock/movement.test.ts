/**
 * Movement capture (FR-103), tested as a pure function on observable output: does a move produce
 * the right append-only `move` event (before AND after) and the right denormalised location change,
 * does it refuse a no-op and an animal that has left the herd, and is "omit = unchanged" distinct
 * from "null = cleared"? Asserted on behaviour, never on implementation.
 */

import { describe, expect, it } from 'vitest';
import type { AnimalStatus } from '@werf/core';
import { ValidationError } from '@werf/core';
import { type MoveInput, recordMove } from './movement';

const EVENT_ID = '01900000-0000-7000-8000-0000000000e1';
const FARM_ID = '01900000-0000-7000-8000-000000000f01';
const ANIMAL_ID = '01900000-0000-7000-8000-0000000000a1';
const CAMP_A = '01900000-0000-7000-8000-0000000000c1';
const CAMP_B = '01900000-0000-7000-8000-0000000000c2';
const MOB_A = '01900000-0000-7000-8000-0000000000b1';
const MOB_B = '01900000-0000-7000-8000-0000000000b2';
const USER_ID = '01900000-0000-7000-8000-000000000901';
const OCCURRED = new Date('2026-07-15T05:30:00Z'); // walked in the field, synced later

function input(overrides: Partial<MoveInput> = {}): MoveInput {
  return {
    id: EVENT_ID,
    farmId: FARM_ID,
    animalId: ANIMAL_ID,
    occurredAt: OCCURRED,
    currentStatus: 'alive',
    fromLandUnitId: CAMP_A,
    fromMobId: MOB_A,
    createdBy: USER_ID,
    ...overrides,
  };
}

describe('recordMove (FR-103)', () => {
  it('moves between camps, recording before AND after and updating the denormalised location', () => {
    const { event, animalChange } = recordMove(input({ toLandUnitId: CAMP_B }));

    expect(event.type).toBe('move');
    expect(event.animalId).toBe(ANIMAL_ID);
    expect(event.occurredAt).toBe(OCCURRED); // farm time, injected — not created_at
    expect(event.payload).toEqual({
      fromLandUnitId: CAMP_A,
      toLandUnitId: CAMP_B,
      fromMobId: MOB_A,
      toMobId: MOB_A, // mob untouched — omitted
    });
    // The event's own scope columns point at the destination so a per-camp feed shows the arrival.
    expect(event.landUnitId).toBe(CAMP_B);
    expect(event.mobId).toBe(MOB_A);
    // The animal row follows to its latest position.
    expect(animalChange).toEqual({ animalId: ANIMAL_ID, landUnitId: CAMP_B, mobId: MOB_A });
  });

  it('moves between mobs alone, leaving the camp where it was', () => {
    const { event, animalChange } = recordMove(input({ toMobId: MOB_B }));

    expect(event.payload).toEqual({
      fromLandUnitId: CAMP_A,
      toLandUnitId: CAMP_A,
      fromMobId: MOB_A,
      toMobId: MOB_B,
    });
    expect(animalChange).toEqual({ animalId: ANIMAL_ID, landUnitId: CAMP_A, mobId: MOB_B });
  });

  it('distinguishes null (unassign from the mob) from omitted (leave the mob)', () => {
    const { animalChange } = recordMove(input({ toMobId: null }));
    expect(animalChange.mobId).toBeNull();
    expect(animalChange.landUnitId).toBe(CAMP_A); // camp omitted — unchanged
  });

  it('carries herd scoping and a batch id for a group walk (FR-112/113)', () => {
    const ENTERPRISE = '01900000-0000-7000-8000-000000000e01';
    const BATCH = '01900000-0000-7000-8000-000000000ba7';
    const { event } = recordMove(
      input({ toLandUnitId: CAMP_B, enterpriseId: ENTERPRISE, batchId: BATCH }),
    );
    expect(event.enterpriseId).toBe(ENTERPRISE);
    expect(event.batchId).toBe(BATCH);
  });

  it('refuses a move that changes neither the camp nor the mob', () => {
    expect(() => recordMove(input({ toLandUnitId: CAMP_A, toMobId: MOB_A })).event).toThrow(
      ValidationError,
    );
    expect(() => recordMove(input()).event).toThrow(ValidationError); // both omitted
  });

  it('refuses to move an animal that has left the herd', () => {
    for (const status of ['dead', 'sold', 'culled', 'missing'] as AnimalStatus[]) {
      expect(() => recordMove(input({ currentStatus: status, toLandUnitId: CAMP_B }))).toThrow(
        ValidationError,
      );
    }
  });
});
