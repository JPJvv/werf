import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CropsController } from './crops.controller';
import { CropsService } from './crops.service';

@Module({
  // AuthModule for the global guard's TokenService/SessionService, not for the auth endpoints.
  imports: [AuthModule],
  controllers: [CropsController],
  providers: [CropsService],
})
export class CropsModule {}
