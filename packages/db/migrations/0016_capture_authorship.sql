-- Authorship on the three tables that gain a WRITE PATH in this slice (db.md: created_by/updated_by
-- on every table). `land_units`, `mobs` and `animal_identifiers` were created in 0008 and 0009 as
-- data layers with no create action behind them, and the columns were missed there; 0015 did the
-- same repair for the two evidentiary tables. This one closes the rest.
--
-- Doing it NOW rather than later is the point: the moment a table stops being schema-only and starts
-- receiving field captures is the moment "who recorded this" becomes a fact worth keeping. A camp
-- boundary and an ear-tag number are both things a farmer will one day dispute with a neighbour, a
-- buyer, or an auditor, and "the app says so" is a weaker answer than "Thabo recorded it on the 3rd".
--
-- Additive, nullable, no backfill. The rows that exist were written before the columns did (seed and
-- test fixtures), and inventing an author for them would be worse than admitting we do not know.
--
-- No RLS or TENANCY change: all three tables are already farm-scoped and classified, and a uuid
-- referencing users adds no new tenancy surface. Never edit an applied migration — this is a new one.
ALTER TABLE "land_units" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "land_units" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "mobs" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "mobs" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "animal_identifiers" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "animal_identifiers" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "land_units" ADD CONSTRAINT "land_units_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "land_units" ADD CONSTRAINT "land_units_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobs" ADD CONSTRAINT "mobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobs" ADD CONSTRAINT "mobs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "animal_identifiers" ADD CONSTRAINT "animal_identifiers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "animal_identifiers" ADD CONSTRAINT "animal_identifiers_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
