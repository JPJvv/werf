import { Controller, Get, Inject, Query } from '@nestjs/common';
import { schemas } from '@werf/core';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { AuthContext } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ReferenceService, type ReferenceVetProduct } from './reference.service';

/** The day to resolve registrations for. A calendar day, never coerced to an instant. */
const productQuerySchema = z.object({
  farmId: schemas.uuidSchema,
  onDay: schemas.dateSchema.optional(),
});

// No @UseGuards: AuthGuard is registered globally, so every route here is guarded by default.
@Controller('reference')
export class ReferenceController {
  constructor(@Inject(ReferenceService) private readonly reference: ReferenceService) {}

  /**
   * The veterinary products this farm may record a treatment against (FR-131), resolved by the
   * FARM's jurisdiction and in force on `onDay`. The client caches the result so product selection
   * — and the clear date it shows the farmer — works in a crush with no signal.
   */
  @Get('veterinary-products')
  async listVeterinaryProducts(
    @CurrentUser() auth: AuthContext,
    @Query(new ZodValidationPipe(productQuerySchema)) query: z.infer<typeof productQuerySchema>,
  ): Promise<ReferenceVetProduct[]> {
    // No default here: "today" is a question only the service can answer, because it needs the
    // FARM's jurisdiction to know which day it is on the farm.
    return this.reference.listVeterinaryProducts(auth.userId, query.farmId, query.onDay);
  }
}
