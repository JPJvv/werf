/**
 * The auth endpoints. Thin: parse, delegate, return. All the judgement lives in
 * AuthService and SessionService, which are testable without HTTP.
 */

import { Body, Controller, HttpCode, HttpStatus, Inject, Post, UsePipes } from '@nestjs/common';
import { schemas } from '@werf/core';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  /** Register a business, its first farm, its enterprises, and the owner (FR-001, FR-002). */
  @Post('register')
  @UsePipes(new ZodValidationPipe(schemas.registerRequestSchema))
  async register(@Body() body: schemas.RegisterRequest): Promise<schemas.AuthSession> {
    return this.auth.register(body);
  }

  /** 200, not 201: a login creates a session but the caller is asking about themselves. */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(schemas.loginRequestSchema))
  async login(@Body() body: schemas.LoginRequest): Promise<schemas.LoginResponse> {
    return this.auth.login(body);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(schemas.refreshRequestSchema))
  async refresh(@Body() body: schemas.RefreshRequest): Promise<schemas.AuthSession> {
    return this.auth.refresh(body.refreshToken);
  }

  /** Idempotent: logging out an already-dead session is the state the caller wanted. */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UsePipes(new ZodValidationPipe(schemas.refreshRequestSchema))
  async logout(@Body() body: schemas.RefreshRequest): Promise<void> {
    await this.auth.logout(body.refreshToken);
  }
}
