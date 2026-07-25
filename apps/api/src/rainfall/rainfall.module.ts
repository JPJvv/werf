import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RainfallController } from './rainfall.controller';
import { RainfallService } from './rainfall.service';

@Module({
  // AuthModule for the global guard's TokenService/SessionService, not for the auth endpoints.
  imports: [AuthModule],
  controllers: [RainfallController],
  providers: [RainfallService],
})
export class RainfallModule {}
