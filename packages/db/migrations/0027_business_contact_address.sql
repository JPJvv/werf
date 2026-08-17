-- FR-001 was previously represented only by the business name and optional registration number.
-- These columns are deliberately nullable for tenants created before this additive migration; the
-- current registration contract requires a complete physical address and at least one contact.
ALTER TABLE "businesses" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "physical_address_line_1" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "physical_address_line_2" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "physical_address_locality" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "physical_address_province" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "physical_address_postal_code" text;
