/**
 * Feed-out capture (Phase 4e, FR-153), tested as a pure function on observable output: does it
 * build the right `feed` event, does it refuse a capture naming neither a camp nor a group, and
 * does it refuse a non-positive quantity? Asserted on behaviour, never on implementation.
 */

import { describe, expect, it } from 'vitest';
import { ValidationError } from '@werf/core';
import { type FeedInput, recordFeedOut } from './feed';

const EVENT_ID = '01900000-0000-7000-8000-0000000000e1';
const FARM_ID = '01900000-0000-7000-8000-000000000f01';
const CAMP_A = '01900000-0000-7000-8000-0000000000c1';
const MOB_A = '01900000-0000-7000-8000-0000000000b1';
const ENTERPRISE_A = '01900000-0000-7000-8000-000000000e01';
const LOT_A = '01900000-0000-7000-8000-000000000l01';
const USER_ID = '01900000-0000-7000-8000-000000000901';
const OCCURRED = new Date('2026-07-15T05:30:00Z');

function input(overrides: Partial<FeedInput> = {}): FeedInput {
  return {
    id: EVENT_ID,
    farmId: FARM_ID,
    occurredAt: OCCURRED,
    inventoryLotId: LOT_A,
    quantity: 12,
    createdBy: USER_ID,
    ...overrides,
  };
}

describe('recordFeedOut (FR-153)', () => {
  it('builds a feed event against a group, carrying the camp and enterprise the caller derived', () => {
    const event = recordFeedOut(
      input({ mobId: MOB_A, landUnitId: CAMP_A, enterpriseId: ENTERPRISE_A }),
    );

    expect(event.type).toBe('feed');
    expect(event.mobId).toBe(MOB_A);
    expect(event.landUnitId).toBe(CAMP_A);
    expect(event.enterpriseId).toBe(ENTERPRISE_A);
    expect(event.inventoryLotId).toBe(LOT_A);
    expect(event.animalId).toBeNull();
    expect(event.payload).toEqual({ quantity: 12 });
  });

  it('builds a feed event against a camp alone, with no group', () => {
    const event = recordFeedOut(input({ landUnitId: CAMP_A, enterpriseId: ENTERPRISE_A }));

    expect(event.mobId).toBeNull();
    expect(event.landUnitId).toBe(CAMP_A);
  });

  it('refuses a feed-out naming neither a camp nor a group', () => {
    expect(() => recordFeedOut(input({ enterpriseId: ENTERPRISE_A }))).toThrow(ValidationError);
  });

  it('refuses a non-positive quantity', () => {
    expect(() => recordFeedOut(input({ mobId: MOB_A, quantity: 0 }))).toThrow(ValidationError);
    expect(() => recordFeedOut(input({ mobId: MOB_A, quantity: -3 }))).toThrow(ValidationError);
  });
});
