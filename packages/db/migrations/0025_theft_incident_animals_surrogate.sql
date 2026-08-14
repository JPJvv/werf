-- Surrogate id + soft-delete + authorship on theft_incident_animals (issue #10, P2.6).
--
-- Root cause: PowerSync needs a single-column row identity, and the original composite
-- (incident_id, animal_id) PK gave it none — derive-local-schema.ts's NO_SURROGATE_ID excluded
-- this table for exactly that reason, which is why a hydrated theft incident's animalIds was
-- always [] on a second device (packages/sync/test/local-schema.spec.ts pinned it as a known gap).
--
-- id is DB-generated, unlike every other primaryId() in this schema: this row is never
-- independently offline-captured (unlike attachments) — it is only ever written server-side
-- inside LivestockService.createTheftIncident's bulk insert, already idempotent by the incident's
-- own client-generated id — so a DB default is correct here and only here.
--
-- The dropped composite PK's uniqueness is replaced by a PARTIAL unique index (WHERE deleted_at
-- IS NULL), the same shape animal_identifiers_unique uses (animals.ts) — an unlinked animal can be
-- relinked, matching "soft-delete only" (db.md). theft_incident_animals_incident_idx is recreated
-- with the same filter so a soft-deleted link stops counting as still-linked for lookups.
--
-- No RLS/GRANT change: farm_id and the existing tenant policy (migration 0013) are untouched.
ALTER TABLE "theft_incident_animals" DROP CONSTRAINT "theft_incident_animals_incident_id_animal_id_pk";--> statement-breakpoint
ALTER TABLE "theft_incident_animals" ADD COLUMN "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL;--> statement-breakpoint
ALTER TABLE "theft_incident_animals" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "theft_incident_animals" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "theft_incident_animals" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "theft_incident_animals" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "theft_incident_animals" ADD CONSTRAINT "theft_incident_animals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theft_incident_animals" ADD CONSTRAINT "theft_incident_animals_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "theft_incident_animals_unique" ON "theft_incident_animals" USING btree ("incident_id","animal_id") WHERE "theft_incident_animals"."deleted_at" IS NULL;--> statement-breakpoint
DROP INDEX "theft_incident_animals_incident_idx";--> statement-breakpoint
CREATE INDEX "theft_incident_animals_incident_idx" ON "theft_incident_animals" USING btree ("incident_id") WHERE "theft_incident_animals"."deleted_at" IS NULL;