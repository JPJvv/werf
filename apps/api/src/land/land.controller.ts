import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Query } from '@nestjs/common';
import { schemas } from '@werf/core';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { AuthContext } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { LandService, type CapturedLandUnit } from './land.service';

const farmQuerySchema = z.object({ farmId: schemas.uuidSchema });

// No @UseGuards: AuthGuard is registered globally, so every route here is guarded by default.
@Controller('land-units')
export class LandController {
  constructor(@Inject(LandService) private readonly land: LandService) {}

  /**
   * Create a camp or a block (FR-150). The body carries the client's own UUIDv7 and the fields
   * captured at the gate; the author is taken from the session, never the body. The boundary
   * crosses the wire as GeoJSON — never PostGIS, which the device has no notion of — and the
   * service derives the canonical geometry from it. Idempotent on the id.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createLandUnit(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(schemas.newLandUnitSchema))
    body: schemas.NewLandUnit,
  ): Promise<CapturedLandUnit> {
    return this.land.createLandUnit(auth.userId, body);
  }

  /** The farm's camps and blocks (FR-150). A farm the caller is not on reads as "not found". */
  @Get()
  async listLandUnits(
    @CurrentUser() auth: AuthContext,
    @Query(new ZodValidationPipe(farmQuerySchema)) query: z.infer<typeof farmQuerySchema>,
  ): Promise<CapturedLandUnit[]> {
    return this.land.listLandUnits(auth.userId, query.farmId);
  }
}
