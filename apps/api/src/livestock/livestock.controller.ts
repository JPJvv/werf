import { Body, Controller, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { schemas } from '@werf/core';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { AuthContext } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { LivestockService, type CapturedAnimal, type CapturedEvent } from './livestock.service';

// No @UseGuards: AuthGuard is registered globally, so every route here is guarded by default.
@Controller('livestock')
export class LivestockController {
  constructor(@Inject(LivestockService) private readonly livestock: LivestockService) {}

  /**
   * Create an animal (FR-101). The FK root of the capture graph, so the client flush sends
   * animals before any event that references one. The body carries the client's own UUIDv7 and
   * the fields captured offline; the author is taken from the session, never the body. Idempotent
   * on the id — a re-flushed animal returns the stored row rather than a duplicate.
   */
  @Post('animals')
  @HttpCode(HttpStatus.CREATED)
  async recordAnimal(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(schemas.recordAnimalRequestSchema))
    body: schemas.RecordAnimalRequest,
  ): Promise<CapturedAnimal> {
    return this.livestock.recordAnimal(auth.userId, body);
  }

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

  /**
   * Record a death (FR-105) → the animal's status becomes 'dead'. An append-only event; the
   * animal it references must already exist (the flush sends animals first). Idempotent on the id.
   */
  @Post('deaths')
  @HttpCode(HttpStatus.CREATED)
  async recordDeath(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(schemas.recordDeathRequestSchema))
    body: schemas.RecordDeathRequest,
  ): Promise<CapturedEvent> {
    return this.livestock.recordDeath(auth.userId, body);
  }

  /**
   * Record a sale (FR-106) → the animal's status becomes 'sold'. An append-only event carrying
   * Money as integer cents; the animal must already exist. Idempotent on the id.
   */
  @Post('sales')
  @HttpCode(HttpStatus.CREATED)
  async recordSale(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(schemas.recordSaleRequestSchema))
    body: schemas.RecordSaleRequest,
  ): Promise<CapturedEvent> {
    return this.livestock.recordSale(auth.userId, body);
  }
}
