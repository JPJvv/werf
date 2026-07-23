CREATE TABLE "branding_registers" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"farm_id" uuid NOT NULL,
	"jurisdiction" char(2) DEFAULT 'ZA' NOT NULL,
	"mark" text NOT NULL,
	"mark_type" text NOT NULL,
	"species" text[] NOT NULL,
	"body_position" text,
	"certificate_reference" text,
	"registered_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "branding_registers_mark_length" CHECK (char_length("branding_registers"."mark") <= 3)
);
--> statement-breakpoint
ALTER TABLE "animals" ADD COLUMN "brand_id" uuid;--> statement-breakpoint
ALTER TABLE "animals" ADD COLUMN "brand_applied_at" date;--> statement-breakpoint
ALTER TABLE "branding_registers" ADD CONSTRAINT "branding_registers_farm_id_farms_id_fk" FOREIGN KEY ("farm_id") REFERENCES "public"."farms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "animals" ADD CONSTRAINT "animals_brand_id_branding_registers_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."branding_registers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- RLS: branding_registers is farm-scoped and MUST agree with TENANCY.branding_registers in
-- @werf/sync (sync and RLS are two systems, one invariant, silent failure). Same shape as
-- animals_tenant: a row is visible and writable iff its farm is one the caller is an active
-- member of. No hard DELETE is granted — deletion is UPDATE ... SET deleted_at. The new
-- animals.brand_id / brand_applied_at columns are covered by the existing animals_tenant policy.
GRANT SELECT, INSERT, UPDATE ON "branding_registers" TO werf_app;--> statement-breakpoint

ALTER TABLE "branding_registers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "branding_registers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY branding_registers_tenant ON "branding_registers"
  USING (farm_id IN (SELECT app_user_farm_ids()))
  WITH CHECK (farm_id IN (SELECT app_user_farm_ids()));