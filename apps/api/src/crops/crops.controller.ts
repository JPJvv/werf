import { Body, Controller, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { schemas } from '@werf/core';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { CapturedEvent } from '../common/event-capture';
import type { AuthContext } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CropsService } from './crops.service';

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
}
