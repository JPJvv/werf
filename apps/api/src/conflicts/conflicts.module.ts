import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConflictsController } from './conflicts.controller';
import { ConflictsService } from './conflicts.service';

@Module({
  imports: [AuthModule],
  controllers: [ConflictsController],
  providers: [ConflictsService],
})
export class ConflictsModule {}
