/**
 * Farmer-configured PHI reminder arithmetic (FR-205, US-030).
 *
 * One pure implementation compares spray snapshots with planned or recorded harvest dates. It
 * handles land ancestry when the caller has that history and degrades to the known block while
 * offline. The result is advisory: callers may warn but must never block a farmer's record.
 */

import { ancestorChainOf, type LandUnitAncestryRow } from '../land/ancestry';
import { earliestHarvestDateFor } from './spray';

/**
 * One spray, as either caller can supply it — a DB row or a local/hydrated capture.
 *
 * The offline case this shape exists for: a spray not yet echoed by the server may have no stored
 * `earliestHarvestDate`. The device can still preview from the farmer's local product facts so the
 * reminder is useful without a signal. `resolved: false` selects that compatibility fallback.
 */
export interface PhiSprayFact {
  readonly landUnitId: string;
  /** The instant the spray was captured — used ONLY for the ancestor-split bound below, never for
   *  the PHI day arithmetic itself (that is `sprayedOn`, a farm-local day). */
  readonly occurredAt: string;
  /** The farm-local day sprayed — the base the PHI arithmetic runs against, whether resolved
   *  server-side or previewed from the local cache. */
  readonly sprayedOn: string;
  readonly productId: string;
  /** The capture-time reminder date. Present = wins outright so later catalogue edits do not
   *  rewrite historical arithmetic. */
  readonly earliestHarvestDate?: string;
  /**
   * Whether this spray's PHI question has been ANSWERED at all — true once it has round-tripped
   * through the server (whether or not that answer carries a PHI), and ALWAYS true for a fact read
   * server-side, because the stored event row IS the resolved answer there; there is no "pending"
   * state to represent. False = a local capture not yet confirmed (the same state
   * `StoredSpray.activeIngredients === undefined` marks, `LocalSprays.tsx`) — the guard falls back
   * to the PREVIEW described above rather than either trusting a computed-and-discarded answer or
   * refusing to vouch outright.
   */
  readonly resolved: boolean;
}

/** What the guard needs from a `chemical_products` row, for the offline PREVIEW fallback only —
 *  never consulted for a spray that already carries a resolved `earliestHarvestDate`. */
export interface PhiProductFact {
  readonly id: string;
  /** Null = registered, no PHI on record — a real, checkable fact, not a gap. */
  readonly phiDays: number | null;
}

/** A land unit, for the ancestor walk. `createdAt` is the instant it became its OWN capturable
 *  unit — the split moment a parent's later sprays must not be attributed across. */
export interface PhiLandUnitFact extends LandUnitAncestryRow {
  readonly createdAt: string;
}

export type PhiGuardResult =
  | { readonly blocked: false }
  | {
      readonly blocked: true;
      readonly reason: 'active_phi';
      readonly blockedBy: {
        readonly productId: string;
        readonly sprayedOn: string;
        readonly earliestHarvestDate: string;
      };
    }
  /** This device cannot calculate a date because the interval facts are missing. */
  | { readonly blocked: true; readonly reason: 'unresolved' };

/**
 * Whether a harvest on `landUnitId` on `harvestedOn` falls inside an active pre-harvest interval,
 * reading the block's own spray history AND (4d·4, mirroring the dose-reaches-an-animal defect,
 * `713634b`) every ancestor's pre-split spray history.
 *
 * ⭐ THE BOUND IS PER-HOP, NOT LEAF-WIDE. Walking chain `[L0=landUnitId, L1, L2, …]`, an ancestor
 * `Li`'s (i ≥ 1) spray applies only when `spray.occurredAt < createdAt(chain[i-1])` — the instant
 * the NEXT unit down the chain split off from `Li`. A single bound against the leaf's own
 * `createdAt` is wrong: a spray recorded on a grandparent AFTER the parent split but BEFORE the
 * leaf itself split would incorrectly count, because by then the parent's ground (and whatever the
 * grandparent did to ITS remaining ground afterwards) were already two different things. See
 * `land/ancestry.ts`'s own header, which names this exact case.
 *
 * Per spray, mirroring `withdrawal.ts`'s `clearDateFor` exactly:
 *   1. `earliestHarvestDate` present → the resolved answer, wins outright, no `products` lookup.
 *   2. Absent but `resolved: true` → confirmed, no PHI on record. Skip.
 *   3. Absent and `resolved: false` → look up `productId` in `products`: found with a non-null
 *      `phiDays` → PREVIEW via `earliestHarvestDateFor`; found with a null `phiDays` → skip; not
 *      found at all → `reason: 'unresolved'`, prompting an honest “cannot calculate” reminder.
 *
 * Multiple overlapping sprays: the latest entered reminder date wins.
 */
