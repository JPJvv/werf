ALTER TABLE "inventory_items" ADD COLUMN "registration_number" text;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "active_ingredients" text[];--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "phi_days" integer;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "reentry_hours" integer;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "meat_withdrawal_days" integer;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "milk_withdrawal_hours" integer;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_phi_days_nonnegative" CHECK ("inventory_items"."phi_days" IS NULL OR "inventory_items"."phi_days" >= 0);--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_reentry_hours_nonnegative" CHECK ("inventory_items"."reentry_hours" IS NULL OR "inventory_items"."reentry_hours" >= 0);--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_meat_withdrawal_days_nonnegative" CHECK ("inventory_items"."meat_withdrawal_days" IS NULL OR "inventory_items"."meat_withdrawal_days" >= 0);--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_milk_withdrawal_hours_nonnegative" CHECK ("inventory_items"."milk_withdrawal_hours" IS NULL OR "inventory_items"."milk_withdrawal_hours" >= 0);