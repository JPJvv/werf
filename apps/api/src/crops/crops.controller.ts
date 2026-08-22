import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Query } from '@nestjs/common';
import { schemas } from '@werf/core';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { CapturedEvent } from '../common/event-capture';
import type { AuthContext } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import {
  CropsService,
  type HarvestHistoryRow,
  type PhiFlagRow,
  type SprayHistoryRow,
} from './crops.service';

/** `landUnitId`/`from`/`to` narrow the report; `farmId` proves membership (FR-211). */
const sprayHistoryQuerySchema = z.object({
  farmId: schemas.uuidSchema,
  landUnitId: schemas.uuidSchema.optional(),
  from: schemas.dateSchema.optional(),
  to: schemas.dateSchema.optional(),
});

/** `landUnitId`/`from`/`to` narrow the report; `farmId` proves membership (FR-207) — same shape as
 *  the spray-history query, one report family over. */
const harvestHistoryQuerySchema = z.object({
  farmId: schemas.uuidSchema,
  landUnitId: schemas.uuidSchema.optional(),
  from: schemas.dateSchema.optional(),
  to: schemas.dateSchema.optional(),
});

// No @UseGuards: AuthGuard is registered globally, so every route here is guarded by default.
@Controller('crops')
export class CropsController {
  constructor(@Inject(CropsService) private readonly crops: CropsService) {}

  /**
   * Record a planting (FR-203). The body carries the client's own event id and the block it was
   * planted in; `occurredAt` is the planted date, days before this arrives when a farmer captures
   * in a dead zone. The author is taken from the session, never the body. Idempotent on the id, so
   * a re-flushed planting returns the stored event rather than a second one.
   */
  @Post('plantings')
  @HttpCode(HttpStatus.CREATED)
  async recordPlanting(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(schemas.recordPlantingRequestSchema))
    body: schemas.RecordPlantingRequest,
  ): Promise<CapturedEvent> {
    return this.crops.recordPlanting(auth.userId, body);
  }

  /**
   * Record a fertiliser application (FR-206), including fertigation. Same idempotency and
   * authorship discipline as a planting; no compliance gate on this one (see the service).
   */
  @Post('fertiliser-applications')
  @HttpCode(HttpStatus.CREATED)
  async recordFertiliser(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(schemas.recordFertiliserRequestSchema))
    body: schemas.RecordFertiliserRequest,
  ): Promise<CapturedEvent> {
    return this.crops.recordFertiliser(auth.userId, body);
  }

  /** Record the farmer's spray fact and calculator inputs. No regulatory authorisation occurs. */
  @Post('sprays')
  @HttpCode(HttpStatus.CREATED)
  async recordSpray(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(schemas.recordSprayRequestSchema))
    body: schemas.RecordSprayRequest,
  ): Promise<CapturedEvent> {
    return this.crops.recordSpray(auth.userId, body);
  }

  /**
   * Auditor-ready spray history (FR-211): every spray this farm recorded, optionally narrowed to
   * one block and/or a date range. One report, not the GlobalGAP checklist engine — see the
   * service for what that distinction means.
   */
  @Get('sprays')
  async listSprayHistory(
    @CurrentUser() auth: AuthContext,
    @Query(new ZodValidationPipe(sprayHistoryQuerySchema))
    query: z.infer<typeof sprayHistoryQuerySchema>,
  ): Promise<SprayHistoryRow[]> {
    return this.crops.listSprayHistory(auth.userId, query.farmId, {
      ...(query.landUnitId === undefined ? {} : { landUnitId: query.landUnitId }),
      ...(query.from === undefined ? {} : { from: query.from }),
      ...(query.to === undefined ? {} : { to: query.to }),
    });
  }

  /** Record a harvest fact. Farmer-entered PHI arithmetic never blocks the log. */
  @Post('harvests')
  @HttpCode(HttpStatus.CREATED)
  async recordHarvest(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(schemas.recordHarvestRequestSchema))
    body: schemas.RecordHarvestRequest,
  ): Promise<CapturedEvent> {
    return this.crops.recordHarvest(auth.userId, body);
  }

  /**
   * Auditor-ready harvest history (FR-207) — mirrors `listSprayHistory`; see the service for why
   * the client screen does not call this.
   */
  @Get('harvests')
  async listHarvestHistory(
    @CurrentUser() auth: AuthContext,
    @Query(new ZodValidationPipe(harvestHistoryQuerySchema))
    query: z.infer<typeof harvestHistoryQuerySchema>,
  ): Promise<HarvestHistoryRow[]> {
    return this.crops.listHarvestHistory(auth.userId, query.farmId, {
      ...(query.landUnitId === undefined ? {} : { landUnitId: query.landUnitId }),
      ...(query.from === undefined ? {} : { from: query.from }),
      ...(query.to === undefined ? {} : { to: query.to }),
    });
  }

  /** Private interval comparison over the farm's own entries. It is a reminder, not a compliance
   * report, and is visible only to members the farmer admitted to this farm. */
  @Get('phi-register')
  async phiComplianceRegister(
    @CurrentUser() auth: AuthContext,
    @Query(new ZodValidationPipe(z.object({ farmId: schemas.uuidSchema })))
    query: { farmId: string },
  ): Promise<PhiFlagRow[]> {
    return this.crops.phiComplianceRegister(auth.userId, query.farmId);
  }
}
