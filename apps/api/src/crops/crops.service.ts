/**
 * Crop capture, Phase 4's own module — the server end of the offline flush for what happens ON a
 * block, as distinct from `LandService` (`land/`), which owns the ground itself (FR-150/FR-201/
 * FR-202: creating a block, walking its fence, splitting it). The same split `RainfallService`
 * already draws from `LandService`, for the same reason: a fact ABOUT a block and a fact about what
 * is grown IN it are different domains that happen to share a foreign key.
 *
 * The write discipline is the shared one (`common/event-capture`): everything runs through
 * `AppDb.asUser`, so RLS — not this file — is the tenancy boundary, and `insertEvent` is idempotent
 * on the client-generated id so an at-least-once flush never duplicates a planting. The block a
 * planting is pinned to is checked by `insertEvent` itself (`assertOwnedReferences`), the same as
 * rainfall's camp.
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm';
import { chemicalProducts, events, type AppDb } from '@werf/db';
import { NotFoundError, type schemas } from '@werf/core';
import { recordFertiliser, recordPlanting, recordSpray } from '@werf/domain';
import { APP_DB } from '../db/db.module';
import {
  assertCanCapture,
  farmJurisdiction,
  insertEvent,
  type CaptureTx,
  type CapturedEvent,
} from '../common/event-capture';

@Injectable()
export class CropsService {
  constructor(@Inject(APP_DB) private readonly app: AppDb) {}

  /**
   * Records a planting (FR-203) as an append-only `events` row. The pure domain function builds and
   * validates the event — the planted date IS `occurredAt`, there is no separate field for it — and
   * pins it to the block rather than a herd (FR-113's documented exception). This service supplies
   * only the I/O the domain cannot: the authenticated author and the RLS-bound insert.
   */
  async recordPlanting(
    userId: string,
    input: schemas.RecordPlantingRequest,
  ): Promise<CapturedEvent> {
    return this.app.asUser(userId, async (tx) => {
      await assertCanCapture(tx, userId, input.farmId);

      const event = recordPlanting({
        id: input.id,
        farmId: input.farmId,
        landUnitId: input.landUnitId,
        occurredAt: input.occurredAt,
        crop: input.crop,
        notes: input.notes,
        createdBy: userId,
        ...(input.cultivar === undefined ? {} : { cultivar: input.cultivar }),
        ...(input.density === undefined ? {} : { density: input.density }),
        ...(input.seedSource === undefined ? {} : { seedSource: input.seedSource }),
        ...(input.expectedHarvestDate === undefined
          ? {}
          : { expectedHarvestDate: input.expectedHarvestDate }),
      });

      return insertEvent(tx, event);
    });
  }

  /**
   * Records a fertiliser application (FR-206), including fertigation. No compliance gate applies —
   * unlike a spray, FR-206 names no reference product or withholding period, so this resolves
   * nothing server-side beyond the ordinary tenancy/FK checks every capture gets.
   */
  async recordFertiliser(
    userId: string,
    input: schemas.RecordFertiliserRequest,
  ): Promise<CapturedEvent> {
    return this.app.asUser(userId, async (tx) => {
      await assertCanCapture(tx, userId, input.farmId);

      const event = recordFertiliser({
        id: input.id,
        farmId: input.farmId,
        landUnitId: input.landUnitId,
        occurredAt: input.occurredAt,
        product: input.product,
        method: input.method,
        notes: input.notes,
        createdBy: userId,
        ...(input.rate === undefined ? {} : { rate: input.rate }),
        ...(input.operator === undefined ? {} : { operator: input.operator }),
      });

      return insertEvent(tx, event);
    });
  }

  /**
   * Records a spray to GlobalGAP standard (FR-204) — COMPLIANCE-GATED. The PHI is NOT taken from
   * the request: the server resolves the selected chemical product (by the FARM's jurisdiction, so
   * a ZA farm uses ZA registrations, and by the registration in force ON THE SPRAY DAY) and injects
   * its registered active ingredients and pre-harvest interval into the pure domain, which computes
   * the earliest-harvest date from the spray day and stores it ON the event. The rule that applied
   * is the rule at the time of the spray (ADR-0005): a later re-registration cannot move this
   * block's harvest window, because the date is already fixed here.
   */
  async recordSpray(userId: string, input: schemas.RecordSprayRequest): Promise<CapturedEvent> {
    return this.app.asUser(userId, async (tx) => {
      await assertCanCapture(tx, userId, input.farmId);
      const product = await resolveChemicalProduct(
        tx,
        input.farmId,
        input.productId,
        input.sprayedOn,
      );

      const event = recordSpray({
        id: input.id,
        farmId: input.farmId,
        landUnitId: input.landUnitId,
        occurredAt: input.occurredAt,
        sprayedOn: input.sprayedOn,
        productId: product.id,
        activeIngredients: product.activeIngredients,
        notes: input.notes,
        createdBy: userId,
        ...(product.phiDays === null ? {} : { phiDays: product.phiDays }),
        ...(input.rateLPerHa === undefined ? {} : { rateLPerHa: input.rateLPerHa }),
        ...(input.waterLPerHa === undefined ? {} : { waterLPerHa: input.waterLPerHa }),
        ...(input.operator === undefined ? {} : { operator: input.operator }),
        ...(input.equipment === undefined ? {} : { equipment: input.equipment }),
        ...(input.windKph === undefined ? {} : { windKph: input.windKph }),
        ...(input.tempC === undefined ? {} : { tempC: input.tempC }),
        ...(input.targetPest === undefined ? {} : { targetPest: input.targetPest }),
      });

      return insertEvent(tx, event);
    });
  }

  /**
   * Auditor-ready spray history (FR-211): every spray this farm recorded, filtered by block and/or
   * a date range, read straight off the append-only log the farmer already filed at capture — not
   * a separate report table to keep in step. This is the one report FR-211 asks for, not the
   * GlobalGAP checklist engine (control points, non-conformances, evidence completeness), which is
   * `legal-compliance.md` § 4.1's Phase 6 build requirement.
   *
   * ⭐ No "season" filter: this codebase's one existing season concept (`useSeasonRainfall`,
   * calendar-year-to-date) is a rainfall-specific convenience, not a general crop-season boundary —
   * a real season varies by crop and region (FR-210's own deferred rotation work would need to name
   * one). `from`/`to` on the spray day is the honest primitive; a season picker can be layered on
   * top of it later without changing this query.
   *
   * The registered product's NAME is resolved by joining back to `chemical_products` on the exact
   * `productId` the spray stored — never a fresh jurisdiction/date lookup, because `productId`
   * already names the exact registration VERSION that applied (`resolveChemicalProduct`'s own
   * result), so re-resolving it here could disagree with what was actually stored on the event.
   */
  async listSprayHistory(
    userId: string,
    farmId: string,
    filter: { readonly landUnitId?: string; readonly from?: string; readonly to?: string },
  ): Promise<SprayHistoryRow[]> {
    return this.app.asUser(userId, async (tx) => {
      await assertCanCapture(tx, userId, farmId);

      const conditions = [
        eq(events.farmId, farmId),
        eq(events.type, 'spray'),
        isNull(events.deletedAt),
      ];
      if (filter.landUnitId !== undefined)
        conditions.push(eq(events.landUnitId, filter.landUnitId));

      const rows = await tx
        .select({
          id: events.id,
          landUnitId: events.landUnitId,
          occurredAt: events.occurredAt,
          payload: events.payload,
        })
        .from(events)
        .where(and(...conditions))
        .orderBy(desc(events.occurredAt), desc(events.id));

      const sprays = rows
        .map((row) => toSprayHistoryFacts(row))
        .filter((s): s is SprayHistoryFacts => s !== null)
        // `sprayedOn` is the fact the range is about, not `occurredAt` — a back-dated capture's row
        // is written today but is a fact about an earlier day.
        .filter(
          (s) =>
            (filter.from === undefined || s.sprayedOn >= filter.from) &&
            (filter.to === undefined || s.sprayedOn <= filter.to),
        );

      const productIds = [...new Set(sprays.map((s) => s.productId))];
      const products = productIds.length
        ? await tx
            .select({
              id: chemicalProducts.id,
              name: chemicalProducts.name,
              registrationNumber: chemicalProducts.registrationNumber,
            })
            .from(chemicalProducts)
            .where(inArray(chemicalProducts.id, productIds))
        : [];
      const productById = new Map(products.map((p) => [p.id, p]));

      return sprays.map((s) => ({
        ...s,
        productName: productById.get(s.productId)?.name ?? null,
        registrationNumber: productById.get(s.productId)?.registrationNumber ?? null,
      }));
    });
  }
}

