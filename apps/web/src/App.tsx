import type { EnterpriseType } from '@werf/core';
import { HomeGrid } from './home/HomeGrid';

/**
 * Phase 1 app shell. The home screen is the enterprise-adaptive grid (FR-017).
 *
 * TEMPORARY: the farm shown here is a placeholder demo farm. The auth slice replaces it
 * with the active farm from the signed-in session (FR-004, FR-006) — the grid component
 * itself already takes the farm as data, so that swap is a wiring change, not a rewrite.
 */
const DEMO_FARM: { name: string; enterpriseTypes: EnterpriseType[] } = {
  name: 'Rietfontein',
  enterpriseTypes: ['beef_cattle', 'row_crops'],
};

export function App() {
  return (
    <main className="min-h-screen bg-sand-50">
      <HomeGrid farmName={DEMO_FARM.name} enterpriseTypes={DEMO_FARM.enterpriseTypes} />
    </main>
  );
}
