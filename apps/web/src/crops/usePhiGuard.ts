/**
 * The client half of BOTH PHI guards (FR-205, US-030, O-12, legal-compliance.md § 4.3) — blocked
 * locally, no server round trip, either direction. `usePhiGuard` (harvest-side) assembles
 * `phiGuardFor`'s (`@werf/domain`) inputs from this device's own caches and runs the IDENTICAL pure
 * function the server runs (`crops.service.ts`'s `evaluatePhiGuard`); `useSprayPhiGuard`
 * (spray-side, further down) does the same for `sprayPhiGuardFor`/`evaluateSprayPhiGuard` — see
 * `phi-guard.ts`'s own module header for why both are one shared implementation rather than the
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
  sprayPhiGuardFor,
  type PhiGuardResult,
  type PhiProductFact,
  type PhiSprayFact,
  type SprayPhiGuardResult,
} from '@werf/domain';
import { useEffectiveSprays, type StoredSpray } from './LocalSprays';
import { useChemicalProducts } from './LocalChemicalProducts';
import { useCurrentPlanting } from './LocalPlantings';
import { useEffectiveLandUnits } from '../land/LocalLand';
import { farmToday } from '../farmTime';

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

/**
 * The spray-side half of § 4.3 (`sprayPhiGuardFor`): blocked locally against the block's OWN
 * planted-in-the-ground read (`useCurrentPlanting`, `LocalPlantings.tsx` — ancestor-UNBOUNDED per
 * FR-202, unlike the harvest guard's per-hop spray bound above, a different question with a
 * different, already-decided answer). `phiDays` is `undefined` until a product is picked, or when
 * the picked product carries no PHI on record — either way the guard is never even evaluated,
 * mirroring the server's own `product.phiDays !== null` gate (`crops.service.ts`'s `recordSpray`).
 */
export function useSprayPhiGuard(
  landUnitId: string,
  sprayedOn: string,
  phiDays: number | undefined,
): SprayPhiGuardResult {
  const planting = useCurrentPlanting(landUnitId);

  return useMemo(() => {
    if (phiDays === undefined) return { blocked: false };
    return sprayPhiGuardFor(sprayedOn, phiDays, planting?.expectedHarvestDate);
  }, [sprayedOn, phiDays, planting]);
}

/**
 * The Sprays home tile's attention badge, as a PURE function over block ids — `phiGuardFor`'s own
 * inputs plus `today`, tested directly (`usePhiGuard.test.ts`) rather than through a rendered
 * hook, the identical split `phiRegister.ts`'s `localPhiFlags`/`useLocalPhiFlags` already draws.
 *
 * Runs the SAME `phiGuardFor` every other PHI consumer in this file runs, against `today` rather
 * than a specific harvest date — never a second, narrower rule. `reason: 'unresolved'` does NOT
 * count here: an unconfirmed spray this device cannot vouch for is a real gap (disclosed on the
 * harvest guard itself, which blocks on it), but it is not the fact this badge states — "currently
 * inside an active pre-harvest interval" — so counting it in would overstate what the tile can
 * actually compute.
 */
export function blocksWithinPhi(
  blockIds: readonly string[],
  today: string,
  sprays: readonly PhiSprayFact[],
  products: readonly PhiProductFact[],
): readonly string[] {
  return blockIds.filter((id) => {
    const guard = phiGuardFor(id, today, sprays, products, []);
    return guard.blocked && guard.reason === 'active_phi';
  });
}

/**
 * The Sprays home tile's attention badge (FR-017, phase-checklists.md Phase 4's "crop home
 * metrics" line): how many BLOCKS this device can currently see are inside an active PHI, i.e.
 * `phiGuardFor(block, today, …)` would block a harvest right now. Deliberately "N within PHI",
 * never "N due" — a due/overdue count would need a spray SCHEDULE this domain doesn't have, the
 * identical reasoning `tile.withholding` already documents for the Health tile one domain over.
 */
export function useBlocksWithinPhiCount(): number {
  const units = useEffectiveLandUnits();
  const sprayFacts = useSprayFacts();
  const productFacts = useProductFacts();
  const blockIds = useMemo(() => units.filter((u) => u.kind === 'block').map((u) => u.id), [units]);

  return useMemo(
    () => blocksWithinPhi(blockIds, farmToday(), sprayFacts, productFacts).length,
    [blockIds, sprayFacts, productFacts],
  );
}
