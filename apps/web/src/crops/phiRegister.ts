/**
 * The half of the PHI compliance register the DEVICE can answer for itself (4d·6, FR-205) —
 * COMPLIANCE-GATED. Mirrors `livestock/residue.ts` exactly, one food-safety boundary over: the
 * cross-device race — device A sprays, device B harvests before either has synced — cannot be
 * caught by any at-capture or at-flush guard, because neither device has ever seen the other's
 * evidence. Only a re-derivation over the WHOLE log, after both have landed, can catch it — the
 * server half of that is `crops.service.ts`'s `phiComplianceRegister`; this is the device's own
 * partial answer, covering what THIS device captured and has not sent yet.
 *
 * ⭐ Runs the SAME `phiGuardFor` the at-capture guard (`usePhiGuard.ts`) and the server both run —
 * never a second, similar-looking rule. `residue.ts`'s own header names the lesson this avoids: two
 * mechanisms judging one food-safety boundary through two computations, one of them narrower.
 *
 * This is NOT the FR-205 override path (`RecordHarvestScreen.tsx`'s own override flow) — a harvest
 * the farmer already overrode is filtered out here, because that is a deliberate, audited decision
 * already made, not a race to flag.
 */

import { useMemo } from 'react';
import { useHarvests, type StoredHarvest } from './LocalHarvest';
import { useSprayFacts, useProductFacts } from './usePhiGuard';
import { phiGuardFor, type PhiProductFact, type PhiSprayFact } from '@werf/domain';

/** A harvest THIS device recorded and its own log now says is inside an active PHI, from the
 *  fullest evidence this device holds. Deliberately the server's shape minus nothing this device
 *  cannot honestly fill — unlike `LocalResidueFlag`, there is no `knownAtCapture` claim to omit: a
 *  PHI race is never "known at capture" by construction, that is the whole reason it is a race. */
export interface LocalPhiFlag {
  readonly eventId: string;
  readonly landUnitId: string;
  readonly harvestedOn: string;
  readonly productId: string;
  readonly sprayedOn: string;
  readonly earliestHarvestDate: string;
}

/**
 * Every harvest on THIS device's own log that its own log now says falls inside an active PHI.
 *
 * Pure, so it can be tested without a React tree — the hook below is the thin wrapper that feeds it
 * the stores. `harvests` must stay LOCAL-ONLY (the row source — a hydrated harvest is by
 * definition already known to the server, so it is already covered by the server's own register);
 * `sprays`/`products` are local+hydrated evidence, the fullest picture this device holds.
 */
export function localPhiFlags(
  harvests: readonly StoredHarvest[],
  sprays: readonly PhiSprayFact[],
  products: readonly PhiProductFact[],
): readonly LocalPhiFlag[] {
  const flags: LocalPhiFlag[] = [];
  for (const harvest of harvests) {
    if (harvest.phiOverride !== undefined) continue;
    const guard = phiGuardFor(harvest.landUnitId, harvest.harvestedOn, sprays, products, []);
    if (guard.blocked && guard.reason === 'active_phi') {
      flags.push({
        eventId: harvest.id,
        landUnitId: harvest.landUnitId,
        harvestedOn: harvest.harvestedOn,
        productId: guard.blockedBy.productId,
        sprayedOn: guard.blockedBy.sprayedOn,
        earliestHarvestDate: guard.blockedBy.earliestHarvestDate,
      });
    }
  }
  return flags;
}

export function useLocalPhiFlags(): readonly LocalPhiFlag[] {
  const harvests = useHarvests();
  const sprayFacts = useSprayFacts();
  const productFacts = useProductFacts();
  return useMemo(
    () => localPhiFlags(harvests, sprayFacts, productFacts),
    [harvests, sprayFacts, productFacts],
  );
}
