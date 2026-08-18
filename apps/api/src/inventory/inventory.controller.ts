import { Body, Controller, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { schemas } from '@werf/core';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { CapturedEvent } from '../common/event-capture';
import type { AuthContext } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { InventoryService } from './inventory.service';

// No @UseGuards: AuthGuard is registered globally, so every route here is guarded by default.
@Controller('inventory')
export class InventoryController {
  constructor(@Inject(InventoryService) private readonly inventory: InventoryService) {}

  /** Record an inventory item (FR-501) — the farm's own catalogue entry for a chemical, fertiliser,
   *  feed or medicine. Idempotent on the client id, like every other capture. */
  @Post('items')
  @HttpCode(HttpStatus.CREATED)
  async recordItem(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(schemas.newInventoryItemSchema))
    body: schemas.NewInventoryItem,
  ) {
    return this.inventory.recordItem(auth.userId, body);
  }

  /** Record a lot (FR-501) — a physical batch of an item, created empty and received into by a
   *  movement. */
  @Post('lots')
  @HttpCode(HttpStatus.CREATED)
  async recordLot(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(schemas.newInventoryLotSchema))
    body: schemas.NewInventoryLot,
  ) {
    return this.inventory.recordLot(auth.userId, body);
  }

  /** Record a stock movement (FR-501): received, consumed, or a physical count. */
  @Post('movements')
  @HttpCode(HttpStatus.CREATED)
  async recordMovement(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(schemas.recordInventoryMovementRequestSchema))
    body: schemas.RecordInventoryMovementRequest,
  ): Promise<CapturedEvent> {
    return this.inventory.recordMovement(auth.userId, body);
  }
}
