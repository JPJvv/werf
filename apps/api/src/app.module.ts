import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { DbModule } from './db/db.module';
import { FarmsModule } from './farms/farms.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [DbModule, AuthModule, FarmsModule],
  controllers: [HealthController],
})
export class AppModule {}
