/**
 * The herd projection's ORDER, which is the part two offline phones depend on.
 *
 * `projectHerd` folds the move log forward to decide where each animal is now. The fold itself has
 * always been right; what this file pins is the order it folds in, because that is where the client
 * and the server can silently disagree — and where this repo has already had to correct
 * `projectHeadCount` and `mobMembership` for exactly the same reason.
 */

import { describe, expect, it } from 'vitest';
import { projectHerd, projectMobs } from './herd';
import type { StoredAnimal } from './LocalHerd';
import type { StoredMove } from './LocalMoves';
import type { StoredMob } from './LocalMobs';

const FARM_ID = '01900000-0000-7000-8000-000000000f01';
const ANIMAL_ID = '01900000-0000-7000-8000-0000000000a1';
const CAMP_4 = '01900000-0000-7000-8000-000000000041';
const CAMP_7 = '01900000-0000-7000-8000-000000000047';

// Client UUIDv7s. Time-ordered, so the LATER capture sorts higher — which is the whole reason the
// tie-break can stand in for capture order when the day is all the farmer was asked for.
const EARLIER = '01900000-0000-7000-8000-00000000c001';
const LATER = '01900000-0000-7000-8000-00000000c002';

const animal = (): StoredAnimal =>
  ({
    id: ANIMAL_ID,
    farmId: FARM_ID,
    species: 'cattle',
    sex: 'female',
    status: 'alive',
  }) as unknown as StoredAnimal;

const move = (over: Partial<StoredMove> & { id: string }): StoredMove => ({
  farmId: FARM_ID,
  animalId: ANIMAL_ID,
  // ⭐ One instant for the whole day. The move screen asks WHICH DAY, so every move captured on a
  // day carries midday — ties are the ordinary case here, not the edge one.
  occurredAt: '2026-07-22T12:00:00.000Z',
  batchId: null,
  ...over,
});

describe('projectHerd — where an animal is, when two moves share a day', () => {
  it('⭐ breaks a same-day tie by the capture id, whichever order the device holds them in', () => {
    // Walked to Camp 4, then to Camp 7, both recorded as "today". Without the id in the sort the
    // answer is whatever order the capture store happened to append in — and the server, sorting
    // `(occurred_at, id)` in Postgres, would say Camp 7 while this phone said Camp 4. The animal
    // would be in two camps depending on which screen the farmer was looking at.
    const toCamp4 = move({ id: EARLIER, toLandUnitId: CAMP_4 });
    const toCamp7 = move({ id: LATER, toLandUnitId: CAMP_7 });

    expect(projectHerd([animal()], [], [toCamp4, toCamp7])[0]?.landUnitId).toBe(CAMP_7);
    // The same log, arriving in the other order. A second phone's captures do not arrive sorted.
    expect(projectHerd([animal()], [], [toCamp7, toCamp4])[0]?.landUnitId).toBe(CAMP_7);
  });

  it('still folds by the day first, so a later day beats a higher id', () => {
    // The tie-break must not become the sort. An older capture id on a later day is still later.
    const older = move({
      id: LATER,
      occurredAt: '2026-07-20T12:00:00.000Z',
      toLandUnitId: CAMP_4,
    });
    const newer = move({
      id: EARLIER,
      occurredAt: '2026-07-24T12:00:00.000Z',
      toLandUnitId: CAMP_7,
    });

    expect(projectHerd([animal()], [], [older, newer])[0]?.landUnitId).toBe(CAMP_7);
    expect(projectHerd([animal()], [], [newer, older])[0]?.landUnitId).toBe(CAMP_7);
  });

  it('leaves a dimension the move did not name where it was', () => {
    // "Walked to Camp 4", then "taken out of its mob" must end with BOTH applied — the reason this
    // folds forward through every move rather than reading only the latest one.
    const walked = move({ id: EARLIER, toLandUnitId: CAMP_4, toMobId: 'mob-1' });
    const unassigned = move({ id: LATER, toMobId: null });

    const projected = projectHerd([animal()], [], [walked, unassigned])[0];
    expect(projected?.landUnitId).toBe(CAMP_4);
    expect(projected?.mobId).toBeNull();
  });
});

