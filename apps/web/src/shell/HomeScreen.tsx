import type { EnterpriseType } from '@werf/core';
import { HomeGrid } from '../home/HomeGrid';

/**
 * TEMPORARY: a placeholder demo farm. The auth slice replaces this with the active farm from
 * the signed-in session (FR-004, FR-006). HomeGrid already takes the farm as data, so that is
 * a wiring change, not a rewrite.
 */
const DEMO_FARM: { name: string; enterpriseTypes: EnterpriseType[] } = {
  name: 'Rietfontein',
  enterpriseTypes: ['beef_cattle', 'row_crops'],
};

export function HomeScreen() {
  return <HomeGrid farmName={DEMO_FARM.name} enterpriseTypes={DEMO_FARM.enterpriseTypes} />;
}
