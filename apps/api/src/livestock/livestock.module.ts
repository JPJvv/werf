import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AttachmentsModule } from '../attachments/attachments.module';
import { LivestockController } from './livestock.controller';
import { LivestockService } from './livestock.service';

@Module({
  // AuthModule for the global guard's TokenService/SessionService, not for the auth endpoints.
  // AttachmentsModule for OBJECT_STORAGE — the evidence-pack route fetches and checksum-verifies
  // a photo's bytes server-side before embedding it (P2.5).
  imports: [AuthModule, AttachmentsModule],
  controllers: [LivestockController],
  providers: [LivestockService],
})
export class LivestockModule {}