describe('projectHerd — reading a hydrated (down-synced) animal/event, not just a local one', () => {
  // ⭐ `useEffectiveAnimals` (phase-checklists.md 3e, extended past mobs/tallies) merges
  // `LocalHerd`/`LocalLifecycle`/`LocalMoves` with `HydratedLivestock`'s down-synced copies BEFORE
  // calling this function — this proves the fold itself accepts and correctly folds a lifecycle
  // event shaped exactly like a hydrated row can honestly provide (`HydratedLifecycleEvent`: no
  // `cause`/`counterparty`/`priceCents`/etc, only what `mostFinalByAnimal` reads), so the merge
  // cannot be shadowed by a stricter `StoredLifecycleEvent`-only type here.
  it('folds a death shaped exactly like a hydrated row over an animal captured only locally', () => {
    const hydratedDeath = {
      id: '01900000-0000-7000-8000-0000000000d1',
      animalId: ANIMAL_ID,
      type: 'death' as const,
      status: 'dead' as const,
      occurredAt: '2026-07-22T12:00:00.000Z',
    };
    const [projected] = projectHerd([animal()], [hydratedDeath]);
    expect(projected?.status).toBe('dead');
  });

  it('folds a death shaped exactly like a hydrated row over an animal ALSO known only via hydration', () => {
    // The sharper case: neither the animal row nor the death event was ever captured by this
    // device — both arrived purely through down-sync, which is exactly what happens when a
    // co-worker's phone registers and disposes of an animal this device has never heard of before.
    const hydratedAnimal = { ...animal(), status: 'alive' as const };
    const hydratedDeath = {
      id: '01900000-0000-7000-8000-0000000000d2',
      animalId: ANIMAL_ID,
      type: 'death' as const,
      status: 'dead' as const,
      occurredAt: '2026-07-22T12:00:00.000Z',
    };
    const [projected] = projectHerd([hydratedAnimal], [hydratedDeath]);
    expect(projected?.status).toBe('dead');
  });

  it('a birth/purchase/weaning-shaped hydrated event moves no status', () => {
    const hydratedWeaning = {
      id: '01900000-0000-7000-8000-0000000000d3',
      animalId: ANIMAL_ID,
      type: 'weaning' as const,
      status: null,
      occurredAt: '2026-07-22T12:00:00.000Z',
    };
    const [projected] = projectHerd([animal()], [hydratedWeaning]);
    expect(projected?.status).toBe('alive');
  });
});

describe('projectMobs — reading a hydrated (down-synced) mob, not just a local one', () => {
  // ⭐ `useEffectiveMobs` (phase-checklists.md 3e) merges `LocalMobs`/`LocalTallies` with
  // `HydratedLivestock`'s down-synced copies BEFORE calling this function — this file proves the
  // fold itself accepts and correctly counts a mob and a tally that carry no more than what a
  // hydrated `events`/`mobs` row can honestly provide (no `count`, the field only the capturing
  // device's own `StoredTally` carries), so the merge cannot be shadowed by a stricter type here.
  const M = '01900000-0000-7000-8000-0000000000b1';

  it('folds a tally shaped exactly like a hydrated row (no `count`) over a hydrated mob', () => {
    const hydratedMob: StoredMob = {
      id: M,
      farmId: FARM_ID,
      enterpriseId: null,
      landUnitId: null,
      name: 'Flock Down-synced',
      species: 'sheep',
      headCount: 260, // whatever the server last reported — irrelevant, the baseline decides
      initialHeadCount: 260,
    };
    // The `TallyRecord` shape a hydrated `events` row maps to — see `HydratedLivestock.tsx`'s
    // `mapHydratedTally`. No `count`.
    const hydratedBirth = {
      id: '01900000-0000-7000-8000-0000000000b2',
      mobId: M,
      occurredAt: '2026-07-20T12:00:00.000Z',
      reason: 'birth' as const,
      delta: 40,
    };

    const [projected] = projectMobs([hydratedMob], [hydratedBirth]);
    expect(projected?.headCount).toBe(300);
  });

  it('a hydrated mob with no baseline (initialHeadCount null) does not double-count', () => {
    // A row this build read straight off the wire never has `undefined` — only ever a real number
    // or an explicit `null`. `null` must NOT fall back to `headCount`, or a hydrated mob's own
    // running total gets folded over a second time the moment any tally lands on it.
    const hydratedMob: StoredMob = {
      id: M,
      farmId: FARM_ID,
      enterpriseId: null,
      landUnitId: null,
      name: 'Pre-migration mob',
      species: 'sheep',
      headCount: 50,
      initialHeadCount: null,
    };
    const hydratedTally = {
      id: '01900000-0000-7000-8000-0000000000b3',
      mobId: M,
      occurredAt: '2026-07-20T12:00:00.000Z',
      reason: 'death' as const,
      delta: -5,
    };

    const [projected] = projectMobs([hydratedMob], [hydratedTally]);
    // `projectHeadCount(null, ...)` returns null — the honest "cannot compute" answer — rather
    // than 45 (which would be `headCount` folded a second time).
    expect(projected?.headCount).toBeNull();
  });
});
