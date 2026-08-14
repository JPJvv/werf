import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { APP_CONFIG } from '../db/db.module';
import type { AppConfig } from '../config/config';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';
import { AttachmentOrphanSweepService } from './attachment-orphan-sweep.service';
import { OBJECT_STORAGE, S3ObjectStorage, type ObjectStorage } from './object-storage';

/**
 * Wires the `ObjectStorage` port to its one adapter, chosen by configuration.
 *
 * Unlike `MailModule` (see its own header), there is no environment-gated degraded mode here: a
 * presigned upload with nowhere to presign against cannot silently no-op the way a logged-instead-
 * of-sent invitation can — there is no meaningful "attachments, but not really" state. So an unset
 * `OBJECT_STORAGE_BUCKET` throws at boot in every environment, not just production. A developer who
 * does not need attachments this session still gets a clear failure naming the missing variable,
 * rather than a working API that 500s the first time a farmer takes a photo.
 */
@Module({
  imports: [AuthModule],
  controllers: [AttachmentsController],
  providers: [
    AttachmentsService,
    AttachmentOrphanSweepService,
    {
      provide: OBJECT_STORAGE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): ObjectStorage => {
        if (config.objectStorage === null) {
          throw new Error(
            'Attachments require object storage to be configured: OBJECT_STORAGE_BUCKET, ' +
              '_ACCESS_KEY_ID and _SECRET_ACCESS_KEY (MinIO in dev — see docker-compose.yml, ' +
              'real S3 in af-south-1 in production).',
          );
        }
        return new S3ObjectStorage(config.objectStorage);
      },
    },
  ],
  // P2.5: LivestockModule needs the same port, to fetch+verify a photo's bytes server-side
  // before embedding it in the FR-603 evidence pack (`LivestockController.buildPhotoMap`) — the
  // exact same adapter `AttachmentsService` already reads/writes through, never a second one.
  exports: [OBJECT_STORAGE],
})
export class AttachmentsModule {}
