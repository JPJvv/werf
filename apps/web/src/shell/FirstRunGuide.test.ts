/**
 * `firstRunSteps` (FR-010), tested as a pure function: does each step land on the room its own
 * sentence promises? Written after this slice found the crop step's destination had drifted from
 * its label — "Record your first planting" pointed at `/harvest`, an honest placeholder from
 * before FR-203 existed. Nothing else in the suite exercised this function at all.
 */

import { describe, expect, it } from 'vitest';
import { firstRunSteps } from './FirstRunGuide';

describe('firstRunSteps (FR-010)', () => {
  it('sends a crop farm to record its first planting where FR-203 actually lives', () => {
    const steps = firstRunSteps(['row_crops']);

    const stock = steps.find((step) => step.labelKey === 'firstRun.stock.crops');
    expect(stock?.to).toBe('/crops/plant');
  });

  it('sends a livestock farm to record its first animal, not a planting', () => {
    const steps = firstRunSteps(['beef_cattle']);

    expect(steps.find((step) => step.labelKey === 'firstRun.stock.animals')?.to).toBe('/animals');
    expect(steps.find((step) => step.labelKey === 'firstRun.stock.crops')).toBeUndefined();
  });
});
