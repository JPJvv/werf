-- Authorship on the two evidentiary tables (db.md: created_by/updated_by on every table).
--
-- Additive, nullable, and deliberately without a backfill: the rows that exist were written before
-- the columns did, and inventing an author for them would be worse than admitting we do not know
-- who filed them. New rows carry it.
--
-- Why these two first. An evidence pack is handed to the SAPS Stock Theft Unit, and "who reported
-- this, and when" is part of what makes the document worth anything; a branding register is the
-- ownership claim that pack rests on. Both were flagged as carry-forwards by the sync-auditor and
-- the compliance-gated slices — the fix belongs in a NEW migration, never by editing the applied
-- 0011 and 0013 (db.md, enforced by a hook).
--
-- No RLS or TENANCY change: both tables are already farm-scoped and classified, and a uuid column
-- referencing users adds no new tenancy surface.
ALTER TABLE "branding_registers" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "branding_registers" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "theft_incidents" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "theft_incidents" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "branding_registers" ADD CONSTRAINT "branding_registers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branding_registers" ADD CONSTRAINT "branding_registers_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theft_incidents" ADD CONSTRAINT "theft_incidents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theft_incidents" ADD CONSTRAINT "theft_incidents_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;