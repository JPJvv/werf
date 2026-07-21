import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FarmsController } from './farms.controller';
import { FarmsService } from './farms.service';

@Module({
  // AuthModule for the guard's TokenService/SessionService, not for the auth endpoints.
  imports: [AuthModule],
  controllers: [FarmsController],
  providers: [FarmsService],
})
export class FarmsModule {}