type ChemicalProduct = typeof chemicalProducts.$inferSelect;

/** One row of FR-211's spray history report. */
export interface SprayHistoryRow extends SprayHistoryFacts {
  readonly productName: string | null;
  readonly registrationNumber: string | null;
}

interface SprayHistoryFacts {
  readonly id: string;
  readonly landUnitId: string | null;
  readonly occurredAt: Date;
  readonly sprayedOn: string;
  readonly productId: string;
  readonly activeIngredients: readonly string[];
  readonly phiDays: number | null;
  readonly earliestHarvestDate: string | null;
  readonly rateLPerHa: number | null;
  readonly waterLPerHa: number | null;
  readonly operator: string | null;
  readonly equipment: string | null;
  readonly targetPest: string | null;
}

/** Tolerant per row: a spray event whose payload does not carry the fields this report needs (a
 *  row written by a future schema version) is skipped rather than crashing the whole report — the
 *  same discipline the client's hydration mappers already apply to reads off this same table. */
function toSprayHistoryFacts(row: {
  id: string;
  landUnitId: string | null;
  occurredAt: Date;
  payload: unknown;
}): SprayHistoryFacts | null {
  const payload = row.payload;
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Record<string, unknown>;
  const productId = p['productId'];
  const sprayedOn = p['sprayedOn'];
  const activeIngredients = p['activeIngredients'];
  if (
    typeof productId !== 'string' ||
    typeof sprayedOn !== 'string' ||
    !Array.isArray(activeIngredients)
  ) {
    return null;
  }
  const num = (key: string): number | null =>
    typeof p[key] === 'number' ? (p[key] as number) : null;
  const str = (key: string): string | null =>
    typeof p[key] === 'string' ? (p[key] as string) : null;

  return {
    id: row.id,
    landUnitId: row.landUnitId,
    occurredAt: row.occurredAt,
    sprayedOn,
    productId,
    activeIngredients: activeIngredients.filter((v): v is string => typeof v === 'string'),
    phiDays: num('phiDays'),
    earliestHarvestDate: str('earliestHarvestDate'),
    rateLPerHa: num('rateLPerHa'),
    waterLPerHa: num('waterLPerHa'),
    operator: str('operator'),
    equipment: str('equipment'),
    targetPest: str('targetPest'),
  };
}

/**
 * The registered chemical product a spray used, resolved by the FARM's jurisdiction AND the
 * registration in force ON THE SPRAY DAY — the source the active ingredients and PHI are injected
 * FROM, never typed into code (FR-204). Mirrors `resolveVetProduct` (`livestock.service.ts`)
 * exactly, one reference table over: date-versioned, so we resolve the version whose
 * `[effective_from, effective_to)` window contains `sprayedOn`. An unknown product, one in another
 * jurisdiction, or one not yet / no longer in force on that day reads as "not found".
 */
async function resolveChemicalProduct(
  tx: CaptureTx,
  farmId: string,
  productId: string,
  sprayedOn: string,
): Promise<ChemicalProduct> {
  const jurisdiction = await farmJurisdiction(tx, farmId);
  const [row] = await tx
    .select()
    .from(chemicalProducts)
    .where(
      and(
        eq(chemicalProducts.id, productId),
        eq(chemicalProducts.jurisdiction, jurisdiction),
        lte(chemicalProducts.effectiveFrom, sprayedOn),
        or(isNull(chemicalProducts.effectiveTo), gt(chemicalProducts.effectiveTo, sprayedOn)),
      ),
    );
  if (!row) throw new NotFoundError('Chemical product not found');
  return row;
}
