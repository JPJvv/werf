import { describe, expect, it } from 'vitest';
import {
  ENTERPRISE_TYPES,
  isCropEnterprise,
  isEnterpriseType,
  isLivestockEnterprise,
} from './enterprise';

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
});
