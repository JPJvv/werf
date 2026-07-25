import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { DbModule } from './db/db.module';
import { FarmsModule } from './farms/farms.module';
import { LandModule } from './land/land.module';
import { LivestockModule } from './livestock/livestock.module';
import { RainfallModule } from './rainfall/rainfall.module';
import { ReferenceModule } from './reference/reference.module';
import { MailModule } from './mail/mail.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    DbModule,
    // Global: mail is a cross-cutting capability the farms module needs today (FR-005), and
    // payroll and the compliance packs will need in their phases.
    MailModule,
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
