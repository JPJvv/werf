/**
 * The client half of the PHI guard (FR-205, US-030, O-12) — blocked locally, no server round trip.
 * Assembles `phiGuardFor`'s (`@werf/domain`) inputs from this device's own caches and runs the
 * IDENTICAL pure function the server runs (`crops.service.ts`'s `evaluatePhiGuard`) — see
 * `phi-guard.ts`'s own module header for why this is one shared implementation rather than the
 * client/server split `withdrawal.ts` (FR-131) uses.
 *
 * ⭐ Passes an EMPTY `landUnits` list, always — the one deliberate asymmetry with the server, which
 * has real `land_units.created_at` and checks a block's full ancestor chain. This device does not
 * (see `phi-guard.ts`'s own header for why that plumbing is filed as a follow-up, not built here),
 * so `ancestorChainOf` degrades to the leaf alone: THIS HOOK CHECKS THE BLOCK'S OWN SPRAY HISTORY
 * ONLY, never an ancestor's. `RecordHarvestScreen` is responsible for disclosing that gap on its own
 * account whenever the selected block has a non-null `parentId` — this hook does not, and must not,
 * silently read as "confirmed clear" for ground with a history it cannot see.
 *
 * `useSprayFacts`/`useProductFacts` are exported too — `phiRegister.ts`'s local derivation (the
 * cross-device race half of 4d·6) needs the identical mapping over the identical caches, and a
 * second hand-written copy is exactly how the two would quietly drift.
 */

import { useMemo } from 'react';
import {
  phiGuardFor,
  type PhiGuardResult,
  type PhiProductFact,
  type PhiSprayFact,
} from '@werf/domain';
import { useEffectiveSprays, type StoredSpray } from './LocalSprays';
import { useChemicalProducts } from './LocalChemicalProducts';

export function sprayFactsOf(sprays: readonly StoredSpray[]): readonly PhiSprayFact[] {
  return sprays.map((spray) => ({
    landUnitId: spray.landUnitId,
    occurredAt: spray.occurredAt,
    sprayedOn: spray.sprayedOn,
    productId: spray.productId,
    // The same discriminator `SpraysScreen.tsx` uses: `activeIngredients` is required and
    // non-empty on the wire, so its presence marks a spray that has round-tripped through the
    // server at least once (whether captured here or hydrated from another device).
    resolved: spray.activeIngredients !== undefined,
    ...(spray.earliestHarvestDate === undefined
      ? {}
      : { earliestHarvestDate: spray.earliestHarvestDate }),
  }));
}

/** This device's own spray evidence, local+hydrated merged — the identical shape `usePhiGuard` and
 *  `phiRegister.ts`'s local derivation both read. */
export function useSprayFacts(): readonly PhiSprayFact[] {
  const sprays = useEffectiveSprays();
  return useMemo(() => sprayFactsOf(sprays), [sprays]);
}

export function useProductFacts(): readonly PhiProductFact[] {
  const products = useChemicalProducts();
  return useMemo(
    () => products.map((product) => ({ id: product.id, phiDays: product.phiDays })),
    [products],
  );
}

export function usePhiGuard(landUnitId: string, harvestedOn: string): PhiGuardResult {
  const sprayFacts = useSprayFacts();
  const productFacts = useProductFacts();

  return useMemo(
    () => phiGuardFor(landUnitId, harvestedOn, sprayFacts, productFacts, []),
    [landUnitId, harvestedOn, sprayFacts, productFacts],
  );
}
