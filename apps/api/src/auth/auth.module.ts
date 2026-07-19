import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';

@Module({
  // The secret is passed per-call from validated config rather than registered here, so
  // there is one place a signing key comes from and it is the one that was validated.
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, SessionService, TokenService],
  exports: [AuthService, SessionService, TokenService],
})
export class AuthModule {}
