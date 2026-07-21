/**
 * The auth endpoints. Thin: parse, delegate, return. All the judgement lives in
 * AuthService and SessionService, which are testable without HTTP.
 */

import { Body, Controller, HttpCode, HttpStatus, Inject, Post, UsePipes } from '@nestjs/common';
import { schemas } from '@werf/core';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Public } from './auth.guard';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  /** Register a business, its first farm, its enterprises, and the owner (FR-001, FR-002). */
  @Public()
  @Post('register')
  @UsePipes(new ZodValidationPipe(schemas.registerRequestSchema))
  async register(@Body() body: schemas.RegisterRequest): Promise<schemas.AuthSession> {
    return this.auth.register(body);
  }

  /** 200, not 201: a login creates a session but the caller is asking about themselves. */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(schemas.loginRequestSchema))
  async login(@Body() body: schemas.LoginRequest): Promise<schemas.LoginResponse> {
    return this.auth.login(body);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(schemas.refreshRequestSchema))
  async refresh(@Body() body: schemas.RefreshRequest): Promise<schemas.AuthSession> {
    return this.auth.refresh(body.refreshToken);
  }

  /**
   * Completes a login that stopped at the second factor (FR-014).
   *
   * Public, like login: the caller holds a challenge token, not a session, and that token
   * is the only thing authorising this call. It is spent on the attempt either way.
   */
  @Public()
  @Post('2fa/verify')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(schemas.verifySecondFactorRequestSchema))
  async verifySecondFactor(
    @Body() body: schemas.VerifySecondFactorRequest,
  ): Promise<schemas.AuthSession> {
    return this.auth.verifySecondFactor(body);
  }

  /** Idempotent: logging out an already-dead session is the state the caller wanted. */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UsePipes(new ZodValidationPipe(schemas.refreshRequestSchema))
  async logout(@Body() body: schemas.RefreshRequest): Promise<void> {
    await this.auth.logout(body.refreshToken);
  }
}
