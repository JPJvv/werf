import { Controller, Get, Inject } from '@nestjs/common';
import { schemas } from '@werf/core';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthContext } from '../auth/auth.guard';
import { TokenService } from '../auth/token.service';
import { APP_CONFIG } from '../db/db.module';
import type { AppConfig } from '../config/config';

// No @UseGuards: AuthGuard is registered globally (AuthModule) — see farms.controller.ts's
// own comment for why that default matters here specifically. A PowerSync token grants read
// access to a farm's replicated data for the token's lifetime, so this route needs the SAME
// full posture as everything else: a live session AND (FR-014) a satisfied second factor.
@Controller('sync')
export class SyncController {
  constructor(
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('token')
  async token(@CurrentUser() user: AuthContext): Promise<schemas.PowerSyncCredentialsResponse> {
    const { token, expiresAt } = await this.tokens.signPowerSyncToken(user.userId);
    return {
      token,
      endpoint: this.config.powerSyncUrl,
      expiresAt: expiresAt.toISOString(),
    };
  }
}
