import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule, minutes, seconds } from '@nestjs/throttler';
import { AttachmentsModule } from './attachments/attachments.module';
import { AuthModule } from './auth/auth.module';
import { DbModule } from './db/db.module';
import { FarmsModule } from './farms/farms.module';
import { LandModule } from './land/land.module';
import { LivestockModule } from './livestock/livestock.module';
import { RainfallModule } from './rainfall/rainfall.module';
import { ReferenceModule } from './reference/reference.module';
import { MailModule } from './mail/mail.module';
import { SyncModule } from './sync/sync.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      // Broad API abuse protection. Authentication routes override both named windows with the
      // tighter budgets in security/rate-limits.ts.
      {
        name: 'burst',
        ttl: seconds(1),
        limit: 30,
        blockDuration: seconds(10),
      },
      {
        name: 'sustained',
        ttl: minutes(1),
        limit: 300,
        blockDuration: minutes(1),
      },
    ]),
    DbModule,
    // Global: mail is a cross-cutting capability the farms module needs today (FR-005), and
    // payroll and the compliance packs will need in their phases.
    MailModule,
    AuthModule,
    AttachmentsModule,
    FarmsModule,
    LandModule,
    LivestockModule,
    RainfallModule,
    ReferenceModule,
    SyncModule,
  ],
  controllers: [HealthController],
  providers: [
    // Global, so a newly added route is limited by default. Public is an authentication concept;
    // it must never also mean unmetered.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
