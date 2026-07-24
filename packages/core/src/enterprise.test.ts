import { describe, expect, it } from 'vitest';
import {
  ENTERPRISE_TYPES,
  enterpriseSpecies,
  isCropEnterprise,
  isEnterpriseType,
  isLivestockEnterprise,
} from './enterprise';
import { isSpecies } from './animals';

describe('enterprise types', () => {
  it('matches the Postgres enum values exactly', () => {
    // Guards the client/DB contract: a drift here is a sync bug, not a typo.
    expect(ENTERPRISE_TYPES).toEqual([
      'beef_cattle',
      'dairy',
      'sheep',
      'goats',
      'pigs',
      'poultry',
      'game',
      'row_crops',
      'vegetables',
      'orchards',
      'vineyards',
      'other',
    ]);
  });

  it('narrows an unknown string to a known enterprise type', () => {
    expect(isEnterpriseType('vineyards')).toBe(true);
    expect(isEnterpriseType('llamas')).toBe(false);
  });

  it('classifies animals as livestock and plants as crop, never both', () => {
    expect(isLivestockEnterprise('beef_cattle')).toBe(true);
    expect(isCropEnterprise('beef_cattle')).toBe(false);
    expect(isCropEnterprise('vineyards')).toBe(true);
    expect(isLivestockEnterprise('vineyards')).toBe(false);
  });

  it('treats "other" as neither livestock nor crop', () => {
    expect(isLivestockEnterprise('other')).toBe(false);
    expect(isCropEnterprise('other')).toBe(false);
  });

  describe('the species an enterprise keeps', () => {
    it('maps both cattle enterprises to cattle', () => {
      expect(enterpriseSpecies('beef_cattle')).toBe('cattle');
      expect(enterpriseSpecies('dairy')).toBe('cattle');
    });

    it('maps each other livestock enterprise to its species', () => {
      expect(enterpriseSpecies('sheep')).toBe('sheep');
      expect(enterpriseSpecies('goats')).toBe('goat');
      expect(enterpriseSpecies('pigs')).toBe('pig');
      expect(enterpriseSpecies('poultry')).toBe('poultry');
      expect(enterpriseSpecies('game')).toBe('game');
    });

    it('gives every livestock enterprise a real, known species and every crop none', () => {
      // Guards the whole mapping against drift: a livestock type with no species would leave a
      // farm unable to record stock; a crop type with one would offer animals it never keeps.
      for (const type of ENTERPRISE_TYPES) {
        const species = enterpriseSpecies(type);
        if (isLivestockEnterprise(type)) {
          expect(species).not.toBeNull();
          expect(isSpecies(species!)).toBe(true);
        } else {
          expect(species).toBeNull();
        }
      }
    });
  });
});
