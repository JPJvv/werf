-- PostGIS. land_units is the first table to carry geometry, so the extension is created
-- here, before the table whose `boundary` column depends on the type. The testcontainers
-- and compose images are postgis/postgis, so this is available in dev, CI and production.
CREATE EXTENSION IF NOT EXISTS postgis;--> statement-breakpoint
CREATE TYPE "public"."land_unit_kind" AS ENUM('camp', 'block', 'other');--> statement-breakpoint
CREATE TABLE "land_units" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"farm_id" uuid NOT NULL,
	"enterprise_id" uuid,
	"parent_id" uuid,
	"kind" "land_unit_kind" NOT NULL,
	"code" text NOT NULL,
	"name" text,
	"boundary" geometry(Polygon,4326),
	"boundary_geojson" text,
	"hectares" numeric(10, 2),
	"carrying_capacity_lsu" numeric(8, 2),
	"soil_type" text,
	"irrigation" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "land_units_farm_code_unique" UNIQUE("farm_id","code")
);
--> statement-breakpoint
ALTER TABLE "land_units" ADD CONSTRAINT "land_units_farm_id_farms_id_fk" FOREIGN KEY ("farm_id") REFERENCES "public"."farms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "land_units" ADD CONSTRAINT "land_units_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "public"."enterprises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "land_units" ADD CONSTRAINT "land_units_parent_id_land_units_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."land_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "land_units_farm_idx" ON "land_units" USING btree ("farm_id") WHERE "land_units"."deleted_at" IS NULL;--> statement-breakpoint

-- Spatial index on the canonical boundary. GIST, not the btree drizzle emits for ordinary
-- columns — a geometry has no total order for a btree to use.
CREATE INDEX "land_units_boundary_gix" ON "land_units" USING GIST ("boundary");--> statement-breakpoint

-- The geometry⇄GeoJSON dual-write invariant, ENFORCED, not left to convention
-- (.claude/rules/db.md, database-schema.md §3): whenever the canonical PostGIS `boundary`
-- changes, recompute the denormalised GeoJSON the offline client reads. Named for the table
-- rather than the schema sketch's generic `sync_geojson`, because it is boundary-specific;
-- events.location will get its own trigger in the events slice rather than overloading one
-- hardcoded-column function. On INSERT, OLD is NULL, so a new row with a boundary is caught.
CREATE OR REPLACE FUNCTION land_units_sync_geojson() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF NEW.boundary IS DISTINCT FROM OLD.boundary THEN
    NEW.boundary_geojson := ST_AsGeoJSON(NEW.boundary);
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint

CREATE TRIGGER land_units_geojson BEFORE INSERT OR UPDATE ON "land_units"
  FOR EACH ROW EXECUTE FUNCTION land_units_sync_geojson();--> statement-breakpoint

-- RLS: farm-scoped, and MUST agree with TENANCY.land_units in @werf/sync (sync and RLS are
-- two systems, one invariant, silent failure). Same shape as enterprises_tenant: a row is
-- visible and writable iff its farm is one the caller is an active member of. No hard DELETE
-- is granted — deletion is UPDATE ... SET deleted_at.
GRANT SELECT, INSERT, UPDATE ON "land_units" TO werf_app;--> statement-breakpoint
ALTER TABLE "land_units" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "land_units" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY land_units_tenant ON "land_units"
  USING (farm_id IN (SELECT app_user_farm_ids()))
  WITH CHECK (farm_id IN (SELECT app_user_farm_ids()));