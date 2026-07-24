import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LivestockController } from './livestock.controller';
import { LivestockService } from './livestock.service';

@Module({
  // AuthModule for the global guard's TokenService/SessionService, not for the auth endpoints.
  imports: [AuthModule],
  controllers: [LivestockController],
  providers: [LivestockService],
})
export class LivestockModule {}
