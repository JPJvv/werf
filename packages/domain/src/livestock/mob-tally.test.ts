/**
 * Mob head-count tally (FR-102), tested as a pure function and a pure fold. The behaviour under
 * test is the one a farmer observes: after recording what happened, does the flock say the right
 * number, and does the app refuse the things that would put a wrong number on the tile?
 *
 * The composition cases are the point of the design and get the most attention here — two phones
 * in a dead zone must not lose one another's work, and a recount must beat the arithmetic it
 * corrects.
 */

import { describe, expect, it } from 'vitest';
import { ValidationError } from '@werf/core';
import {
  projectHeadCount,
  recordMobTally,
  type MobTallyInput,
  type TallyRecord,
} from './mob-tally';

const EVENT_ID = '01900000-0000-7000-8000-0000000000e1';
const FARM_ID = '01900000-0000-7000-8000-000000000f01';
const MOB_ID = '01900000-0000-7000-8000-0000000000b1';
const HERD_ID = '01900000-0000-7000-8000-000000000e01';
const USER_ID = '01900000-0000-7000-8000-000000000901';
const OCCURRED = new Date('2026-07-14T05:30:00Z'); // out in the veld; synced days later

function input(overrides: Partial<MobTallyInput> = {}): MobTallyInput {
  return {
    id: EVENT_ID,
    farmId: FARM_ID,
    mobId: MOB_ID,
    occurredAt: OCCURRED,
    reason: 'death',
    count: 3,
    currentHead: 300,
    enterpriseId: HERD_ID,
    createdBy: USER_ID,
    ...overrides,
  };
}

describe('recordMobTally (FR-102) — the count moves, and says why', () => {
  it('takes three dead ewes off a 300-head flock', () => {
    const { event, headCount } = recordMobTally(input());

    expect(headCount).toBe(297);
    expect(event.payload).toEqual({ reason: 'death', delta: -3 });
  });

  it('adds lambs born into the flock', () => {
    const { headCount, event } = recordMobTally(input({ reason: 'birth', count: 40 }));

    expect(headCount).toBe(340);
    expect(event.payload).toMatchObject({ reason: 'birth', delta: 40 });
  });

  it('derives the sign from the reason, so a sale can never add head', () => {
    // The farmer types "20" for both. Nothing on the wire carries a sign for a client to get wrong.
    const sold = recordMobTally(input({ reason: 'sale', count: 20 }));
    const bought = recordMobTally(input({ reason: 'purchase', count: 20 }));

    expect(sold.headCount).toBe(280);
    expect(bought.headCount).toBe(320);
  });

  it('records theft and home slaughter as the ordinary things they are', () => {
    expect(recordMobTally(input({ reason: 'theft', count: 12 })).headCount).toBe(288);
    expect(recordMobTally(input({ reason: 'slaughter', count: 1 })).headCount).toBe(299);
  });

  it('keeps a sale price as integer cents, and the buyer beside it', () => {
    const { event } = recordMobTally(
      input({
        reason: 'sale',
        count: 20,
        counterparty: 'Bethlehem abattoir',
        priceCents: 8_640_000,
      }),
    );

    expect(event.payload).toMatchObject({
      priceCents: 8_640_000,
      counterparty: 'Bethlehem abattoir',
    });
  });

  it('files the event under the mob and the herd, never against an animal (FR-113)', () => {
    const { event } = recordMobTally(input());

    expect(event.mobId).toBe(MOB_ID);
    expect(event.animalId).toBeNull();
    expect(event.enterpriseId).toBe(HERD_ID);
    expect(event.type).toBe('tally');
  });

  it('keeps occurredAt as the day it happened, not the day it was captured', () => {
    const { event } = recordMobTally(input());

    expect(event.occurredAt).toEqual(OCCURRED);
    expect(event.syncedAt).toBeNull();
  });
});

describe('recordMobTally — a recount is absolute', () => {
  it('sets the count to what was actually counted, ignoring what was on file', () => {
    const { headCount, event } = recordMobTally(input({ reason: 'recount', count: 291 }));

    expect(headCount).toBe(291);
    expect(event.payload).toEqual({ reason: 'recount', countedHead: 291 });
  });

  it('accepts a count of zero — an emptied camp is a real observation', () => {
    const { headCount } = recordMobTally(input({ reason: 'recount', count: 0 }));

    expect(headCount).toBe(0);
  });

  it('can count a flock UP, which no delta reason could do for a loss that was over-recorded', () => {
    const { headCount } = recordMobTally(input({ reason: 'recount', count: 305 }));

    expect(headCount).toBe(305);
  });
});

