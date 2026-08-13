-- Attachment metadata (Phase 3 slice 3i, offline-sync.md § 3.1): one shared table for animal
-- photos today and later crop/grievance documents, discriminated by subject_type. The binary
-- itself never lives in Postgres — this row is metadata only, written the moment the client
-- commits the blob to OPFS, and the API issues a presigned upload against a server-derived key
-- once it exists here.
--
-- Hand-written, not `drizzle-kit generate` output: the generator's snapshot history has a gap
-- from migration 0016 onward (0016-0021 were all hand-authored directly, same as this one), so a
-- fresh `generate` run diffs against the stale 0015 snapshot and tries to redo six migrations'
-- worth of already-applied changes. Reconciling that snapshot gap is tracked separately and is
-- not this slice's job; this file only adds what 0022 actually needs, matching the shape
-- packages/db/src/schema/attachments.ts declares.
CREATE TYPE "public"."attachment_subject_type" AS ENUM('animal');--> statement-breakpoint
CREATE TYPE "public"."attachment_status" AS ENUM('pending', 'finalised');--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"farm_id" uuid NOT NULL,
	"subject_type" "attachment_subject_type" NOT NULL,
	"subject_id" uuid NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"checksum" text NOT NULL,
	"object_key" text,
	"status" "attachment_status" DEFAULT 'pending' NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_farm_id_farms_id_fk" FOREIGN KEY ("farm_id") REFERENCES "public"."farms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- No FK from subject_id: it points across whichever table subject_type names (only `animals`
-- today), and Postgres has no polymorphic foreign key. The API checks the referenced row exists
-- AND is on the same farm before issuing an upload (assertOwnedReferences's own shape).
CREATE INDEX "attachments_farm_idx" ON "attachments" USING btree ("farm_id") WHERE "attachments"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "attachments_subject_idx" ON "attachments" USING btree ("subject_type", "subject_id") WHERE "attachments"."deleted_at" IS NULL;--> statement-breakpoint
-- The orphan-cleanup sweep 3i requires (a `pending` row whose presigned upload window expired and
-- was never finalised) needs to find stale pending rows without a full table scan.
CREATE INDEX "attachments_pending_idx" ON "attachments" USING btree ("created_at") WHERE "attachments"."status" = 'pending';--> statement-breakpoint

-- RLS: farm-scoped, MUST agree with TENANCY.attachments in @werf/sync (sync and RLS are two
-- systems, one invariant, silent failure — db.md). Same shape as theft_incidents_tenant. No hard
-- DELETE is granted — soft-delete via deleted_at, same as every other table here.
GRANT SELECT, INSERT, UPDATE ON "attachments" TO werf_app;--> statement-breakpoint

ALTER TABLE "attachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attachments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY attachments_tenant ON "attachments"
  USING (farm_id IN (SELECT app_user_farm_ids()))
  WITH CHECK (farm_id IN (SELECT app_user_farm_ids()));
