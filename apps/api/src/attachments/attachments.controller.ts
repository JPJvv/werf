import { Body, Controller, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { schemas } from '@werf/core';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { AuthContext } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import {
  AttachmentsService,
  type CapturedAttachment,
  type FinalizedAttachment,
} from './attachments.service';

// No @UseGuards: AuthGuard is registered globally, so every route here is guarded by default.
@Controller('attachments')
export class AttachmentsController {
  constructor(@Inject(AttachmentsService) private readonly attachments: AttachmentsService) {}

  /**
   * Register a photo/document's metadata and get back a presigned PUT for its binary (phase-
   * checklists.md 3i). The body carries the client's own UUIDv7, the subject it documents, and the
   * checksum computed over the blob at capture — before this endpoint is ever reached, offline.
   * Idempotent on the id.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createAttachment(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(schemas.newAttachmentSchema))
    body: schemas.NewAttachment,
  ): Promise<CapturedAttachment> {
    return this.attachments.createAttachment(auth.userId, body);
  }

  /**
   * Confirm the presigned PUT completed. The server re-derives size and checksum from the object
   * it actually holds and refuses a mismatch — this body only points at which row to check.
   */
  @Post('finalize')
  @HttpCode(HttpStatus.OK)
  async finalizeAttachment(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(schemas.finalizeAttachmentRequestSchema))
    body: schemas.FinalizeAttachmentRequest,
  ): Promise<FinalizedAttachment> {
    return this.attachments.finalizeAttachment(auth.userId, body);
  }

  /**
   * A short-lived presigned GET for one of the caller's own FINALISED attachments (P2.5) — the
   * secure read path this pipeline never had. Same-farm authorisation and a `finalised`-only
   * check both happen server-side (`AttachmentsService.getDownloadUrl`) before any URL is issued.
   */
  @Post('download')
  @HttpCode(HttpStatus.OK)
  async getDownloadUrl(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(schemas.attachmentDownloadRequestSchema))
    body: schemas.AttachmentDownloadRequest,
  ): Promise<schemas.AttachmentDownloadUrl> {
    return this.attachments.getDownloadUrl(auth.userId, body);
  }
}