export function phiGuardFor(
  landUnitId: string,
  harvestedOn: string,
  sprays: readonly PhiSprayFact[],
  products: readonly PhiProductFact[],
  landUnits: readonly PhiLandUnitFact[],
): PhiGuardResult {
  const chain = ancestorChainOf(landUnitId, landUnits);
  const landUnitById = new Map(landUnits.map((unit) => [unit.id, unit]));
  const productById = new Map(products.map((product) => [product.id, product]));

  let unresolved = false;
  let latest: { productId: string; sprayedOn: string; earliestHarvestDate: string } | undefined;

  for (const spray of sprays) {
    const hop = chain.indexOf(spray.landUnitId);
    if (hop === -1) continue; // not this block, nor an ancestor of it

    if (hop > 0) {
      // The bound is the createdAt of the NEXT unit down the chain — the split this ancestor's
      // later sprays must not be attributed across. `chain[hop - 1]` is guaranteed present in
      // `landUnitById`: both are derived from the same `landUnits` array, and `ancestorChainOf`
      // only ever continues its walk past a unit once that unit's own record has been found in it
      // (see its header) — so every non-final chain element, which `chain[hop - 1]` always is,
      // resolves.
      const splitAt = landUnitById.get(chain[hop - 1]!)!.createdAt;
      if (spray.occurredAt >= splitAt) continue; // genuinely after the split — not this leaf's fact
    }

    let earliestHarvestDate: string;
    if (spray.earliestHarvestDate !== undefined) {
      earliestHarvestDate = spray.earliestHarvestDate;
    } else if (spray.resolved) {
      continue; // confirmed: this spray's product carries no PHI on record
    } else {
      const product = productById.get(spray.productId);
      if (product === undefined) {
        unresolved = true;
        continue;
      }
      if (product.phiDays === null) continue;
      earliestHarvestDate = earliestHarvestDateFor(spray.sprayedOn, product.phiDays);
    }

    if (harvestedOn >= earliestHarvestDate) continue;
    if (latest === undefined || earliestHarvestDate > latest.earliestHarvestDate) {
      latest = { productId: spray.productId, sprayedOn: spray.sprayedOn, earliestHarvestDate };
    }
  }

  if (latest !== undefined) return { blocked: true, reason: 'active_phi', blockedBy: latest };
  if (unresolved) return { blocked: true, reason: 'unresolved' };
  return { blocked: false };
}

export type SprayPhiGuardResult =
  | { readonly blocked: false }
  | {
      readonly blocked: true;
      readonly reason: 'active_phi';
      readonly earliestHarvestDate: string;
      readonly expectedHarvestDate: string;
    };

/**
 * Compare a farmer-entered interval with the block's farmer-entered planned harvest date. This is
 * an early planning reminder only. `phiGuardFor` performs the same arithmetic against an actual
 * harvest record; neither result approves or refuses a capture.
 *
 * `expectedHarvestDate` is the caller's job to resolve — `currentPlantingFor` (`planting.ts`) over
 * the block's own ancestor-unbounded planting history, the identical fold `useCurrentPlanting`
 * already reads for display. A block with no planned harvest on record (never planted, or the
 * farmer never gave one) cannot be compared with a plan it does not have.
 *
 * Inclusive on the clear day, the identical convention `phiGuardFor` uses for `harvestedOn` above: a
 * plan to harvest exactly on the day the PHI clears is not blocked.
 */
export function sprayPhiGuardFor(
  sprayedOn: string,
  phiDays: number,
  expectedHarvestDate: string | undefined,
): SprayPhiGuardResult {
  if (expectedHarvestDate === undefined) return { blocked: false };
  const earliestHarvestDate = earliestHarvestDateFor(sprayedOn, phiDays);
  if (expectedHarvestDate >= earliestHarvestDate) return { blocked: false };
  return { blocked: true, reason: 'active_phi', earliestHarvestDate, expectedHarvestDate };
}
