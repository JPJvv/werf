import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MembershipExpiryService } from './membership-expiry.service';
import { SyncController } from './sync.controller';

/** Phase 3 sync boundary: mints the token a `PowerSyncBackendConnector` needs to `.connect()` and
 * bridges elapsed membership grants into the tombstone every stream can enforce. `TokenService`
 * (signing) and `AuthGuard` (the route's own protection, registered globally by AuthModule) both
 * come from importing AuthModule rather than being redeclared here. */
@Module({
  imports: [AuthModule],
  controllers: [SyncController],
  providers: [MembershipExpiryService],
})
export class SyncModule {}
