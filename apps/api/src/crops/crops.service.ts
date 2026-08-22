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
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { events, inventoryItems, landUnits, type AppDb } from '@werf/db';
import { NotFoundError, type schemas } from '@werf/core';
import {
  ancestorChainOf,
  phiGuardFor,
  recordFertiliser,
  recordHarvest,
  recordPlanting,
  recordSpray,
  type PhiGuardResult,
  type PhiLandUnitFact,
  type PhiSprayFact,
} from '@werf/domain';
import { APP_DB } from '../db/db.module';
import {
  assertCanCapture,
  findEvent,
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

      const already = await findEvent(tx, input.farmId, input.id);
      if (already) return already;
      await assertCropBlock(tx, input.farmId, input.landUnitId);

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

      const already = await findEvent(tx, input.farmId, input.id);
      if (already) return already;
      await assertCropBlock(tx, input.farmId, input.landUnitId);

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
        ...(input.inventoryLotId === undefined ? {} : { inventoryLotId: input.inventoryLotId }),
      });

      return insertEvent(tx, event);
    });
  }

  /** Record a farmer's spray fact. Product and PHI fields are farmer-entered snapshots. Werf
   * validates ownership and shape, calculates the interval date, and never authorises or blocks
   * the farming decision. */
  async recordSpray(userId: string, input: schemas.RecordSprayRequest): Promise<CapturedEvent> {
    return this.app.asUser(userId, async (tx) => {
      await assertCanCapture(tx, userId, input.farmId);

      // Idempotent BEFORE validation (mirrors `recordHarvest`'s own `findEvent` guard below): a
      // re-flushed spray must not re-run the guard against planting state that may have shifted
      // (a new/updated planting landed) since the first flush already committed it.
      const already = await findEvent(tx, input.farmId, input.id);
      if (already) return already;
      await assertCropBlock(tx, input.farmId, input.landUnitId);

      await assertFarmChemicalProduct(tx, input.farmId, input.productId);

      const event = recordSpray({
        id: input.id,
        farmId: input.farmId,
        landUnitId: input.landUnitId,
        occurredAt: input.occurredAt,
        sprayedOn: input.sprayedOn,
        productId: input.productId,
        productName: input.productName,
        notes: input.notes,
        createdBy: userId,
        ...(input.registrationNumber === undefined
          ? {}
          : { registrationNumber: input.registrationNumber }),
        ...(input.activeIngredients === undefined
          ? {}
          : { activeIngredients: input.activeIngredients }),
        ...(input.phiDays === undefined ? {} : { phiDays: input.phiDays }),
        ...(input.rateLPerHa === undefined ? {} : { rateLPerHa: input.rateLPerHa }),
        ...(input.waterLPerHa === undefined ? {} : { waterLPerHa: input.waterLPerHa }),
        ...(input.operator === undefined ? {} : { operator: input.operator }),
        ...(input.equipment === undefined ? {} : { equipment: input.equipment }),
        ...(input.windKph === undefined ? {} : { windKph: input.windKph }),
        ...(input.tempC === undefined ? {} : { tempC: input.tempC }),
        ...(input.targetPest === undefined ? {} : { targetPest: input.targetPest }),
        ...(input.inventoryLotId === undefined ? {} : { inventoryLotId: input.inventoryLotId }),
      });
      return insertEvent(tx, event);
    });
  }

  /**
   * Farmer-controlled spray history (FR-211): every spray this farm recorded, filtered by block
   * and/or date range and read straight from the append-only log. Werf does not send or certify it.
   *
   * ⭐ No "season" filter: this codebase's one existing season concept (`useSeasonRainfall`,
   * calendar-year-to-date) is a rainfall-specific convenience, not a general crop-season boundary —
   * a real season varies by crop and region (FR-210's own deferred rotation work would need to name
   * one). `from`/`to` on the spray day is the honest primitive; a season picker can be layered on
   * top of it later without changing this query.
   *
   * New records carry the farmer's product-name and optional registration snapshots. Historical
   * records remain readable without turning the legacy reference catalogue back into a gate.
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

      return sprays.map((s) => ({
        ...s,
        productName: s.productName,
        registrationNumber: s.registrationNumber,
      }));
    });
  }

  /** Record a harvest fact. Any PHI date shown on the device is advisory arithmetic over the
   * farmer's own inputs and never prevents this write. */
  async recordHarvest(userId: string, input: schemas.RecordHarvestRequest): Promise<CapturedEvent> {
    return this.app.asUser(userId, async (tx) => {
      await assertCanCapture(tx, userId, input.farmId);

      // Idempotent BEFORE validation (4d·7, mirrors recordMove/recordMobTally's `findEvent` guard,
      // `common/event-capture.ts`): a re-flushed harvest must not re-run the guard against state
      // that may have shifted since the first flush already committed it.
      const already = await findEvent(tx, input.farmId, input.id);
      if (already) return already;
      await assertCropBlock(tx, input.farmId, input.landUnitId);

      const event = recordHarvest({
        id: input.id,
        farmId: input.farmId,
        landUnitId: input.landUnitId,
        occurredAt: input.occurredAt,
        harvestedOn: input.harvestedOn,
        quantity: input.quantity,
        unit: input.unit,
        createdBy: userId,
        ...(input.grade === undefined ? {} : { grade: input.grade }),
        ...(input.destination === undefined ? {} : { destination: input.destination }),
      });
      return insertEvent(tx, event);
    });
  }

  /** Farmer-controlled harvest history, read from the same append-only facts available offline. */
  async listHarvestHistory(
    userId: string,
    farmId: string,
    filter: { readonly landUnitId?: string; readonly from?: string; readonly to?: string },
  ): Promise<HarvestHistoryRow[]> {
    return this.app.asUser(userId, async (tx) => {
      await assertCanCapture(tx, userId, farmId);

      const conditions = [
        eq(events.farmId, farmId),
        eq(events.type, 'harvest'),
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

      return rows
        .map((row) => toHarvestHistoryFacts(row))
        .filter((h): h is HarvestHistoryRow => h !== null)
        .filter(
          (h) =>
            (filter.from === undefined || h.harvestedOn >= filter.from) &&
            (filter.to === undefined || h.harvestedOn <= filter.to),
        );
    });
  }

  /**
   * Private PHI reminder history (legacy route name retained for compatibility). It re-derives
   * comparisons across synced devices from farmer-entered product snapshots. Results are advisory
   * and never cause a write refusal or external report.
   */
  async phiComplianceRegister(userId: string, farmId: string): Promise<PhiFlagRow[]> {
    return this.app.asUser(userId, async (tx) => {
      await assertCanCapture(tx, userId, farmId);

      const rows = await tx
        .select({
          id: events.id,
          landUnitId: events.landUnitId,
          occurredAt: events.occurredAt,
          payload: events.payload,
        })
        .from(events)
        .where(and(eq(events.farmId, farmId), eq(events.type, 'harvest'), isNull(events.deletedAt)))
        .orderBy(desc(events.occurredAt), desc(events.id));

      const register: PhiFlagRow[] = [];
      for (const row of rows) {
        const harvest = toHarvestHistoryFacts(row);
        if (harvest === null || harvest.landUnitId === null || harvest.phiOverride !== null) {
          continue;
        }
        const guard = await this.evaluatePhiGuard(
          tx,
          farmId,
          harvest.landUnitId,
          harvest.harvestedOn,
        );
        if (guard.blocked && guard.reason === 'active_phi') {
          register.push({
            eventId: harvest.id,
            landUnitId: harvest.landUnitId,
            harvestedOn: harvest.harvestedOn,
            productId: guard.blockedBy.productId,
            sprayedOn: guard.blockedBy.sprayedOn,
            earliestHarvestDate: guard.blockedBy.earliestHarvestDate,
          });
        }
      }
      return register;
    });
  }

  /**
   * The PHI guard's inputs, assembled from this farm's own data: every land unit (for the
   * ancestor-split bound) and every spray on `landUnitId`'s ancestor chain. Every server-read spray
   * is already resolved (`resolved: true`) — the event row IS the resolved answer (ADR-0005) — so
   * `phiGuardFor`'s offline-preview fallback never fires here; `products` is passed empty on
   * purpose (see `phi-guard.ts`'s own module note on why the client is different).
   */
  private async evaluatePhiGuard(
    tx: CaptureTx,
    farmId: string,
    landUnitId: string,
    harvestedOn: string,
  ): Promise<PhiGuardResult> {
    const unitRows = await tx
      .select({ id: landUnits.id, parentId: landUnits.parentId, createdAt: landUnits.createdAt })
      .from(landUnits)
      .where(and(eq(landUnits.farmId, farmId), isNull(landUnits.deletedAt)));
    const units: PhiLandUnitFact[] = unitRows.map((u) => ({
      id: u.id,
      parentId: u.parentId,
      createdAt: u.createdAt.toISOString(),
    }));
    const chain = ancestorChainOf(landUnitId, units);

    const sprayRows = chain.length
      ? await tx
          .select({
            landUnitId: events.landUnitId,
            occurredAt: events.occurredAt,
            payload: events.payload,
          })
          .from(events)
          .where(
            and(
              eq(events.farmId, farmId),
              eq(events.type, 'spray'),
              inArray(events.landUnitId, [...chain]),
              isNull(events.deletedAt),
            ),
          )
      : [];
    const sprays = sprayRows
      .map((row) => toPhiSprayFact(row))
      .filter((s): s is PhiSprayFact => s !== null);

    return phiGuardFor(landUnitId, harvestedOn, sprays, [], units);
  }
}

