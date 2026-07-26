/**
 * Species-specific attributes (FR-107), tested as the write-path rule it is: what each species may
 * carry, what it may not, and what the refusal says. Asserted on observable behaviour — the parsed
 * record, or the message a farmer would read — never on the schema's internals.
 */

import { describe, expect, it } from 'vitest';
import { ValidationError } from '@werf/core';
import { validateAttributes } from './attributes';

describe('validateAttributes (FR-107)', () => {
  it('accepts nothing at all, on every species', () => {
    // Optional by nature: a farmer tagging fifty head in a crush is not stopping to record horn
    // status on each one, and demanding it would mean the animal does not get recorded at all.
    for (const species of ['cattle', 'sheep', 'goat', 'pig', 'poultry', 'game'] as const) {
      expect(validateAttributes(species, {})).toEqual({});
    }
  });

  it('keeps a horn status on the species that have horns', () => {
    expect(validateAttributes('cattle', { hornStatus: 'polled' })).toEqual({
      hornStatus: 'polled',
    });
    // A sheep can be horned too — Dorper rams are, Merinos vary.
    expect(validateAttributes('sheep', { hornStatus: 'horned' })).toEqual({
      hornStatus: 'horned',
    });
  });

  it('keeps polled and dehorned apart, because a breeder needs to tell them apart', () => {
    // Polled is genetic and heritable; dehorned is something that was done to the animal. A buyer
    // looking at a hornless beast cannot tell, which is exactly why the record must.
    expect(validateAttributes('cattle', { hornStatus: 'polled' }).hornStatus).toBe('polled');
    expect(validateAttributes('cattle', { hornStatus: 'dehorned' }).hornStatus).toBe('dehorned');
  });

  it('⭐ refuses an attribute the species does not have, and names it', () => {
    // Not a harmless extra key: it means a capture screen or an importer has gone wrong, and
    // finding it in the data six months later is finding it too late to know what was meant.
    expect(() => validateAttributes('cattle', { woolClass: 'BFY' })).toThrow(ValidationError);
    expect(() => validateAttributes('cattle', { woolClass: 'BFY' })).toThrow(
      /a cattle does not have a 'woolClass'/i,
    );
  });

  it('refuses a horn status on a pig, and any invented attribute anywhere', () => {
    expect(() => validateAttributes('pig', { hornStatus: 'horned' })).toThrow(ValidationError);
    expect(() => validateAttributes('sheep', { favouriteColour: 'blue' })).toThrow(ValidationError);
  });

  it('refuses a horn status that is not one of the four', () => {
    expect(() => validateAttributes('cattle', { hornStatus: 'sort of' })).toThrow(
      /invalid 'hornStatus'/i,
    );
  });

  it('takes a wool class as the classer’s code and refuses a shape that is not one', () => {
    // Deliberately not an enum: the SA classing list is Cape Wools' and is not in this repo, so a
    // fabricated picker would be wrong in a way a wool farmer spots immediately. The SHAPE is what
    // can honestly be checked.
    expect(validateAttributes('sheep', { woolClass: 'BFY' })).toEqual({ woolClass: 'BFY' });
    expect(() => validateAttributes('sheep', { woolClass: 'not a code' })).toThrow(ValidationError);
    expect(() => validateAttributes('sheep', { woolClass: '' })).toThrow(ValidationError);
  });
});