describe('recordMobTally — what it refuses, and what it tells the farmer to do', () => {
  it('refuses to take more head out than the group has, and names the recount as the repair', () => {
    expect(() => recordMobTally(input({ reason: 'death', count: 4, currentHead: 3 }))).toThrow(
      ValidationError,
    );
    // The message answers the next question — "so what do I do?" — rather than stating the refusal.
    expect(() => recordMobTally(input({ reason: 'death', count: 4, currentHead: 3 }))).toThrow(
      /count the group and record what you find/,
    );
  });

  it('allows a decrease to exactly zero', () => {
    expect(recordMobTally(input({ reason: 'sale', count: 300 })).headCount).toBe(0);
  });

  it('refuses a change of zero head, which records nothing while looking like work', () => {
    expect(() => recordMobTally(input({ count: 0 }))).toThrow(ValidationError);
  });

  it('refuses a fractional or negative count', () => {
    expect(() => recordMobTally(input({ count: 2.5 }))).toThrow(ValidationError);
    expect(() => recordMobTally(input({ count: -3 }))).toThrow(ValidationError);
  });

  it('refuses a tally on a group that is managed as individual animals', () => {
    // head_count is null: the number comes from counting the animal rows. A tally here would start
    // a second, competing count of the same sheep.
    expect(() => recordMobTally(input({ currentHead: null }))).toThrow(
      /record the death, sale or birth against the animal itself/,
    );
  });
});

describe('projectHeadCount (FR-102) — the fold two offline phones depend on', () => {
  const tally = (overrides: Partial<TallyRecord>): TallyRecord => ({
    mobId: MOB_ID,
    occurredAt: '2026-07-14T05:30:00.000Z',
    reason: 'death',
    delta: -3,
    ...overrides,
  });

  it('is the created count when nothing has happened yet', () => {
    expect(projectHeadCount(300, [])).toBe(300);
  });

  it('⭐ composes two independent offline captures instead of losing one', () => {
    // Two people, two phones, no signal, three dead ewes each. Six animals died; the flock is 294.
    // An edited head-count field would land on 297 and quietly keep three dead sheep in the count.
    const head = projectHeadCount(300, [
      tally({ occurredAt: '2026-07-14T06:00:00.000Z', delta: -3 }),
      tally({ occurredAt: '2026-07-14T09:00:00.000Z', delta: -3 }),
    ]);

    expect(head).toBe(294);
  });

  it('lets a recount supersede every adjustment before it', () => {
    const head = projectHeadCount(300, [
      tally({ occurredAt: '2026-07-01T06:00:00.000Z', delta: -3 }),
      tally({ occurredAt: '2026-07-02T06:00:00.000Z', reason: 'birth', delta: 40 }),
      tally({
        occurredAt: '2026-07-03T06:00:00.000Z',
        reason: 'recount',
        countedHead: 291,
        delta: undefined,
      }),
    ]);

    expect(head).toBe(291);
  });

  it('still applies what happened AFTER a recount', () => {
    const head = projectHeadCount(300, [
      tally({
        occurredAt: '2026-07-03T06:00:00.000Z',
        reason: 'recount',
        countedHead: 291,
        delta: undefined,
      }),
      tally({ occurredAt: '2026-07-05T06:00:00.000Z', reason: 'birth', delta: 9 }),
    ]);

    expect(head).toBe(300);
  });

  it('folds in occurredAt order, not the order the captures arrived', () => {
    // A phone that was in a dead zone syncs a week late; its capture is OLDER than one already held.
    const late = tally({ occurredAt: '2026-07-01T06:00:00.000Z', reason: 'birth', delta: 10 });
    const recount = tally({
      occurredAt: '2026-07-02T06:00:00.000Z',
      reason: 'recount',
      countedHead: 280,
      delta: undefined,
    });

    // Arriving in either order, the recount is still the later fact and still wins.
    expect(projectHeadCount(300, [recount, late])).toBe(280);
    expect(projectHeadCount(300, [late, recount])).toBe(280);
  });

  it('never reports a negative flock, whatever the device happens to hold', () => {
    const head = projectHeadCount(3, [tally({ delta: -50 })]);

    expect(head).toBe(0);
  });

  it('leaves a mob with no head count alone — its number comes from its animals', () => {
    expect(projectHeadCount(null, [tally({})])).toBeNull();
  });
});
