import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { DbModule } from './db/db.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [DbModule, AuthModule],
  controllers: [HealthController],
})
export class AppModule {}
