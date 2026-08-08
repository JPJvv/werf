/**
 * Batch capture (FR-112), tested as a pure function on observable output: does applying one capture
 * to a selected group stamp ONE shared batch id across every event while keeping each animal's own
 * event id and subject, and does it refuse an empty group? Proven against the real capture functions
 * (recordWeight, recordMove) rather than a stub, so the batch id actually lands on real events.
 */

import { describe, expect, it } from 'vitest';
import { ValidationError } from '@werf/core';
import { recordBatch } from './batch';
import { recordWeight, type WeightInput } from './weights';
import { recordMove, type MoveInput } from './movement';

const FARM_ID = '01900000-0000-7000-8000-000000000f01';
const BATCH = '01900000-0000-7000-8000-000000000ba7';
const CAMP_A = '01900000-0000-7000-8000-0000000000c1';
const CAMP_B = '01900000-0000-7000-8000-0000000000c2';
const OCCURRED = new Date('2026-07-15T05:30:00Z');

// A small herd, each animal with its own event id and its own tag — a real weigh session.
const HERD: readonly WeightInput[] = [
  { id: 'e1', farmId: FARM_ID, animalId: 'a1', occurredAt: OCCURRED, kg: 300, method: 'scale' },
  { id: 'e2', farmId: FARM_ID, animalId: 'a2', occurredAt: OCCURRED, kg: 315, method: 'scale' },
  { id: 'e3', farmId: FARM_ID, animalId: 'a3', occurredAt: OCCURRED, kg: 288, method: 'scale' },
];

describe('recordBatch (FR-112)', () => {
  it('stamps one shared batch id across the whole group, one event per animal', () => {
    const events = recordBatch(BATCH, HERD, recordWeight);

    expect(events).toHaveLength(HERD.length);
    expect(events.every((e) => e.batchId === BATCH)).toBe(true);
    // Each animal keeps its own event id and subject — the batch shares nothing but the batch id.
    expect(events.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
    expect(events.map((e) => e.animalId)).toEqual(['a1', 'a2', 'a3']);
    expect(events.map((e) => e.payload)).toEqual([
      { kg: 300, method: 'scale' },
      { kg: 315, method: 'scale' },
      { kg: 288, method: 'scale' },
    ]);
  });

  it('overrides any batch id already on an individual input with the shared one', () => {
    const withStale = HERD.map((w) => ({ ...w, batchId: 'stale-per-animal-id' }));
    const events = recordBatch(BATCH, withStale, recordWeight);
    expect(events.every((e) => e.batchId === BATCH)).toBe(true);
  });

  it('works for a whole mob walked to a new camp (recordMove), tying the moves together', () => {
    const walk: readonly MoveInput[] = [
      {
        id: 'm1',
        farmId: FARM_ID,
        animalId: 'a1',
        occurredAt: OCCURRED,
        currentStatus: 'alive',
        fromLandUnitId: CAMP_A,
        toLandUnitId: CAMP_B,
      },
      {
        id: 'm2',
        farmId: FARM_ID,
        animalId: 'a2',
        occurredAt: OCCURRED,
        currentStatus: 'alive',
        fromLandUnitId: CAMP_A,
        toLandUnitId: CAMP_B,
      },
    ];
    const captures = recordBatch(BATCH, walk, recordMove);

    expect(captures.map((c) => c.event.batchId)).toEqual([BATCH, BATCH]);
    expect(captures.every((c) => c.animalChange.landUnitId === CAMP_B)).toBe(true);
  });

  it('refuses an empty group — a batch with no animals is a capture bug', () => {
    expect(() => recordBatch(BATCH, [], recordWeight)).toThrow(ValidationError);
  });
});
