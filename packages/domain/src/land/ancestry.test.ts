/**
 * `ancestorChainOf` (FR-202), tested as a pure graph walk: does it find every generation, stop at
 * the root, survive a cycle it should never see, and answer something for a unit this device does
 * not fully know about?
 */

import { describe, expect, it } from 'vitest';
import { ancestorChainOf, type LandUnitAncestryRow } from './ancestry';

const B12 = 'b12';
const B12_A = 'b12-a';
const B12_A_1 = 'b12-a-1';
const OTHER = 'other-block';

describe('ancestorChainOf (FR-202)', () => {
  it('is just itself for a block with no parent', () => {
    const units: LandUnitAncestryRow[] = [{ id: B12, parentId: null }];

    expect(ancestorChainOf(B12, units)).toEqual([B12]);
  });

  it('walks one generation: a split child names its parent', () => {
    const units: LandUnitAncestryRow[] = [
      { id: B12, parentId: null },
      { id: B12_A, parentId: B12 },
    ];

    expect(ancestorChainOf(B12_A, units)).toEqual([B12_A, B12]);
  });

  it('walks MULTIPLE generations — a split of a split', () => {
    const units: LandUnitAncestryRow[] = [
      { id: B12, parentId: null },
      { id: B12_A, parentId: B12 },
      { id: B12_A_1, parentId: B12_A },
    ];

    expect(ancestorChainOf(B12_A_1, units)).toEqual([B12_A_1, B12_A, B12]);
  });

  it('never includes a sibling or an unrelated block', () => {
    const units: LandUnitAncestryRow[] = [
      { id: B12, parentId: null },
      { id: B12_A, parentId: B12 },
      { id: OTHER, parentId: null },
    ];

    expect(ancestorChainOf(B12_A, units)).not.toContain(OTHER);
  });

  it('answers just itself for a unit this device does not hold at all — a stale or partial sync', () => {
    expect(ancestorChainOf('unknown-id', [])).toEqual(['unknown-id']);
  });

  it('does not loop forever against a corrupt cycle', () => {
    // Not a shape the product should ever produce — a defensive floor, not a case to design for.
    const units: LandUnitAncestryRow[] = [
      { id: B12, parentId: B12_A },
      { id: B12_A, parentId: B12 },
    ];

    expect(ancestorChainOf(B12, units)).toEqual([B12, B12_A]);
  });
});
