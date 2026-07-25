import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LandController } from './land.controller';
import { LandService } from './land.service';

@Module({
  // AuthModule for the global guard's TokenService/SessionService, not for the auth endpoints.
  imports: [AuthModule],
  controllers: [LandController],
  providers: [LandService],
})
export class LandModule {}
