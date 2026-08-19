/**
 * `campGrazingStatuses` (FR-151, 4e·1) — the per-camp grazing-days/rest-days projection over the
 * move logs `foldCampActivity` folds and the SAME live/active occupancy `herd-summary.ts`'s
 * `byLandUnit` trusts. Asserted on observable output, never on how the fold walks it.
 */

import { describe, expect, it } from 'vitest';
import {
  campGrazingStatuses,
  restPeriodWarning,
  type GrazingAnimal,
  type GrazingMob,
} from './grazing';
import type { StoredMove } from './LocalMoves';
import type { StoredMobMove } from './LocalMobMoves';

const FARM_ID = '01900000-0000-7000-8000-000000000f01';
const ANIMAL_ID = '01900000-0000-7000-8000-0000000000a1';
const MOB_ID = '01900000-0000-7000-8000-0000000000b1';
const CAMP_A = '01900000-0000-7000-8000-000000000041';
const CAMP_B = '01900000-0000-7000-8000-000000000047';
const TODAY = '2026-08-19';

const animal = (over: Partial<GrazingAnimal> = {}): GrazingAnimal => ({
  id: ANIMAL_ID,
  status: 'alive',
  landUnitId: CAMP_A,
  ...over,
});

const mob = (over: Partial<GrazingMob> = {}): GrazingMob => ({
  id: MOB_ID,
  headCount: 40,
  landUnitId: CAMP_A,
  ...over,
});

const move = (over: Partial<StoredMove> & { id: string }): StoredMove => ({
  farmId: FARM_ID,
  animalId: ANIMAL_ID,
  occurredAt: '2026-08-01T12:00:00.000Z',
  batchId: null,
  ...over,
});

const mobMove = (over: Partial<StoredMobMove> & { id: string }): StoredMobMove => ({
  farmId: FARM_ID,
  mobId: MOB_ID,
  occurredAt: '2026-08-01T12:00:00.000Z',
  toLandUnitId: null,
  ...over,
});

describe('campGrazingStatuses — occupied camps', () => {
  it('reports grazing days from an individual animal move', () => {
    const moved = move({ id: '01900000-0000-7000-8000-00000000c001', toLandUnitId: CAMP_A });
    const statuses = campGrazingStatuses([animal()], [], [moved], [], TODAY);
    expect(statuses.get(CAMP_A)).toEqual({ kind: 'grazing', days: 18 });
  });

  it('reports grazing days from a mob move', () => {
    const moved = mobMove({ id: '01900000-0000-7000-8000-00000000c002', toLandUnitId: CAMP_A });
    const statuses = campGrazingStatuses([], [mob()], [], [moved], TODAY);
    expect(statuses.get(CAMP_A)).toEqual({ kind: 'grazing', days: 18 });
  });

  it('an occupant placed there at creation, never moved, reports grazingUnknown — no arrival on record', () => {
    // The animal's `landUnitId` says it is in CAMP_A, but there is no move event to date that from.
    const statuses = campGrazingStatuses([animal()], [], [], [], TODAY);
    expect(statuses.get(CAMP_A)).toEqual({ kind: 'grazingUnknown' });
  });

  it('two occupants in the same camp: grazing days is the LONGEST-present one, not the newest', () => {
    const secondAnimal = animal({ id: '01900000-0000-7000-8000-0000000000a2' });
    const arrivedFirst = move({
      id: '01900000-0000-7000-8000-00000000c001',
      occurredAt: '2026-08-01T12:00:00.000Z',
      toLandUnitId: CAMP_A,
    });
    const arrivedLater = move({
      id: '01900000-0000-7000-8000-00000000c002',
      animalId: secondAnimal.id,
      occurredAt: '2026-08-10T12:00:00.000Z',
      toLandUnitId: CAMP_A,
    });
    const statuses = campGrazingStatuses(
      [animal(), secondAnimal],
      [],
      [arrivedFirst, arrivedLater],
      [],
      TODAY,
    );
    expect(statuses.get(CAMP_A)).toEqual({ kind: 'grazing', days: 18 }); // since 2026-08-01, not -10
  });

  it('a dead animal is not an occupant — the move log alone never decides occupancy', () => {
    // Moved into CAMP_A 700 days ago, then died — no move ever took it back out. Without the
    // live/active cross-check this would report "grazing ~700 days".
    const longAgo = move({
      id: '01900000-0000-7000-8000-00000000c003',
      occurredAt: '2024-09-01T12:00:00.000Z',
      toLandUnitId: CAMP_A,
    });
    const statuses = campGrazingStatuses([animal({ status: 'dead' })], [], [longAgo], [], TODAY);
    expect(statuses.has(CAMP_A)).toBe(false);
  });

  it('a mob emptied to zero head is not an occupant', () => {
    const moved = mobMove({ id: '01900000-0000-7000-8000-00000000c004', toLandUnitId: CAMP_A });
    const statuses = campGrazingStatuses([], [mob({ headCount: 0 })], [], [moved], TODAY);
    expect(statuses.has(CAMP_A)).toBe(false);
  });
});

