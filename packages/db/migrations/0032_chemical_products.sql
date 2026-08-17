CREATE TABLE "chemical_products" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"jurisdiction" char(2) DEFAULT 'ZA' NOT NULL,
	"name" text NOT NULL,
	"registration_number" text NOT NULL,
	"active_ingredients" text[] NOT NULL,
	"crop" text,
	"phi_days" integer,
	"reentry_hours" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "chemical_products_lookup" ON "chemical_products" USING btree ("jurisdiction","name","effective_from" DESC NULLS LAST);--> statement-breakpoint

-- Reference data, exactly like veterinary_products (0012): readable by any authenticated app
-- connection (the client needs the pre-harvest interval offline, at the spray tank), writable ONLY
-- by the elevated migration/admin path — never by werf_app. There is no farm scope; the PowerSync
-- layer filters by the farm's jurisdiction (@werf/sync TENANCY.chemical_products = reference). This
-- is the source the crop slice's spray capture injects the PHI FROM — never a number typed into
-- code (FR-204/FR-508, legal-compliance.md § 4, .claude/rules/domain.md).
GRANT SELECT ON chemical_products TO werf_app;--> statement-breakpoint
ALTER TABLE chemical_products ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE chemical_products FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY chemical_products_read ON chemical_products FOR SELECT USING (true);
