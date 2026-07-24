import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { DbModule } from './db/db.module';
import { FarmsModule } from './farms/farms.module';
import { LivestockModule } from './livestock/livestock.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [DbModule, AuthModule, FarmsModule, LivestockModule],
  controllers: [HealthController],
})
export class AppModule {}
