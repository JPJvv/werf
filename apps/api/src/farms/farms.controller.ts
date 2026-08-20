import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { schemas } from '@werf/core';
import type { Request } from 'express';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { AuthContext } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { authAuditContextFrom } from '../auth/auth-audit';
import { FarmsService } from './farms.service';

// No @UseGuards: AuthGuard is registered globally (AuthModule), so this controller is
// guarded by default and would need an explicit @Public() to stop being.
@Controller('farms')
export class FarmsController {
  constructor(@Inject(FarmsService) private readonly farms: FarmsService) {}

  @Get()
  async list(@CurrentUser() auth: AuthContext): Promise<schemas.SessionFarm[]> {
    return this.farms.listForUser(auth.userId);
  }

  /** Another farm under a business the caller owns (FR-004). */
  @Post()
  async create(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(schemas.createFarmRequestSchema))
    body: schemas.CreateFarmRequest,
  ): Promise<schemas.SessionFarm> {
    return this.farms.createFarm(auth.userId, body);
  }

  /** Add or retire enterprise types — additively, with no data loss (FR-002, FR-003). */
  @Patch(':farmId/enterprise-types')
  async updateEnterpriseTypes(
    @CurrentUser() auth: AuthContext,
    @Param('farmId', ParseUUIDPipe) farmId: string,
    @Body(new ZodValidationPipe(schemas.updateEnterpriseTypesRequestSchema))
    body: schemas.UpdateEnterpriseTypesRequest,
  ): Promise<schemas.SessionFarm> {
    return this.farms.updateEnterpriseTypes(auth.userId, farmId, body);
  }

  /** Set or clear the FR-152 rest-period warning threshold (4e·2) — an owner-set preference. */
  @Patch(':farmId/rest-period-days')
  async updateRestPeriodDays(
    @CurrentUser() auth: AuthContext,
    @Param('farmId', ParseUUIDPipe) farmId: string,
    @Body(new ZodValidationPipe(schemas.updateRestPeriodDaysRequestSchema))
    body: schemas.UpdateRestPeriodDaysRequest,
  ): Promise<schemas.SessionFarm> {
    return this.farms.updateRestPeriodDays(auth.userId, farmId, body);
  }

  /**
   * Invite someone with a role on THIS farm (FR-005). The invitation grants nothing until
   * the invitee accepts, and the response is identical whether or not they already had an
   * account — see FarmsService.invite.
   */
  @Post(':farmId/members')
  async invite(
    @CurrentUser() auth: AuthContext,
    @Param('farmId', ParseUUIDPipe) farmId: string,
    @Body(new ZodValidationPipe(schemas.inviteUserRequestSchema))
    body: schemas.InviteUserRequest,
    @Req() request: Request,
  ): Promise<{ status: 'pending'; role: string }> {
    return this.farms.invite(auth.userId, farmId, body, authAuditContextFrom(request));
  }

  /** Accept an invitation addressed to you — the moment the membership becomes real. */
  @Post(':farmId/members/accept')
  @HttpCode(HttpStatus.NO_CONTENT)
  async acceptInvitation(
    @CurrentUser() auth: AuthContext,
    @Param('farmId', ParseUUIDPipe) farmId: string,
  ): Promise<void> {
    await this.farms.acceptInvitation(auth.userId, farmId);
  }

  /** Switch the active farm without re-authenticating (FR-004). */
  @Post('active')
  @HttpCode(HttpStatus.NO_CONTENT)
  async switchActive(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(schemas.switchFarmRequestSchema))
    body: schemas.SwitchFarmRequest,
    @Req() request: Request,
  ): Promise<void> {
    await this.farms.switchActiveFarm(
      auth.userId,
      auth.sessionId,
      body.farmId,
      authAuditContextFrom(request),
    );
  }
}
