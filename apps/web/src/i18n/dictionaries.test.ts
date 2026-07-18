import { describe, expect, it } from 'vitest';
import { LOCALES, dictionaries } from './dictionaries';

describe('dictionaries (FR-008)', () => {
  it('every locale carries exactly the English key set — no missing translation ships blank', () => {
    const enKeys = Object.keys(dictionaries['en-ZA']).sort();
    for (const locale of LOCALES) {
      expect(Object.keys(dictionaries[locale]).sort()).toEqual(enKeys);
    }
  });

  it('has no empty strings in any locale', () => {
    for (const locale of LOCALES) {
      for (const value of Object.values(dictionaries[locale])) {
        expect(value.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