/** Tolerant per row, the same discipline `toSprayHistoryFacts` applies: a harvest whose product
 *  reference resolved differently across a schema change is skipped, never crashes the guard. */
function toPhiSprayFact(row: {
  landUnitId: string | null;
  occurredAt: Date;
  payload: unknown;
}): PhiSprayFact | null {
  if (row.landUnitId === null) return null;
  const payload = row.payload;
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Record<string, unknown>;
  const productId = p['productId'];
  const sprayedOn = p['sprayedOn'];
  if (typeof productId !== 'string' || typeof sprayedOn !== 'string') return null;
  const earliestHarvestDate = p['earliestHarvestDate'];

  return {
    landUnitId: row.landUnitId,
    occurredAt: row.occurredAt.toISOString(),
    sprayedOn,
    productId,
    resolved: true,
    ...(typeof earliestHarvestDate === 'string' ? { earliestHarvestDate } : {}),
  };
}

/** One row of FR-211's spray history report. */
export type SprayHistoryRow = SprayHistoryFacts;

interface SprayHistoryFacts {
  readonly id: string;
  readonly landUnitId: string | null;
  readonly occurredAt: Date;
  readonly sprayedOn: string;
  readonly productId: string;
  readonly productName: string | null;
  readonly registrationNumber: string | null;
  readonly activeIngredients: readonly string[];
  readonly phiDays: number | null;
  readonly earliestHarvestDate: string | null;
  readonly rateLPerHa: number | null;
  readonly waterLPerHa: number | null;
  readonly operator: string | null;
  readonly equipment: string | null;
  readonly windKph: number | null;
  readonly tempC: number | null;
  readonly targetPest: string | null;
  readonly phiOverride: { readonly reason: string; readonly by: string } | null;
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
  if (typeof productId !== 'string' || typeof sprayedOn !== 'string') {
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
    productName: str('productName'),
    registrationNumber: str('registrationNumber'),
    activeIngredients: Array.isArray(activeIngredients)
      ? activeIngredients.filter((v): v is string => typeof v === 'string')
      : [],
    phiDays: num('phiDays'),
    earliestHarvestDate: str('earliestHarvestDate'),
    rateLPerHa: num('rateLPerHa'),
    waterLPerHa: num('waterLPerHa'),
    operator: str('operator'),
    equipment: str('equipment'),
    windKph: num('windKph'),
    tempC: num('tempC'),
    targetPest: str('targetPest'),
    phiOverride: phiOverrideFrom(p['phiOverride']),
  };
}

