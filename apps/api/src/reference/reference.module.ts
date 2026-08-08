import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReferenceController } from './reference.controller';
import { ReferenceService } from './reference.service';

@Module({
  // AuthModule for the global guard's TokenService/SessionService, not for the auth endpoints.
  imports: [AuthModule],
  controllers: [ReferenceController],
  providers: [ReferenceService],
})
export class ReferenceModule {}
