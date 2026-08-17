/**
 * Regulated reference data, read (Phase 2, FR-131/614).
 *
 * Its own module rather than a livestock endpoint because reference data is not a livestock
 * concern: `chemical_products` for spray records lands here in the crop phase, and
 * `regulatory_rates` for payroll in the labour phase, all with the same two rules —
 *
 *  1. It is resolved by the FARM's jurisdiction, never the user's or the browser's
 *     (.claude/rules/domain.md, FR-019). A ZA farm reads ZA registrations and cannot borrow
 *     another country's (possibly shorter) withdrawal period.
 *  2. The client needs it OFFLINE. A farmer in a crush selecting a product has no signal, so the
 *     device holds a copy — which is why this is a plain list endpoint the client caches rather
 *     than a lookup it calls per capture. In Phase 3 the same rows arrive by sync as a
 *     reference-classified table; this endpoint is the Phase 2 stand-in, and the client above it
 *     does not change when that happens.
 *
 * ⭐ P1.3 (2026-08-14): `listVeterinaryProducts` returns EVERY version for the jurisdiction when
 * `onDay` is omitted, not just today's. A superseded registration still matters for two things the
 * device does offline: resolving the clear date of a treatment captured against it (the withdrawal
 * that applied is the one in force ON THE TREATMENT DAY, ADR-0005 — a device that evicted the old
 * row could not preview that date, or worse, could not tell "registered with no withdrawal" apart
 * from "I have never heard of this product" and pass it as clear) and letting a farmer catching up
 * after a fortnight offline select the version that was actually in force on the day they are
 * capturing FOR, not the version in force today. `onDay`, when given, still narrows to what was in
 * force on that one day — used by nothing today but kept and tested, since a caller that only ever
 * needs one day's answer should not have to filter a whole jurisdiction's history client-side.
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, isNull, lte, or } from 'drizzle-orm';
import {
  chemicalProducts,
  farms,
  speciesGestation,
  veterinaryProducts,
  type AppDb,
} from '@werf/db';
import { NotFoundError } from '@werf/core';
import { APP_DB } from '../db/db.module';
import { assertCanCapture, type CaptureTx } from '../common/event-capture';

/** What the client is given: everything it needs to select a product and show a clear date. */
const productProjection = {
  id: veterinaryProducts.id,
  jurisdiction: veterinaryProducts.jurisdiction,
  name: veterinaryProducts.name,
  registrationNumber: veterinaryProducts.registrationNumber,
  species: veterinaryProducts.species,
  meatWithdrawalDays: veterinaryProducts.meatWithdrawalDays,
  milkWithdrawalHours: veterinaryProducts.milkWithdrawalHours,
  route: veterinaryProducts.route,
  effectiveFrom: veterinaryProducts.effectiveFrom,
  effectiveTo: veterinaryProducts.effectiveTo,
} as const;

export type ReferenceVetProduct = {
  [K in keyof typeof productProjection]: (typeof veterinaryProducts.$inferSelect)[K];
};

/**
 * What the client is given for a gestation figure. `source` travels with it deliberately: a farmer
 * shown a projected calving date is entitled to the "says who?", and a figure whose provenance
 * stays on the server is a figure nobody can check.
 */
const gestationProjection = {
  species: speciesGestation.species,
  gestationDays: speciesGestation.gestationDays,
  source: speciesGestation.source,
} as const;

export type ReferenceSpeciesGestation = {
  [K in keyof typeof gestationProjection]: (typeof speciesGestation.$inferSelect)[K];
};

/** What the client is given to select a chemical product and preview a PHI clear date (FR-204). */
const chemicalProductProjection = {
  id: chemicalProducts.id,
  jurisdiction: chemicalProducts.jurisdiction,
  name: chemicalProducts.name,
  registrationNumber: chemicalProducts.registrationNumber,
  crop: chemicalProducts.crop,
  phiDays: chemicalProducts.phiDays,
  reentryHours: chemicalProducts.reentryHours,
  effectiveFrom: chemicalProducts.effectiveFrom,
  effectiveTo: chemicalProducts.effectiveTo,
} as const;

export type ReferenceChemicalProduct = {
  [K in keyof typeof chemicalProductProjection]: (typeof chemicalProducts.$inferSelect)[K];
};

@Injectable()
export class ReferenceService {
  constructor(@Inject(APP_DB) private readonly app: AppDb) {}

