import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Query } from '@nestjs/common';
import { schemas } from '@werf/core';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { AuthContext } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { CapturedEvent } from '../common/event-capture';
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

  /**
   * Record a GPS boundary walk (FR-150) — the fence walked on foot, corner by corner.
   *
   * A separate route from the create above, not a field on it, because a camp is named at a gate
   * months before anyone walks its fence, and the create is idempotent on the id: re-sending the
   * camp with a boundary attached would be absorbed as a duplicate and the shape would never land.
   *
   * The body carries the FIXES, never the ring — the service derives the polygon from them so a
   * shape and its own evidence cannot disagree. `occurredAt` is when the fence was walked, which is
   * days before this arrives when the walk happened in a dead zone.
   */
  @Post('boundary-walks')
  @HttpCode(HttpStatus.CREATED)
  async recordBoundaryWalk(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(schemas.recordBoundaryWalkRequestSchema))
    body: schemas.RecordBoundaryWalkRequest,
  ): Promise<CapturedEvent> {
    return this.land.recordBoundaryWalk(auth.userId, body);
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
