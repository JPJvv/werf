CREATE TABLE "regulatory_rates" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"jurisdiction" char(2) DEFAULT 'ZA' NOT NULL,
	"code" text NOT NULL,
	"value" numeric(14, 4) NOT NULL,
	"unit" text NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"gazette_reference" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "regulatory_rates_unique" UNIQUE("jurisdiction","code","effective_from")
);
--> statement-breakpoint
CREATE INDEX "regulatory_rates_lookup" ON "regulatory_rates" USING btree ("jurisdiction","code","effective_from" DESC NULLS LAST);--> statement-breakpoint

-- Reference data: readable by any authenticated app connection (the client needs rates
-- offline), writable ONLY by the elevated migration/admin path — never by werf_app. There
-- is no farm scope; the PowerSync layer filters by the farm's jurisdiction (@werf/sync).
GRANT SELECT ON regulatory_rates TO werf_app;--> statement-breakpoint
ALTER TABLE regulatory_rates ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE regulatory_rates FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY regulatory_rates_read ON regulatory_rates FOR SELECT USING (true);