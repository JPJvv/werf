import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { schemas } from '@werf/core';
import { z } from 'zod';
import type { AuthContext } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ConflictsService } from './conflicts.service';

const listQuerySchema = z.object({ farmId: schemas.uuidSchema });

@Controller('conflicts')
export class ConflictsController {
  constructor(private readonly conflicts: ConflictsService) {}

  @Get()
  listOpen(
    @CurrentUser() auth: AuthContext,
    @Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
  ): Promise<schemas.ConflictReviewJson[]> {
    return this.conflicts.listOpen(auth.userId, query.farmId);
  }

  @Post(':id/review')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markReviewed(
    @CurrentUser() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(schemas.reviewConflictRequestSchema))
    body: schemas.ReviewConflictRequest,
  ): Promise<void> {
    await this.conflicts.markReviewed(auth.userId, id, body);
  }
}