describe('campGrazingStatuses — empty camps', () => {
  it('reports rest days since the camp was last vacated', () => {
    const arrived = move({
      id: '01900000-0000-7000-8000-00000000c001',
      occurredAt: '2026-07-01T12:00:00.000Z',
      toLandUnitId: CAMP_A,
    });
    const left = move({
      id: '01900000-0000-7000-8000-00000000c002',
      occurredAt: '2026-08-04T12:00:00.000Z',
      toLandUnitId: CAMP_B,
    });
    // No live occupant is in CAMP_A any more — the animal walked on to CAMP_B.
    const statuses = campGrazingStatuses(
      [animal({ landUnitId: CAMP_B })],
      [],
      [arrived, left],
      [],
      TODAY,
    );
    expect(statuses.get(CAMP_A)).toEqual({ kind: 'resting', days: 15 });
  });

  it('a camp nothing has ever left is simply absent from the map — no restUnknown variant', () => {
    const statuses = campGrazingStatuses([], [], [], [], TODAY);
    expect(statuses.has(CAMP_A)).toBe(false); // absent, same "no entry" `LandScreen.tsx` renders honestly
  });

  it('a reoccupied-then-vacated-again camp reports rest days from the LATEST departure, through the full composition', () => {
    // The path a rotational-grazing farmer hits every season: vacate, reoccupy, vacate again. This
    // exercises `foldCampActivity`'s overwrite-forward AND the occupancy cross-check together —
    // `grazing.test.ts` (@werf/domain) already proves the fold alone; this proves neither layer
    // shadows the other once composed.
    const firstDeparture = move({
      id: '01900000-0000-7000-8000-00000000c001',
      occurredAt: '2026-06-10T12:00:00.000Z',
      toLandUnitId: CAMP_B,
    });
    const reoccupy = move({
      id: '01900000-0000-7000-8000-00000000c002',
      occurredAt: '2026-07-01T12:00:00.000Z',
      toLandUnitId: CAMP_A,
    });
    const secondDeparture = move({
      id: '01900000-0000-7000-8000-00000000c003',
      occurredAt: '2026-08-04T12:00:00.000Z',
      toLandUnitId: CAMP_B,
    });
    const statuses = campGrazingStatuses(
      [animal({ landUnitId: CAMP_B })],
      [],
      [firstDeparture, reoccupy, secondDeparture],
      [],
      TODAY,
    );
    expect(statuses.get(CAMP_A)).toEqual({ kind: 'resting', days: 15 }); // since 2026-08-04, not -06-10
  });
});

describe('restPeriodWarning — FR-152 (4e·2), warn not block', () => {
  it('warns, and answers "when CAN I move them back" directly, when resting fewer days than the threshold', () => {
    expect(restPeriodWarning({ kind: 'resting', days: 12 }, 30)).toEqual({
      daysRested: 12,
      daysRemaining: 18,
    });
  });

  it('is null once the resting days reach the threshold', () => {
    expect(restPeriodWarning({ kind: 'resting', days: 30 }, 30)).toBeNull();
    expect(restPeriodWarning({ kind: 'resting', days: 45 }, 30)).toBeNull();
  });

  it('never warns when the owner has not set a threshold', () => {
    expect(restPeriodWarning({ kind: 'resting', days: 1 }, null)).toBeNull();
  });

  it('never warns off a currently-grazing or arrival-unknown camp — a fact about now, not a return', () => {
    expect(restPeriodWarning({ kind: 'grazing', days: 1 }, 30)).toBeNull();
    expect(restPeriodWarning({ kind: 'grazingUnknown' }, 30)).toBeNull();
  });

  it('never warns when there is no record at all — nothing to compare a threshold to', () => {
    expect(restPeriodWarning(undefined, 30)).toBeNull();
  });
});
