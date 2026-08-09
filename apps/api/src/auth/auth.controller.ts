/**
 * The auth endpoints. Thin: parse, delegate, return. All the judgement lives in
 * AuthService and SessionService, which are testable without HTTP.
 */

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Patch,
  Post,
  Req,
  Res,
  UsePipes,
} from '@nestjs/common';
import { SessionInvalidError, schemas } from '@werf/core';
import type { Request, Response } from 'express';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  LoginRateLimit,
  RefreshRateLimit,
  RegistrationRateLimit,
  SecondFactorRateLimit,
} from '../security/rate-limits';
import { Public, type AuthContext } from './auth.guard';
import { CurrentUser } from './current-user.decorator';
import { AuthService } from './auth.service';
import { attachSessionCookie, clearSessionCookie, sessionTokenFrom } from './session-cookie';

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  /** Register a business, its first farm, its enterprises, and the owner (FR-001, FR-002). */
  @Public()
  @RegistrationRateLimit()
  @Post('register')
  @UsePipes(new ZodValidationPipe(schemas.registerRequestSchema))
  async register(
    @Body() body: schemas.RegisterRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<schemas.BrowserAuthSession> {
    return attachSessionCookie(response, await this.auth.register(body));
  }

  /** 200, not 201: a login creates a session but the caller is asking about themselves. */
  @Public()
  @LoginRateLimit()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(schemas.loginRequestSchema))
  async login(
    @Body() body: schemas.LoginRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<schemas.BrowserAuthSession | schemas.SecondFactorRequired> {
    const result = await this.auth.login(body);
    return 'secondFactorRequired' in result ? result : attachSessionCookie(response, result);
  }

  @Public()
  @RefreshRateLimit()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<schemas.BrowserAuthSession> {
    const token = sessionTokenFrom(request);
    if (!token) throw new SessionInvalidError('unknown');
    return attachSessionCookie(response, await this.auth.refresh(token));
  }

  /**
   * Completes a login that stopped at the second factor (FR-014).
   *
   * Public, like login: the caller holds a challenge token, not a session, and that token
   * is the only thing authorising this call. It is spent on the attempt either way.
   */
  @Public()
  @SecondFactorRateLimit()
  @Post('2fa/verify')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(schemas.verifySecondFactorRequestSchema))
  async verifySecondFactor(
    @Body() body: schemas.VerifySecondFactorRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<schemas.BrowserAuthSession> {
    return attachSessionCookie(response, await this.auth.verifySecondFactor(body));
  }

  /**
   * Update your own preferences (FR-008). NOT public — the account is the authenticated caller, so
   * there is no id in the body and no way to aim this at someone else. Returns the account as the
   * client should now cache it, so a language change survives the next cold start instead of being
   * reverted by the boot path that re-adopts the stored locale.
   */
  @Patch('profile')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(schemas.updateProfileRequestSchema))
  async updateProfile(
    @CurrentUser() auth: AuthContext,
    @Body() body: schemas.UpdateProfileRequest,
  ): Promise<schemas.AuthSession['user']> {
    return this.auth.updateProfile(auth.userId, body);
  }

  /** Idempotent: logging out an already-dead session is the state the caller wanted. */
  @Public()
  @RefreshRateLimit()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const token = sessionTokenFrom(request);
    // Clear first: an absent/expired server record must not keep this browser signed in.
    clearSessionCookie(response);
    if (token) await this.auth.logout(token);
  }
}
