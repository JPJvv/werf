/**
 * Second-factor enrolment (FR-014, FR-014a).
 *
 * Both routes require a real session — you enrol as yourself, never on behalf of a user
 * id in a request body — and both carry `@AllowsPendingEnrolment()`, because they are the
 * only doors an owner who has not enrolled yet is allowed through.
 */

import { Body, Controller, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { schemas } from '@werf/core';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AllowsPendingEnrolment } from './auth.guard';
import { CurrentUser } from './current-user.decorator';
import type { AuthContext } from './auth.guard';
import { TwoFactorService } from './two-factor.service';

@Controller('auth/2fa')
export class TwoFactorController {
  constructor(@Inject(TwoFactorService) private readonly twoFactor: TwoFactorService) {}

  /**
   * Starts TOTP enrolment. Returns the secret and the `otpauth://` URI for the QR code —
   * the one response in the system that carries a seed, and it is never repeatable: a
   * second call while an authenticator is already enrolled is a conflict, not a re-read.
   */
  @AllowsPendingEnrolment()
  @Post('totp')
  @HttpCode(HttpStatus.OK)
  async beginTotp(@CurrentUser() user: AuthContext): Promise<schemas.TotpEnrolmentStartResponse> {
    return this.twoFactor.beginTotpEnrolment(user.userId);
  }

  /**
   * Confirms enrolment with a code from the app and returns the recovery codes.
   *
   * 200 rather than 201: the codes in this body are shown once and never again (FR-014a),
   * and there is no resource here a client could re-fetch at a Location.
   */
  @AllowsPendingEnrolment()
  @Post('totp/confirm')
  @HttpCode(HttpStatus.OK)
  async confirmTotp(
    @CurrentUser() user: AuthContext,
    // Scoped to the parameter, not the handler: a handler-level @UsePipes would run this
    // body schema against the injected AuthContext too, and reject every call.
    @Body(new ZodValidationPipe(schemas.totpEnrolmentConfirmRequestSchema))
    body: schemas.TotpEnrolmentConfirmRequest,
  ): Promise<schemas.TotpEnrolmentConfirmResponse> {
    return this.twoFactor.confirmTotpEnrolment(user.userId, body.code);
  }
}
