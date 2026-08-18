CREATE TYPE "public"."inventory_item_category" AS ENUM('chemical', 'fertiliser', 'feed', 'medicine');--> statement-breakpoint
ALTER TYPE "public"."event_type" ADD VALUE 'inventory_movement';--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"farm_id" uuid NOT NULL,
	"enterprise_id" uuid,
	"category" "inventory_item_category" NOT NULL,
	"name" text NOT NULL,
	"unit" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "inventory_lots" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"farm_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"batch" text,
	"expiry_date" date,
	"location" text,
	"quantity_on_hand" numeric(12, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "inventory_lot_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_farm_id_farms_id_fk" FOREIGN KEY ("farm_id") REFERENCES "public"."farms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "public"."enterprises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_farm_id_farms_id_fk" FOREIGN KEY ("farm_id") REFERENCES "public"."farms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_inventory_lot_id_inventory_lots_id_fk" FOREIGN KEY ("inventory_lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- RLS: both tables farm-scoped, and MUST agree with TENANCY.inventory_items / TENANCY.inventory_lots
-- in @werf/sync (sync and RLS are two systems, one invariant, silent failure). Same shape as
-- theft_incidents_tenant: a row is visible and writable iff its farm is one the caller is an active
-- member of. No hard DELETE is granted — both soft-delete via deleted_at.
GRANT SELECT, INSERT, UPDATE ON "inventory_items" TO werf_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "inventory_lots" TO werf_app;--> statement-breakpoint

ALTER TABLE "inventory_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY inventory_items_tenant ON "inventory_items"
  USING (farm_id IN (SELECT app_user_farm_ids()))
  WITH CHECK (farm_id IN (SELECT app_user_farm_ids()));--> statement-breakpoint

ALTER TABLE "inventory_lots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory_lots" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY inventory_lots_tenant ON "inventory_lots"
  USING (farm_id IN (SELECT app_user_farm_ids()))
  WITH CHECK (farm_id IN (SELECT app_user_farm_ids()));