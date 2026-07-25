import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { DbModule } from './db/db.module';
import { FarmsModule } from './farms/farms.module';
import { LandModule } from './land/land.module';
import { LivestockModule } from './livestock/livestock.module';
import { RainfallModule } from './rainfall/rainfall.module';
import { ReferenceModule } from './reference/reference.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    DbModule,
    AuthModule,
    FarmsModule,
    LandModule,
    LivestockModule,
    RainfallModule,
    ReferenceModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