  /**
   * The veterinary products a farm may resolve a treatment against (FR-131), for the farm's
   * jurisdiction — every version ever registered when `onDay` is omitted (see this class's
   * header), or only the one in force on `onDay` when it is given.
   *
   * `onDay`, when given, is a parameter rather than `now()` for the same reason every regulated
   * lookup is: a client catching up after a fortnight offline may be asking for the day a
   * treatment HAPPENED, not for today. Resolved HERE, after the jurisdiction is known, so a caller
   * that does pass "today" means today ON THE FARM — the controller must never default it itself
   * (`toISOString().slice(0, 10)` between 00:00 and 02:00 SAST names yesterday).
   */
  async listVeterinaryProducts(
    userId: string,
    farmId: string,
    onDay?: string,
  ): Promise<ReferenceVetProduct[]> {
    return this.app.asUser(userId, async (tx) => {
      // Reference data is world-readable to any app connection, so the membership check here is
      // not protecting the rows — it is what makes the JURISDICTION answer trustworthy, since the
      // jurisdiction comes from a farm the caller must actually be on.
      await assertCanCapture(tx, userId, farmId);
      const jurisdiction = await farmJurisdiction(tx, farmId);
      const jurisdictionFilter = eq(veterinaryProducts.jurisdiction, jurisdiction);
      const where =
        onDay === undefined
          ? jurisdictionFilter
          : and(
              jurisdictionFilter,
              lte(veterinaryProducts.effectiveFrom, onDay),
              or(isNull(veterinaryProducts.effectiveTo), gt(veterinaryProducts.effectiveTo, onDay)),
            );

      return tx
        .select(productProjection)
        .from(veterinaryProducts)
        .where(where)
        .orderBy(veterinaryProducts.name, veterinaryProducts.effectiveFrom);
    });
  }

  /**
   * The species gestation figures a due-date projection is made from (FR-121).
   *
   * Unlike every other reference read here there is NO jurisdiction filter and NO `onDay`, because
   * this is biology rather than law: a gestation period neither stops at a border nor changes on a
   * date a Gazette names. The membership check stays all the same — "filtered by nothing" is not
   * "granted to anyone", and a caller with no farm has no business pulling a table.
   *
   * A species with no row is not an oversight (`poultry` does not gestate; `game` is a category
   * spanning a hundred days of variation). The absent row is what stops a screen offering breeding
   * capture for them and what makes `gestationDaysFor` refuse rather than invent.
   */
  async listSpeciesGestation(userId: string, farmId: string): Promise<ReferenceSpeciesGestation[]> {
    return this.app.asUser(userId, async (tx) => {
      await assertCanCapture(tx, userId, farmId);
      return tx
        .select(gestationProjection)
        .from(speciesGestation)
        .orderBy(asc(speciesGestation.species));
    });
  }

  /**
   * The chemical products a farm may resolve a spray against (FR-204/FR-508), for the farm's
   * jurisdiction — every version ever registered when `onDay` is omitted, or only the one in force
   * on `onDay` when it is given. Same P1.3 discipline as `listVeterinaryProducts` (this class's
   * header) and for the identical reason: a spray captured against a since-superseded registration
   * must still resolve the PHI that applied on the day it happened, not today's.
   */
  async listChemicalProducts(
    userId: string,
    farmId: string,
    onDay?: string,
  ): Promise<ReferenceChemicalProduct[]> {
    return this.app.asUser(userId, async (tx) => {
      await assertCanCapture(tx, userId, farmId);
      const jurisdiction = await farmJurisdiction(tx, farmId);
      const jurisdictionFilter = eq(chemicalProducts.jurisdiction, jurisdiction);
      const where =
        onDay === undefined
          ? jurisdictionFilter
          : and(
              jurisdictionFilter,
              lte(chemicalProducts.effectiveFrom, onDay),
              or(isNull(chemicalProducts.effectiveTo), gt(chemicalProducts.effectiveTo, onDay)),
            );

      return tx
        .select(chemicalProductProjection)
        .from(chemicalProducts)
        .where(where)
        .orderBy(chemicalProducts.name, chemicalProducts.effectiveFrom);
    });
  }
}

/** The law this farm operates under, through the RLS-bound connection. */
async function farmJurisdiction(tx: CaptureTx, farmId: string): Promise<string> {
  const [row] = await tx
    .select({ jurisdiction: farms.jurisdiction })
    .from(farms)
    .where(eq(farms.id, farmId));
  if (!row) throw new NotFoundError('Farm not found');
  return row.jurisdiction;
}
