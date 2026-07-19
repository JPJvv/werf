import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';
import { TwoFactorController } from './two-factor.controller';
import { TwoFactorService } from './two-factor.service';
import { PasskeyService } from './passkey.service';
import { RecoveryCodeService } from './recovery-code.service';

@Module({
  // The secret is passed per-call from validated config rather than registered here, so
  // there is one place a signing key comes from and it is the one that was validated.
  imports: [JwtModule.register({})],
  controllers: [AuthController, TwoFactorController],
  providers: [
    AuthService,
    SessionService,
    TokenService,
    TwoFactorService,
    PasskeyService,
    RecoveryCodeService,
    AuthGuard,
    // Registered GLOBALLY, so the default posture of any route anyone adds later is
    // "denied" and reaching the public ones takes a deliberate @Public(). Per-controller
    // @UseGuards has the opposite default: a new controller is wide open until somebody
    // remembers, and nobody remembers in the commit where it matters.
    { provide: APP_GUARD, useExisting: AuthGuard },
  ],
  exports: [
    AuthService,
    SessionService,
    TokenService,
    TwoFactorService,
    PasskeyService,
    RecoveryCodeService,
    AuthGuard,
  ],
})
export class AuthModule {}
