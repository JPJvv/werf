CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"farm_id" uuid NOT NULL,
	"user_id" uuid,
	"source_session_id" uuid,
	"table_name" text NOT NULL,
	"record_id" uuid NOT NULL,
	"action" text NOT NULL,
	"rule" text NOT NULL,
	"conflict_key" text NOT NULL,
	"facts" jsonb NOT NULL,
	"winner" jsonb,
	"source" text DEFAULT 'api' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conflict_reviews" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"farm_id" uuid NOT NULL,
	"conflict_key" text NOT NULL,
	"kind" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"field" text,
	"fact_a_event_id" uuid NOT NULL,
	"fact_b_event_id" uuid NOT NULL,
	"winner_event_id" uuid,
	"rule" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"review_note" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "source_session_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_farm_id_farms_id_fk" FOREIGN KEY ("farm_id") REFERENCES "public"."farms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflict_reviews" ADD CONSTRAINT "conflict_reviews_farm_id_farms_id_fk" FOREIGN KEY ("farm_id") REFERENCES "public"."farms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflict_reviews" ADD CONSTRAINT "conflict_reviews_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflict_reviews" ADD CONSTRAINT "conflict_reviews_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflict_reviews" ADD CONSTRAINT "conflict_reviews_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_log_conflict_key_unique" ON "audit_log" USING btree ("conflict_key");--> statement-breakpoint
CREATE INDEX "audit_log_farm_occurred_idx" ON "audit_log" USING btree ("farm_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conflict_reviews_conflict_key_unique" ON "conflict_reviews" USING btree ("conflict_key");--> statement-breakpoint
CREATE INDEX "conflict_reviews_farm_status_idx" ON "conflict_reviews" USING btree ("farm_id","status") WHERE "conflict_reviews"."deleted_at" IS NULL;
--> statement-breakpoint

-- Constrain the operational vocabulary at the database boundary. The API validates the same set,
-- but the queue and audit log are evidence and cannot depend on one caller remembering to do so.
ALTER TABLE "conflict_reviews" ADD CONSTRAINT "conflict_reviews_kind_check"
  CHECK (kind IN ('field_lww', 'possible_duplicate_birth', 'status_contradiction'));--> statement-breakpoint
ALTER TABLE "conflict_reviews" ADD CONSTRAINT "conflict_reviews_status_check"
  CHECK (status IN ('open', 'reviewed'));--> statement-breakpoint
ALTER TABLE "conflict_reviews" ADD CONSTRAINT "conflict_reviews_review_state_check"
  CHECK (
    (status = 'open' AND reviewed_at IS NULL AND reviewed_by IS NULL) OR
    (status = 'reviewed' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)
  );--> statement-breakpoint

-- Both tables are server-only in PowerSync, but API reads/writes still run as werf_app and remain
-- tenant-scoped by the exact same app_user_farm_ids() predicate as every farm table.
GRANT SELECT, INSERT ON "audit_log" TO werf_app;--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "audit_log_id_seq" TO werf_app;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_log" FROM PUBLIC, werf_app;--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY audit_log_read ON "audit_log" FOR SELECT
  USING (farm_id IN (SELECT app_user_farm_ids()));--> statement-breakpoint
CREATE POLICY audit_log_insert ON "audit_log" FOR INSERT
  WITH CHECK (farm_id IN (SELECT app_user_farm_ids()));--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON "conflict_reviews" TO werf_app;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "conflict_reviews" FROM PUBLIC, werf_app;--> statement-breakpoint
ALTER TABLE "conflict_reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conflict_reviews" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY conflict_reviews_tenant ON "conflict_reviews"
  USING (farm_id IN (SELECT app_user_farm_ids()))
  WITH CHECK (farm_id IN (SELECT app_user_farm_ids()));--> statement-breakpoint

-- Defence in depth for NFR-211: even an elevated application mistake cannot rewrite history.
-- Migrations can still replace the trigger explicitly under owner control when the schema changes.
CREATE FUNCTION reject_audit_log_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is immutable';
END;
$$;--> statement-breakpoint
CREATE TRIGGER audit_log_immutable
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION reject_audit_log_mutation();
