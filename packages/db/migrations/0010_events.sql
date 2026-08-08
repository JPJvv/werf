CREATE TYPE "public"."event_type" AS ENUM('birth', 'death', 'weight', 'treatment', 'vaccination', 'dip', 'move', 'sale', 'purchase', 'weaning', 'mating', 'pregnancy_test', 'condition_score', 'missing', 'recovered', 'planting', 'spray', 'fertiliser', 'irrigation', 'harvest', 'scouting', 'soil_test', 'attendance', 'piece_work', 'task_complete');--> statement-breakpoint

-- events — the append-only heart (database-schema.md § 5). PARTITIONED BY LIST (farm_id) from
-- day one: at 500k events/farm/year × 10k farms this table is the constraint, and partitioning
-- a billion-row table later is a migration that does not happen. Partitioning now is one clause.
-- drizzle cannot emit PARTITION BY, so the table is hand-authored here (the rest of the file —
-- FKs, indexes, the location trigger, RLS — is likewise hand-authored, as with land_units).
--
-- ⭐ The primary key is (id, farm_id): Postgres requires the partition key to be part of every
-- unique constraint on a partitioned table. id stays a client-generated UUIDv7.
CREATE TABLE "events" (
	"id" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"farm_id" uuid NOT NULL,
	"enterprise_id" uuid,
	"type" "event_type" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone,
	"animal_id" uuid,
	"mob_id" uuid,
	"land_unit_id" uuid,
	"employee_id" uuid,
	"batch_id" uuid,
	"payload" jsonb NOT NULL,
	"location" geometry(Point,4326),
	"location_geojson" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	CONSTRAINT "events_id_farm_id_pk" PRIMARY KEY("id","farm_id")
) PARTITION BY LIST ("farm_id");--> statement-breakpoint

-- FKs live on the partitioned parent and cascade to every partition (PG12+). `employee_id` is
-- deliberately un-constrained: the employees table arrives with the labour phase, and adding the
-- FK then is additive (the same deferral as animals.brand_id).
ALTER TABLE "events" ADD CONSTRAINT "events_farm_id_farms_id_fk" FOREIGN KEY ("farm_id") REFERENCES "public"."farms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "public"."enterprises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_animal_id_animals_id_fk" FOREIGN KEY ("animal_id") REFERENCES "public"."animals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_mob_id_mobs_id_fk" FOREIGN KEY ("mob_id") REFERENCES "public"."mobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_land_unit_id_land_units_id_fk" FOREIGN KEY ("land_unit_id") REFERENCES "public"."land_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- The farm-provisioning path calls this to give each farm its own partition, for the query
-- locality partitioning exists to buy. It is an elevated (owner) operation: creating a partition
-- is DDL, and werf_app has no CREATE on the schema — exactly as intended (database-schema.md § 5).
CREATE OR REPLACE FUNCTION create_farm_partition(p_farm_id uuid) RETURNS void
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS events_%s PARTITION OF events FOR VALUES IN (%L)',
    replace(p_farm_id::text, '-', '_'), p_farm_id);
END $$;--> statement-breakpoint

-- ⭐ A DEFAULT partition is the offline-first safety net: a write must NEVER be rejected merely
-- because a farm's dedicated partition was not pre-created (.claude/rules/db.md — the write queue
-- is never discarded by the system). Provisioning still creates a dedicated partition per farm,
-- so in a healthy system the default stays near-empty; it only catches events for a farm that
-- reached ingestion before its partition did. (Phase 3's provisioning path closes that window.)
CREATE TABLE "events_default" PARTITION OF "events" DEFAULT;--> statement-breakpoint

-- Indexes are created on the partitioned parent and cascade to every partition. occurred_at is
-- indexed DESC because reads are "the most recent events for X" — reports and timelines. Note it
-- is occurred_at, not created_at: a report orders by when things happened on the farm (§ 5).
CREATE INDEX "events_farm_occurred" ON "events" USING btree ("farm_id","occurred_at" DESC);--> statement-breakpoint
CREATE INDEX "events_animal" ON "events" USING btree ("animal_id","occurred_at" DESC) WHERE "animal_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "events_type_occurred" ON "events" USING btree ("farm_id","type","occurred_at" DESC);--> statement-breakpoint
CREATE INDEX "events_batch" ON "events" USING btree ("batch_id") WHERE "batch_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "events_payload_gin" ON "events" USING gin ("payload");--> statement-breakpoint

-- Spatial index on the canonical location. GIST, not btree — a geometry has no total order.
CREATE INDEX "events_location_gix" ON "events" USING GIST ("location");--> statement-breakpoint

-- The geometry⇄GeoJSON dual-write invariant for events.location, ENFORCED not by convention
-- (.claude/rules/db.md, database-schema.md § 5). Its OWN function/trigger — NOT land's
-- boundary-specific one; overloading a single hardcoded-column function across tables is how the
-- two silently diverge. On INSERT, OLD is NULL, so a new row carrying a location is caught.
CREATE OR REPLACE FUNCTION events_sync_geojson() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF NEW.location IS DISTINCT FROM OLD.location THEN
    NEW.location_geojson := ST_AsGeoJSON(NEW.location);
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint

-- A row trigger on the partitioned parent applies to every partition, present and future (PG11+).
CREATE TRIGGER events_geojson BEFORE INSERT OR UPDATE ON "events"
  FOR EACH ROW EXECUTE FUNCTION events_sync_geojson();--> statement-breakpoint

-- RLS: farm-scoped, and MUST agree with TENANCY.events in @werf/sync (sync and RLS are two
-- systems, one invariant, silent failure). Same shape as animals_tenant: a row is visible and
-- writable iff its farm is one the caller is an active member of. Enabled on the partitioned
-- parent, so it governs every partition accessed through the parent (which is the only path the
-- app uses). Privileges are granted on the parent; routed INSERTs check the parent's ACL. No
-- hard DELETE is granted — an event is append-only, and a correction is UPDATE ... SET deleted_at.
GRANT SELECT, INSERT, UPDATE ON "events" TO werf_app;--> statement-breakpoint
ALTER TABLE "events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY events_tenant ON "events"
  USING (farm_id IN (SELECT app_user_farm_ids()))
  WITH CHECK (farm_id IN (SELECT app_user_farm_ids()));
