import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SyncController } from './sync.controller';

/** Phase 3 slice 3b/4: mints the token a `PowerSyncBackendConnector` needs to `.connect()`.
 * `TokenService` (signing) and `AuthGuard` (the route's own protection, registered globally by
 * AuthModule) both come from importing AuthModule rather than being redeclared here. */
@Module({
  imports: [AuthModule],
  controllers: [SyncController],
})
export class SyncModule {}
