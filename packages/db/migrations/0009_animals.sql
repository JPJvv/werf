CREATE TYPE "public"."animal_sex" AS ENUM('male', 'female', 'castrated', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."animal_status" AS ENUM('alive', 'sold', 'dead', 'missing', 'culled');--> statement-breakpoint
CREATE TYPE "public"."identifier_type" AS ENUM('visual_tag', 'eid', 'brand', 'tattoo', 'national_id', 'other');--> statement-breakpoint
CREATE TABLE "animal_identifiers" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"farm_id" uuid NOT NULL,
	"animal_id" uuid NOT NULL,
	"type" "identifier_type" NOT NULL,
	"value" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"applied_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "animals" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"farm_id" uuid NOT NULL,
	"enterprise_id" uuid,
	"species" text NOT NULL,
	"breed" text,
	"sex" "animal_sex" NOT NULL,
	"dob" date,
	"dob_estimated" boolean DEFAULT false NOT NULL,
	"status" "animal_status" DEFAULT 'alive' NOT NULL,
	"status_at" timestamp with time zone,
	"dam_id" uuid,
	"sire_id" uuid,
	"mob_id" uuid,
	"land_unit_id" uuid,
	"source" text,
	"acquired_at" date,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"photo_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "mobs" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"farm_id" uuid NOT NULL,
	"enterprise_id" uuid,
	"name" text NOT NULL,
	"species" text NOT NULL,
	"land_unit_id" uuid,
	"head_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "animal_identifiers" ADD CONSTRAINT "animal_identifiers_farm_id_farms_id_fk" FOREIGN KEY ("farm_id") REFERENCES "public"."farms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "animal_identifiers" ADD CONSTRAINT "animal_identifiers_animal_id_animals_id_fk" FOREIGN KEY ("animal_id") REFERENCES "public"."animals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "animals" ADD CONSTRAINT "animals_farm_id_farms_id_fk" FOREIGN KEY ("farm_id") REFERENCES "public"."farms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "animals" ADD CONSTRAINT "animals_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "public"."enterprises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "animals" ADD CONSTRAINT "animals_dam_id_animals_id_fk" FOREIGN KEY ("dam_id") REFERENCES "public"."animals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "animals" ADD CONSTRAINT "animals_sire_id_animals_id_fk" FOREIGN KEY ("sire_id") REFERENCES "public"."animals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "animals" ADD CONSTRAINT "animals_mob_id_mobs_id_fk" FOREIGN KEY ("mob_id") REFERENCES "public"."mobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "animals" ADD CONSTRAINT "animals_land_unit_id_land_units_id_fk" FOREIGN KEY ("land_unit_id") REFERENCES "public"."land_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "animals" ADD CONSTRAINT "animals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "animals" ADD CONSTRAINT "animals_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobs" ADD CONSTRAINT "mobs_farm_id_farms_id_fk" FOREIGN KEY ("farm_id") REFERENCES "public"."farms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobs" ADD CONSTRAINT "mobs_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "public"."enterprises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobs" ADD CONSTRAINT "mobs_land_unit_id_land_units_id_fk" FOREIGN KEY ("land_unit_id") REFERENCES "public"."land_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "animal_identifiers_unique" ON "animal_identifiers" USING btree ("farm_id","type","value") WHERE "animal_identifiers"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "animal_identifiers_lookup" ON "animal_identifiers" USING btree ("farm_id","value") WHERE "animal_identifiers"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "animals_farm_live_idx" ON "animals" USING btree ("farm_id","species") WHERE "animals"."deleted_at" IS NULL AND "animals"."status" = 'alive';--> statement-breakpoint
CREATE INDEX "animals_mob_idx" ON "animals" USING btree ("mob_id") WHERE "animals"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "animals_dam_idx" ON "animals" USING btree ("dam_id");--> statement-breakpoint
CREATE INDEX "animals_sire_idx" ON "animals" USING btree ("sire_id");--> statement-breakpoint
CREATE INDEX "animals_attrs_gin" ON "animals" USING gin ("attributes");--> statement-breakpoint

-- RLS: all three tables are farm-scoped and MUST agree with TENANCY.{mobs,animals,
-- animal_identifiers} in @werf/sync (sync and RLS are two systems, one invariant, silent
-- failure). Same shape as enterprises_tenant / land_units_tenant: a row is visible and
-- writable iff its farm is one the caller is an active member of. animal_identifiers carries
-- its own farm_id, so it is scoped directly, not through its animal. No hard DELETE is granted
-- — deletion is UPDATE ... SET deleted_at.
GRANT SELECT, INSERT, UPDATE ON "mobs", "animals", "animal_identifiers" TO werf_app;--> statement-breakpoint

ALTER TABLE "mobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mobs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY mobs_tenant ON "mobs"
  USING (farm_id IN (SELECT app_user_farm_ids()))
  WITH CHECK (farm_id IN (SELECT app_user_farm_ids()));--> statement-breakpoint

ALTER TABLE "animals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "animals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY animals_tenant ON "animals"
  USING (farm_id IN (SELECT app_user_farm_ids()))
  WITH CHECK (farm_id IN (SELECT app_user_farm_ids()));--> statement-breakpoint

ALTER TABLE "animal_identifiers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "animal_identifiers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY animal_identifiers_tenant ON "animal_identifiers"
  USING (farm_id IN (SELECT app_user_farm_ids()))
  WITH CHECK (farm_id IN (SELECT app_user_farm_ids()));