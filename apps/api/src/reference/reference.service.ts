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
 * Only rows IN FORCE are returned. A registration that has been superseded still matters for
 * reading old events — the withdrawal that applied is the one stored on the event (ADR-0005) — but
 * it must not be offered as something to select today.
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, lte, or } from 'drizzle-orm';
import { farms, veterinaryProducts, type AppDb } from '@werf/db';
import { NotFoundError } from '@werf/core';
import { APP_DB } from '../db/db.module';
import { assertCanCapture, type CaptureTx } from '../common/event-capture';
import { farmToday } from '../common/farm-time';

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

@Injectable()
export class ReferenceService {
  constructor(@Inject(APP_DB) private readonly app: AppDb) {}

  /**
   * The veterinary products a farm may record a treatment against (FR-131), for the farm's
   * jurisdiction and in force on the given day.
   *
   * `onDay` is a parameter rather than `now()` for the same reason every regulated lookup is: a
   * client catching up after a fortnight offline is selecting for the day the treatment HAPPENED,
   * not for today. It defaults to today only because the common case is a device refreshing its
   * cache before it is used — and that default is resolved HERE, after the jurisdiction is known,
   * so it is today ON THE FARM. Defaulting it in the controller meant `toISOString().slice(0, 10)`,
   * which between 00:00 and 02:00 SAST names yesterday and resolves the register a day early.
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
      const day = onDay ?? farmToday(jurisdiction);

      return tx
        .select(productProjection)
        .from(veterinaryProducts)
        .where(
          and(
            eq(veterinaryProducts.jurisdiction, jurisdiction),
            lte(veterinaryProducts.effectiveFrom, day),
            or(isNull(veterinaryProducts.effectiveTo), gt(veterinaryProducts.effectiveTo, day)),
          ),
        )
        .orderBy(veterinaryProducts.name);
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
