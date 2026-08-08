CREATE TABLE "theft_incident_animals" (
	"farm_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"animal_id" uuid NOT NULL,
	"recovered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "theft_incident_animals_incident_id_animal_id_pk" PRIMARY KEY("incident_id","animal_id")
);
--> statement-breakpoint
CREATE TABLE "theft_incidents" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"farm_id" uuid NOT NULL,
	"discovered_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone,
	"last_seen_location" geometry(Point,4326),
	"last_seen_location_geojson" text,
	"land_unit_id" uuid,
	"head_count" integer NOT NULL,
	"case_number" text,
	"reporting_station" text,
	"status" text DEFAULT 'open' NOT NULL,
	"observations" text,
	"evidence_pack_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "theft_incident_animals" ADD CONSTRAINT "theft_incident_animals_farm_id_farms_id_fk" FOREIGN KEY ("farm_id") REFERENCES "public"."farms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theft_incident_animals" ADD CONSTRAINT "theft_incident_animals_incident_id_theft_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."theft_incidents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theft_incident_animals" ADD CONSTRAINT "theft_incident_animals_animal_id_animals_id_fk" FOREIGN KEY ("animal_id") REFERENCES "public"."animals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theft_incidents" ADD CONSTRAINT "theft_incidents_farm_id_farms_id_fk" FOREIGN KEY ("farm_id") REFERENCES "public"."farms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theft_incidents" ADD CONSTRAINT "theft_incidents_land_unit_id_land_units_id_fk" FOREIGN KEY ("land_unit_id") REFERENCES "public"."land_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Spatial index on the canonical last-seen point. GIST, not the btree drizzle emits for ordinary
-- columns — a geometry has no total order for a btree to use.
CREATE INDEX "theft_incidents_last_seen_gix" ON "theft_incidents" USING GIST ("last_seen_location");--> statement-breakpoint
CREATE INDEX "theft_incidents_farm_idx" ON "theft_incidents" USING btree ("farm_id") WHERE "theft_incidents"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "theft_incident_animals_incident_idx" ON "theft_incident_animals" USING btree ("incident_id");--> statement-breakpoint

-- The geometry⇄GeoJSON dual-write invariant for last_seen_location, ENFORCED not by convention
-- (.claude/rules/db.md, database-schema.md § 7) — its OWN trigger, like land's boundary and
-- events.location, never a shared hardcoded-column function. The farmer captures the last-seen GPS
-- offline in the field; the canonical geometry is stripped from sync (neverSyncColumns) and the
-- client reads the geojson mirror. On INSERT, OLD is NULL, so a new row carrying a point is caught.
CREATE OR REPLACE FUNCTION theft_incidents_sync_geojson() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF NEW.last_seen_location IS DISTINCT FROM OLD.last_seen_location THEN
    NEW.last_seen_location_geojson := ST_AsGeoJSON(NEW.last_seen_location);
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint

CREATE TRIGGER theft_incidents_geojson BEFORE INSERT OR UPDATE ON "theft_incidents"
  FOR EACH ROW EXECUTE FUNCTION theft_incidents_sync_geojson();--> statement-breakpoint

-- RLS: both tables farm-scoped, and MUST agree with TENANCY.theft_incidents /
-- TENANCY.theft_incident_animals in @werf/sync (sync and RLS are two systems, one invariant, silent
-- failure). Same shape as land_units_tenant: a row is visible and writable iff its farm is one the
-- caller is an active member of. theft_incident_animals carries its own farm_id, so it scopes
-- directly. No hard DELETE is granted — theft_incidents soft-delete via deleted_at; a link is
-- additive.
GRANT SELECT, INSERT, UPDATE ON "theft_incidents" TO werf_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "theft_incident_animals" TO werf_app;--> statement-breakpoint

ALTER TABLE "theft_incidents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "theft_incidents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY theft_incidents_tenant ON "theft_incidents"
  USING (farm_id IN (SELECT app_user_farm_ids()))
  WITH CHECK (farm_id IN (SELECT app_user_farm_ids()));--> statement-breakpoint

ALTER TABLE "theft_incident_animals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "theft_incident_animals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY theft_incident_animals_tenant ON "theft_incident_animals"
  USING (farm_id IN (SELECT app_user_farm_ids()))
  WITH CHECK (farm_id IN (SELECT app_user_farm_ids()));