function phiOverrideFrom(value: unknown): { reason: string; by: string } | null {
  if (typeof value !== 'object' || value === null) return null;
  const override = value as Record<string, unknown>;
  return typeof override['reason'] === 'string' && typeof override['by'] === 'string'
    ? { reason: override['reason'], by: override['by'] }
    : null;
}

/** Crop facts are legal only on a crop block, never on a grazing camp. */
async function assertCropBlock(tx: CaptureTx, farmId: string, landUnitId: string): Promise<void> {
  const [block] = await tx
    .select({ id: landUnits.id })
    .from(landUnits)
    .where(
      and(
        eq(landUnits.id, landUnitId),
        eq(landUnits.farmId, farmId),
        eq(landUnits.kind, 'block'),
        isNull(landUnits.deletedAt),
      ),
    );
  if (!block) throw new NotFoundError('Block not found');
}

/** Product selection is a farm-owned bookkeeping reference, not a regulatory lookup. */
async function assertFarmChemicalProduct(
  tx: CaptureTx,
  farmId: string,
  productId: string,
): Promise<void> {
  const [product] = await tx
    .select({ id: inventoryItems.id })
    .from(inventoryItems)
    .where(
      and(
        eq(inventoryItems.id, productId),
        eq(inventoryItems.farmId, farmId),
        eq(inventoryItems.category, 'chemical'),
        isNull(inventoryItems.deletedAt),
      ),
    );
  if (!product) throw new NotFoundError('Farm product not found');
}

