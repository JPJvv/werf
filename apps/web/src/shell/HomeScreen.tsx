import type { EnterpriseType } from '@werf/core';
import { useAuth } from '../auth/AuthProvider';
import { HomeGrid } from '../home/HomeGrid';
import { useHerdSummary } from '../livestock/herd';
import { FirstRunGuide } from './FirstRunGuide';

/**
 * The home screen: the enterprise-adaptive grid for the farm this session is looking at
 * (FR-004, FR-017).
 *
 * The farm comes from the signed-in session, which the auth provider read out of the local
 * store during its first render — so this renders on a cold start with no signal, which is
 * exactly why the farm list is cached alongside the tokens (FR-006).
 */
export function HomeScreen() {
  const { activeFarm } = useAuth();
  // Live head from the local herd (FR-017/705). Called unconditionally to satisfy the rules of
  // hooks; it reads the farm-scoped store the shell provides and updates the instant an animal
  // is captured. Zero on a new farm is the honest number, not a blank.
  const herd = useHerdSummary();

  // A signed-in user with no farm is not a state the product can reach: registration
  // creates a business and its first farm in one transaction, and Phase 1 cannot delete a
  // farm. Rendering nothing is the honest answer to an impossible state — better than
  // inventing a placeholder that looks like a real farm.
  if (!activeFarm) return null;

  const enterpriseTypes = activeFarm.enterpriseTypes as EnterpriseType[];

  return (
    <>
      <HomeGrid
        farmName={activeFarm.name}
        enterpriseTypes={enterpriseTypes}
        metrics={{ animals: String(herd.liveTotal) }}
      />
      <FirstRunGuide enterpriseTypes={enterpriseTypes} />
    </>
  );
}
