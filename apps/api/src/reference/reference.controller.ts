import { Controller, Get, Inject, Query } from '@nestjs/common';
import { schemas } from '@werf/core';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { AuthContext } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import {
  ReferenceService,
  type ReferenceChemicalProduct,
  type ReferenceSpeciesGestation,
  type ReferenceVetProduct,
} from './reference.service';

/** The day to resolve registrations for. A calendar day, never coerced to an instant. */
const productQuerySchema = z.object({
  farmId: schemas.uuidSchema,
  onDay: schemas.dateSchema.optional(),
});

/**
 * Gestation is global reference data, so there is no day and no jurisdiction to resolve it for —
 * only the farm, which is here to prove membership rather than to filter anything.
 */
const gestationQuerySchema = z.object({ farmId: schemas.uuidSchema });

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

  /**
   * The species gestation figures (FR-121) this device projects due dates from. Cached by the
   * client for the same reason the product register is: a pregnancy diagnosis happens in a race
   * with no signal, and the whole value of projecting a calving date is that the farmer sees it
   * standing there rather than three weeks later.
   *
   * No `onDay` — biology does not change on a date, so there is nothing to resolve it for.
   */
  @Get('species-gestation')
  async listSpeciesGestation(
    @CurrentUser() auth: AuthContext,
    @Query(new ZodValidationPipe(gestationQuerySchema)) query: z.infer<typeof gestationQuerySchema>,
  ): Promise<ReferenceSpeciesGestation[]> {
    return this.reference.listSpeciesGestation(auth.userId, query.farmId);
  }

  /**
   * The chemical products this farm may record a spray against (FR-204/FR-508), resolved by the
   * FARM's jurisdiction and in force on `onDay`. The client caches the result so product selection
   * — and the PHI clear date it shows the farmer — works at the spray tank with no signal.
   */
  @Get('chemical-products')
  async listChemicalProducts(
    @CurrentUser() auth: AuthContext,
    @Query(new ZodValidationPipe(productQuerySchema)) query: z.infer<typeof productQuerySchema>,
  ): Promise<ReferenceChemicalProduct[]> {
    return this.reference.listChemicalProducts(auth.userId, query.farmId, query.onDay);
  }
}
