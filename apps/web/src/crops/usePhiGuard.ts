/**
 * Private planning helpers. They calculate dates from farmer-entered spray/product facts and feed
 * reminders in the UI. A `blocked` domain result means "show a warning" here; capture is never
 * refused and no legal or product-authorisation claim is made.
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
import { useHydratedSprays } from './HydratedSprays';
import { useCurrentPlanting } from './LocalPlantings';
import { useEffectiveLandUnits } from '../land/LocalLand';
import { useEffectiveInventoryItems } from '../inventory/stock';
import { farmToday } from '../farmTime';

/**
 * `hydratedIds` — the raw hydrated-spray id set, same shape as `withdrawal.ts`'s
 * `hydratedAnimalIds` (STATUS.md §3, fail-closed) — is the ONLY reliable "has this spray
 * round-tripped through the server" signal. `activeIngredients` used to double as that
 * discriminator (its presence was required and non-empty on the wire), but this same PR relaxed
 * it to optional, so a confirmed spray with none entered would otherwise read as permanently
 * unresolved, and a local unsent one could borrow the flag from a stale merge.
 * `mergeByIdPreferHydrated` (`useEffectiveSprays`) already resolves the SAME id to its hydrated
 * copy when both exist, so membership in `hydratedIds` on the merged list correctly means
 * "server-confirmed," never "was confirmed once, might be stale now."
 *
 * ⭐ NOT DEFAULTED, deliberately — a caller with nothing to say about hydration state must pass an
 * explicit empty `Set`, not silently inherit one. `resolved: false` (this device cannot currently
 * PROVE the spray round-tripped) is the SAME safe posture whether that is because hydration has
 * not settled yet, has settled but genuinely found nothing, or has settled and FAILED
 * (`useHydratedSpraysSettled`/`useHydratedSpraysHydrationFailed`, `HydratedSprays.tsx`) — in every
 * case the guard falls through to the offline PREVIEW/`unresolved` path below, never to "confirmed,
 * no PHI" (`phi-guard.ts`'s `resolved: true` + no `earliestHarvestDate` branch). That can show a
 * transient or, on a permanent hydration failure, a lasting "cannot calculate" reminder for a spray
 * that in truth carries no PHI at all — an honest under-claim, not a false all-clear, and the
 * correct direction to be wrong in for a food-safety-adjacent reminder that must never silently
 * skip a possible PHI.
 */
export function sprayFactsOf(
  sprays: readonly StoredSpray[],
  hydratedIds: ReadonlySet<string>,
): readonly PhiSprayFact[] {
  return sprays.map((spray) => ({
    landUnitId: spray.landUnitId,
    occurredAt: spray.occurredAt,
    sprayedOn: spray.sprayedOn,
    productId: spray.productId,
    resolved: hydratedIds.has(spray.id),
    ...(spray.earliestHarvestDate === undefined
      ? {}
      : { earliestHarvestDate: spray.earliestHarvestDate }),
  }));
}

/** This device's own spray evidence, local+hydrated merged — the identical shape `usePhiGuard` and
 *  `phiRegister.ts`'s local derivation both read. */
export function useSprayFacts(): readonly PhiSprayFact[] {
  const sprays = useEffectiveSprays();
  const hydrated = useHydratedSprays();
  const hydratedIds = useMemo(() => new Set(hydrated.map((spray) => spray.id)), [hydrated]);
  return useMemo(() => sprayFactsOf(sprays, hydratedIds), [sprays, hydratedIds]);
}

export function useProductFacts(): readonly PhiProductFact[] {
  const products = useEffectiveInventoryItems();
  return useMemo(
    () =>
      products
        .filter((product) => product.category === 'chemical')
        .map((product) => ({ id: product.id, phiDays: product.phiDays ?? null })),
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
 * Compare a farmer-entered interval with the farmer's planned harvest date. The result is advisory.
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
 * harvest reminder itself), but it is not the fact this badge states — "currently
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
 * `phiGuardFor(block, today, …)` would warn about a harvest right now. Deliberately "N within PHI",
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
