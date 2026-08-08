/**
 * Herd summary (FR-705) + tile numbers (FR-017), tested as a pure reduction on observable output:
 * are dead/sold/culled/missing excluded from live counts while still retained by status, are mob
 * head counts folded into the live totals (FR-102), and does byEnterprise give the per-tile number?
 * Asserted on what a farmer would read off the grid, not on implementation.
 */

import { describe, expect, it } from 'vitest';
import { summariseHerd, type HerdMember, type HerdMob } from './herd-summary';

const BEEF = 'ent-beef';
const SHEEP = 'ent-sheep';
const CAMP_1 = 'camp-1';
const CAMP_2 = 'camp-2';

function member(overrides: Partial<HerdMember> = {}): HerdMember {
  return {
    status: 'alive',
    species: 'cattle',
    sex: 'female',
    enterpriseId: BEEF,
    landUnitId: CAMP_1,
    ...overrides,
  };
}

describe('summariseHerd (FR-705 / FR-017)', () => {
  it('excludes dead/sold/culled/missing from live counts but retains them by status', () => {
    const summary = summariseHerd({
      animals: [
        member(), // alive
        member({ sex: 'male' }), // alive
        member({ status: 'dead' }),
        member({ status: 'sold' }),
        member({ status: 'culled' }),
        member({ status: 'missing' }),
      ],
    });

    expect(summary.animalsLive).toBe(2); // only the two alive
    expect(summary.liveTotal).toBe(2);
    expect(summary.byStatus).toEqual({ alive: 2, dead: 1, sold: 1, culled: 1, missing: 1 });
    expect(summary.bySex).toEqual({ female: 1, male: 1, castrated: 0, unknown: 0 });
    expect(summary.byEnterprise).toEqual({ [BEEF]: 2 }); // dead/sold not tiled
  });

  it('folds mob head counts into the live totals and the breakdowns (FR-102)', () => {
    const mobs: HerdMob[] = [
      { species: 'sheep', enterpriseId: SHEEP, landUnitId: CAMP_2, headCount: 300 },
      { species: 'sheep', enterpriseId: SHEEP, landUnitId: CAMP_2, headCount: null }, // uncounted → 0
    ];
    const summary = summariseHerd({ animals: [member(), member({ status: 'sold' })], mobs });

    expect(summary.animalsLive).toBe(1);
    expect(summary.mobHead).toBe(300);
    expect(summary.liveTotal).toBe(301);
    // byEnterprise is the tile number: beef tile = 1 head, sheep tile = 300 head.
    expect(summary.byEnterprise).toEqual({ [BEEF]: 1, [SHEEP]: 300 });
    expect(summary.bySpecies).toEqual({ cattle: 1, sheep: 300 });
    expect(summary.byLandUnit).toEqual({ [CAMP_1]: 1, [CAMP_2]: 300 });
  });

  it('counts null-enterprise / null-camp head in the total but not in the buckets', () => {
    const summary = summariseHerd({
      animals: [member({ enterpriseId: null, landUnitId: null })],
    });
    expect(summary.liveTotal).toBe(1);
    expect(summary.byEnterprise).toEqual({}); // not tiled
    expect(summary.byLandUnit).toEqual({});
    expect(summary.bySpecies).toEqual({ cattle: 1 }); // species is always known
  });

  it('summarises an empty herd to all-zero without throwing', () => {
    const summary = summariseHerd({ animals: [] });
    expect(summary.liveTotal).toBe(0);
    expect(summary.byStatus).toEqual({ alive: 0, dead: 0, sold: 0, culled: 0, missing: 0 });
    expect(summary.byEnterprise).toEqual({});
  });
});
