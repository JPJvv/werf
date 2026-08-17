-- Per-farm attachment storage quota tracking (P3.16, owner decision 2026-08-16). A running total
-- of FINALISED attachment bytes, maintained only by `AttachmentsService`/
-- `AttachmentOrphanSweepService` (both run on the elevated-authorised, farm-scoped `AppDb`
-- connection already checked for membership before this column is ever touched) — no request
-- body anywhere in the API accepts a value for it, so there is no client-writable path despite
-- `farms` syncing whole-row (TENANCY.farms has no `neverSyncColumns` because nothing here is
-- sensitive; the protection is that it is never an accepted INPUT, the same shape
-- `object_key`/`status` already use on `attachments` itself).
ALTER TABLE "farms" ADD COLUMN "attachment_bytes_used" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "farms" ADD CONSTRAINT "farms_attachment_bytes_used_nonnegative" CHECK ("farms"."attachment_bytes_used" >= 0);