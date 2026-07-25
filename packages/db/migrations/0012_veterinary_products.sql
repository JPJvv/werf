CREATE TABLE "veterinary_products" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"jurisdiction" char(2) DEFAULT 'ZA' NOT NULL,
	"name" text NOT NULL,
	"registration_number" text,
	"active_ingredients" text[] NOT NULL,
	"species" text[] NOT NULL,
	"meat_withdrawal_days" integer,
	"milk_withdrawal_hours" integer,
	"dose_per_kg" numeric(10, 4),
	"route" text,
	"version" integer DEFAULT 1 NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "veterinary_products_lookup" ON "veterinary_products" USING btree ("jurisdiction","name","effective_from" DESC NULLS LAST);--> statement-breakpoint

-- Reference data, exactly like regulatory_rates (0002): readable by any authenticated app
-- connection (the client needs withdrawal periods offline, in the crush), writable ONLY by the
-- elevated migration/admin path — never by werf_app. There is no farm scope; the PowerSync layer
-- filters by the farm's jurisdiction (@werf/sync TENANCY.veterinary_products = reference). This is
-- the source the health slice injects the withdrawal FROM — never a number typed into code
-- (FR-131, legal-compliance.md § 3, .claude/rules/domain.md).
GRANT SELECT ON veterinary_products TO werf_app;--> statement-breakpoint
ALTER TABLE veterinary_products ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE veterinary_products FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY veterinary_products_read ON veterinary_products FOR SELECT USING (true);