/** One row of the PHI compliance register (4d·6) — a harvest that, on the fullest evidence held
 *  now, falls inside an active pre-harvest interval and carries no override. */
export interface PhiFlagRow {
  readonly eventId: string;
  readonly landUnitId: string;
  readonly harvestedOn: string;
  readonly productId: string;
  readonly sprayedOn: string;
  readonly earliestHarvestDate: string;
}

/** One row of FR-207's harvest history report. */
export interface HarvestHistoryRow {
  readonly id: string;
  readonly landUnitId: string | null;
  readonly occurredAt: Date;
  readonly harvestedOn: string;
  readonly quantity: number;
  readonly unit: string;
  readonly grade: string | null;
  readonly destination: string | null;
  readonly phiOverride: { readonly reason: string; readonly by: string } | null;
}

/** Tolerant per row, the same discipline `toSprayHistoryFacts` applies. */
function toHarvestHistoryFacts(row: {
  id: string;
  landUnitId: string | null;
  occurredAt: Date;
  payload: unknown;
}): HarvestHistoryRow | null {
  const payload = row.payload;
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Record<string, unknown>;
  const harvestedOn = p['harvestedOn'];
  const quantity = p['quantity'];
  const unit = p['unit'];
  if (typeof harvestedOn !== 'string' || typeof quantity !== 'number' || typeof unit !== 'string') {
    return null;
  }
  const str = (key: string): string | null =>
    typeof p[key] === 'string' ? (p[key] as string) : null;
  const override = p['phiOverride'];
  const phiOverride =
    typeof override === 'object' &&
    override !== null &&
    typeof (override as Record<string, unknown>)['reason'] === 'string' &&
    typeof (override as Record<string, unknown>)['by'] === 'string'
      ? {
          reason: (override as Record<string, unknown>)['reason'] as string,
          by: (override as Record<string, unknown>)['by'] as string,
        }
      : null;

  return {
    id: row.id,
    landUnitId: row.landUnitId,
    occurredAt: row.occurredAt,
    harvestedOn,
    quantity,
    unit,
    grade: str('grade'),
    destination: str('destination'),
    phiOverride,
  };
}
