/**
 * The herd projection's ORDER, which is the part two offline phones depend on.
 *
 * `projectHerd` folds the move log forward to decide where each animal is now. The fold itself has
 * always been right; what this file pins is the order it folds in, because that is where the client
 * and the server can silently disagree — and where this repo has already had to correct
 * `projectHeadCount` and `mobMembership` for exactly the same reason.
 */

import { describe, expect, it } from 'vitest';
import { projectHerd } from './herd';
import type { StoredAnimal } from './LocalHerd';
import type { StoredMove } from './LocalMoves';

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
