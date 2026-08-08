import { Body, Controller, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { schemas } from '@werf/core';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { CapturedEvent } from '../common/event-capture';
import type { AuthContext } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RainfallService } from './rainfall.service';

// No @UseGuards: AuthGuard is registered globally, so every route here is guarded by default.
@Controller('rainfall')
export class RainfallController {
  constructor(@Inject(RainfallService) private readonly rainfall: RainfallService) {}

  /**
   * Record a rain gauge reading (FR-213). The body carries the client's own event id and the
   * farm-local `occurredAt` — when the gauge was READ, which is days before this arrives when a
   * farmer captures in a dead zone. The author is taken from the session, never the body.
   * Idempotent on the id, so a re-flushed reading returns the stored event rather than a second
   * one; a duplicated reading would double a month's total.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async recordRainfall(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(schemas.recordRainfallRequestSchema))
    body: schemas.RecordRainfallRequest,
  ): Promise<CapturedEvent> {
    return this.rainfall.recordRainfall(auth.userId, body);
  }
}
