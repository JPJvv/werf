/**
 * The PHI (pre-harvest interval) guard (FR-205, US-030) — COMPLIANCE-GATED
 * (legal-compliance.md § 4.3, .claude/rules/domain.md). Blocks a harvest inside the withholding
 * period a block's own spray history creates, unless overridden (4d·2, a separate mechanism —
 * see `crops/harvest.ts`'s `phiOverride`).
 *
 * ⭐ ONE shared implementation, called identically by the API service (querying Postgres for its
 * inputs) and the client capture screen (reading the local/hydrated caches for the identical
 * shapes) — deliberately NOT the client/server split `apps/web/src/livestock/withdrawal.ts` uses
 * for FR-131. That split exists there for a real reason: a LOCAL dose and a HYDRATED dose are
 * structurally different SHAPES (`WithholdDose`'s own module note — one carries `productId`, the
 * other carries the resolved date and nothing else). This file's `PhiSprayFact` absorbs that same
 * asymmetry into ONE shape with an optional resolved date and a `resolved` flag, rather than
 * forcing two reimplementations of the same boundary to justify it — the earlier draft of this file
 * dropped `products` for that reason and O-12's own offline scenario (§ below) proved it wrong.
 *
 * Reuses `ancestorChainOf` (`land/ancestry.ts`) for the structural walk — see that file's header,
 * which already names this guard as one of its two callers and states the rule this file enforces:
 * an ancestor's spray applies to a descendant only when it happened before the SPECIFIC hop's split,
 * not before the leaf's own creation. A single leaf-wide bound is provably wrong (see `phiGuardFor`).
 *
 * ⭐ ONE ASYMMETRY REMAINS, and it is deliberate, named here so it is not mistaken for a miss: the
 * per-hop bound needs a land unit's `createdAt`, and the client's LOCAL land-unit capture
 * (`StoredLandUnit`, `apps/web/src/land/LocalLand.tsx`) never carries one — it is a server-assigned
 * instant, not something a client-authored capture has an opinion about, and a split block this
 * device made moments ago has none to give even from its own memory. Extending the hydrated
 * projection to carry it is real plumbing (a new SQL column, a schema widen, a regenerated sync
 * artifact) for a case — a block split AND harvested, both still offline — narrow enough that it is
 * filed as a follow-up (STATUS.md) rather than built here. The CLIENT caller therefore passes an
 * EMPTY `landUnits` list, which degrades `ancestorChainOf` to the leaf alone (its own header already
 * documents this as the designed behaviour for a partially-known device) — the client checks the
 * block's OWN spray history only, never an ancestor's. The SERVER caller (`crops.service.ts`) has
 * real `land_units` rows with real `createdAt` values and DOES check the full ancestor chain — it is
 * the authoritative backstop this asymmetry relies on, the same posture `withdrawal.ts` takes for
 * its own client/server split. The capture screen must disclose this gap on its own account for a
 * block with a non-null `parentId` (`RecordHarvestScreen.tsx`) rather than let a leaf-only "clear"
 * read as a confirmed answer about ground with a history the device cannot see.
 *
 * Pure (.claude/rules/domain.md): no I/O, no clock. Every fact — including "now" — is injected.
 */

import { ancestorChainOf, type LandUnitAncestryRow } from '../land/ancestry';
import { earliestHarvestDateFor } from './spray';

/**
 * One spray, as either caller can supply it — a DB row or a local/hydrated capture.
 *
 * ⭐ THE OFFLINE CASE THIS SHAPE EXISTS FOR: a farmer sprays a block and harvests it three days
 * later, still with no signal (O-12, the "Spray → PHI → blocked harvest, Offline" journey). That
 * spray has never round-tripped through the server, so it carries NO resolved
 * `earliestHarvestDate` at all — but the guard must still block, from the device's own cached
 * `chemical_products` register, the same PREVIEW `RecordSprayScreen`'s own `harvestPreview` already
 * computes for display. Refusing to vouch here (treating it as `'unresolved'`) would silently pass
 * an obviously-blocked harvest — the wrong direction for a food-safety boundary. `resolved: false`
 * is what routes the guard to that preview instead of failing closed outright.
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
  /** The ALREADY-RESOLVED clear date (ADR-0005 — computed once, at the spray's own capture, never
   *  recomputed here). Present = wins outright over any preview; a later re-registration must not
   *  move a historical block's harvest window. */
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
  /** This device cannot vouch for the block being clear — an unresolved spray's product is also
   *  missing from the local reference cache, so there is no preview to fall back to either. */
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
 *      found at all → FAIL-CLOSED (`reason: 'unresolved'`) — a device that cannot vouch for a
 *      spray's PHI, and has no preview to fall back to either, must never silently drop it from the
 *      fold as if it never happened.
 *
 * Multiple blocking sprays: the LATEST `earliestHarvestDate` (resolved or previewed) wins — a block
 * sprayed twice is held by whichever pre-harvest interval runs longest (mirrors `latestClearAcross`).
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
