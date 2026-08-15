CREATE TABLE "auth_audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event" text NOT NULL,
	"outcome" text NOT NULL,
	"actor_user_id" uuid,
	"subject_user_id" uuid,
	"farm_id" uuid,
	"session_id" uuid,
	"session_family_id" uuid,
	"source_ip" "inet",
	"user_agent" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_audit_log" ADD CONSTRAINT "auth_audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_audit_log" ADD CONSTRAINT "auth_audit_log_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_audit_log" ADD CONSTRAINT "auth_audit_log_farm_id_farms_id_fk" FOREIGN KEY ("farm_id") REFERENCES "public"."farms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_audit_log_actor_occurred_idx" ON "auth_audit_log" USING btree ("actor_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "auth_audit_log_subject_occurred_idx" ON "auth_audit_log" USING btree ("subject_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "auth_audit_log_farm_occurred_idx" ON "auth_audit_log" USING btree ("farm_id","occurred_at");--> statement-breakpoint
CREATE INDEX "auth_audit_log_event_occurred_idx" ON "auth_audit_log" USING btree ("event","occurred_at");--> statement-breakpoint

-- A closed vocabulary makes incident queries reliable and prevents a typo from silently creating
-- a second event class. `challenge` is not a successful login: the account still owes 2FA.
ALTER TABLE "auth_audit_log" ADD CONSTRAINT "auth_audit_log_event_check"
  CHECK (event IN ('login', 'logout', 'farm_switch', 'invitation', 'session_reuse'));--> statement-breakpoint
ALTER TABLE "auth_audit_log" ADD CONSTRAINT "auth_audit_log_outcome_check"
  CHECK (outcome IN ('success', 'failure', 'challenge'));--> statement-breakpoint
ALTER TABLE "auth_audit_log" ADD CONSTRAINT "auth_audit_log_metadata_object_check"
  CHECK (jsonb_typeof(metadata) = 'object');--> statement-breakpoint
ALTER TABLE "auth_audit_log" ADD CONSTRAINT "auth_audit_log_user_agent_length_check"
  CHECK (user_agent IS NULL OR char_length(user_agent) <= 512);--> statement-breakpoint

-- Auth telemetry is written only through the explicitly elevated auth paths. The ordinary app
-- role cannot read it, insert it, or accidentally expose it through a future tenant endpoint.
REVOKE ALL PRIVILEGES ON TABLE "auth_audit_log" FROM PUBLIC, werf_app;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON SEQUENCE "auth_audit_log_id_seq" FROM PUBLIC, werf_app;--> statement-breakpoint
ALTER TABLE "auth_audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auth_audit_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- NFR-211 at the database boundary. Even an elevated application error cannot rewrite or remove
-- an event; only an explicit owner-controlled migration can replace this trigger.
CREATE FUNCTION reject_auth_audit_log_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'auth_audit_log is immutable';
END;
$$;--> statement-breakpoint
CREATE TRIGGER auth_audit_log_immutable
  BEFORE UPDATE OR DELETE ON "auth_audit_log"
  FOR EACH ROW EXECUTE FUNCTION reject_auth_audit_log_mutation();
