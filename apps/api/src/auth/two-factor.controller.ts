/**
 * Second-factor enrolment (FR-014, FR-014a).
 *
 * Both routes require a real session — you enrol as yourself, never on behalf of a user
 * id in a request body — and both carry `@AllowsPendingEnrolment()`, because they are the
 * only doors an owner who has not enrolled yet is allowed through.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { schemas } from '@werf/core';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthCeremonyRateLimit, SecondFactorRateLimit } from '../security/rate-limits';
import { AllowsPendingEnrolment, Public, RequiresRecentAuthentication } from './auth.guard';
import { CurrentUser } from './current-user.decorator';
import type { AuthContext } from './auth.guard';
import { AuthService } from './auth.service';
import { attachSessionCookie } from './session-cookie';
import { authAuditContextFrom } from './auth-audit';
import { PasskeyService } from './passkey.service';
import { TwoFactorService } from './two-factor.service';

@Controller('auth/2fa')
export class TwoFactorController {
  constructor(
    @Inject(TwoFactorService) private readonly twoFactor: TwoFactorService,
    @Inject(PasskeyService) private readonly passkeys: PasskeyService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  /**
   * Starts TOTP enrolment. Returns the secret and the `otpauth://` URI for the QR code —
   * the one response in the system that carries a seed, and it is never repeatable: a
   * second call while an authenticator is already enrolled is a conflict, not a re-read.
   */
  @AllowsPendingEnrolment()
  @RequiresRecentAuthentication()
  @AuthCeremonyRateLimit()
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
  @SecondFactorRateLimit()
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

  /**
   * Begins passkey enrolment — ADR-0007's preferred factor. Returns the options the
   * browser hands to `navigator.credentials.create()`.
   */
  @AllowsPendingEnrolment()
  @RequiresRecentAuthentication()
  @AuthCeremonyRateLimit()
  @Post('passkey')
  @HttpCode(HttpStatus.OK)
  async beginPasskey(@CurrentUser() user: AuthContext): Promise<schemas.PasskeyCeremonyOptions> {
    return this.passkeys.beginRegistration(user.userId);
  }

  /** Completes passkey enrolment. The attestation is verified against OUR challenge. */
  @AllowsPendingEnrolment()
  @AuthCeremonyRateLimit()
  @Post('passkey/confirm')
  @HttpCode(HttpStatus.OK)
  async confirmPasskey(
    @CurrentUser() user: AuthContext,
    @Body(new ZodValidationPipe(schemas.passkeyRegistrationRequestSchema))
    body: schemas.PasskeyRegistrationRequest,
  ): Promise<schemas.PasskeyEnrolmentResponse> {
    return this.passkeys.finishRegistration(user.userId, body);
  }

  /** The devices that can open this account, so a lost phone can be revoked (FR-014c). */
  @Get('passkey')
  async listPasskeys(@CurrentUser() user: AuthContext): Promise<schemas.PasskeySummary[]> {
    return this.passkeys.list(user.userId);
  }

  /**
   * Revokes one device (FR-014c). Scoped to the caller, so revoking is something you do
   * to your own keys; another user's id answers 404, not 403.
   */
  @Delete('passkey/:passkeyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokePasskey(
    @CurrentUser() user: AuthContext,
    @Param('passkeyId') passkeyId: string,
  ): Promise<void> {
    await this.passkeys.revoke(user.userId, passkeyId);
  }

  /**
   * Begins the authentication ceremony for a login that has passed the password.
   *
   * Public, like the other second-factor routes: the caller holds a challenge token, not
   * a session. That token is also what scopes the request — without it this endpoint
   * would answer "which passkeys does this address have?", which is an enumeration oracle.
   */
  @Public()
  @AuthCeremonyRateLimit()
  @Post('passkey/challenge')
  @HttpCode(HttpStatus.OK)
  async passkeyChallenge(
    @Body(new ZodValidationPipe(schemas.passkeyChallengeRequestSchema))
    body: schemas.PasskeyChallengeRequest,
  ): Promise<schemas.PasskeyCeremonyOptions> {
    return this.passkeys.beginAuthentication(body.challengeToken);
  }

  /** Completes a login with a passkey, returning the real session. */
  @Public()
  @SecondFactorRateLimit()
  @Post('passkey/verify')
  @HttpCode(HttpStatus.OK)
  async passkeyVerify(
    @Body(new ZodValidationPipe(schemas.passkeyAuthenticationRequestSchema))
    body: schemas.PasskeyAuthenticationRequest,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<schemas.BrowserAuthSession> {
    return attachSessionCookie(
      response,
      await this.auth.verifyPasskey(body, authAuditContextFrom(request)),
    );
  }
}
