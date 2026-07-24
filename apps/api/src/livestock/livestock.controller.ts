import { Body, Controller, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { schemas } from '@werf/core';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { AuthContext } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { LivestockService, type CapturedEvent } from './livestock.service';

// No @UseGuards: AuthGuard is registered globally, so every route here is guarded by default.
@Controller('livestock')
export class LivestockController {
  constructor(@Inject(LivestockService) private readonly livestock: LivestockService) {}

  /**
   * Record a weight (FR-140). The body carries the client's own event id and the farm-local
   * `occurredAt`; the author is taken from the session, never the body. 201 with the persisted
   * event so the client can reconcile its optimistic local row.
   */
  @Post('weights')
  @HttpCode(HttpStatus.CREATED)
  async recordWeight(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(schemas.recordWeightRequestSchema))
    body: schemas.RecordWeightRequest,
  ): Promise<CapturedEvent> {
    return this.livestock.recordWeight(auth.userId, body);
  }
}
