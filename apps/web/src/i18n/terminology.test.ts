/**
 * The terminology layer (FR-002 adaptation, FR-008 remainder). Table-driven, because the rule is a
 * table: what does a farm running THIS call its land and its animals? The cases that matter are the
 * mixed ones — they are where a second derivation elsewhere in the app used to disagree.
 */

import { describe, expect, it } from 'vitest';
import type { EnterpriseType } from '@werf/core';
import { dictionaries } from './dictionaries';
import { landTerm, stockTerm, termLabelKey, vocabularyFor } from './terminology';

const cases: ReadonlyArray<
  readonly [string, EnterpriseType[], 'camp' | 'block', 'herd' | 'flock' | 'livestock' | null]
> = [
  ['beef cattle', ['beef_cattle'], 'camp', 'herd'],
  ['dairy', ['dairy'], 'camp', 'herd'],
  ['sheep', ['sheep'], 'camp', 'flock'],
  ['sheep and goats', ['sheep', 'goats'], 'camp', 'flock'],
  ['poultry', ['poultry'], 'camp', 'flock'],
  ['cattle and sheep', ['beef_cattle', 'sheep'], 'camp', 'livestock'],
  ['a vineyard', ['vineyards'], 'block', null],
  ['row crops', ['row_crops'], 'block', null],
  // Crop naming wins on a mixed farm: a block is the audited unit, and an export auditor's
  // vocabulary is the one that costs money to get wrong.
  ['cattle and maize', ['beef_cattle', 'row_crops'], 'block', 'herd'],
  ['nothing chosen yet', [], 'camp', null],
];

describe('farm vocabulary', () => {
  it.each(cases)('%s: land = %s, stock = %s', (_label, types, land, stock) => {
    expect(vocabularyFor(types)).toEqual({ land, stock });
    expect(landTerm(types)).toBe(land);
    expect(stockTerm(types)).toBe(stock);
  });

  it('has a word for every term, in every language', () => {
    // The reason the lookup returns a token: a term with no word is a blank label in front of a
    // farmer. Here it is a failing test instead.
    for (const term of ['camp', 'block', 'herd', 'flock', 'livestock'] as const) {
      for (const locale of ['en-ZA', 'af-ZA'] as const) {
        expect(dictionaries[locale][termLabelKey(term)]).toBeTruthy();
      }
    }
  });
});
