CREATE TABLE "species_gestation" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"species" text NOT NULL,
	"gestation_days" integer NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "species_gestation_days_positive" CHECK ("gestation_days" > 0),
	CONSTRAINT "species_gestation_days_plausible" CHECK ("gestation_days" <= 730)
);--> statement-breakpoint

-- One row per species. A second row for cattle is a data error, not a version: unlike a
-- registration or a wage there is no date on which biology changed, so a correction REPLACES the
-- figure rather than superseding it.
CREATE UNIQUE INDEX "species_gestation_species" ON "species_gestation" USING btree ("species");--> statement-breakpoint

-- Reference data, like veterinary_products (0012) and regulatory_rates (0002): readable by any
-- authenticated app connection because the client needs it OFFLINE — a pregnancy diagnosis is
-- recorded in a race with no signal and the due date is projected there and then — and writable
-- only by the elevated migration/admin path, never by werf_app.
--
-- ⭐ NO `jurisdiction` COLUMN, and that is the difference from every other reference table here.
-- A withdrawal period is a REGISTRATION and stops at the border; a gestation period is biology and
-- does not. Adding a jurisdiction column would make every future country restate that a cow
-- carries a calf for about 283 days, which is the mirror image of the ADR-0006 mistake — shared
-- biology leaking into a jurisdiction pack instead of a statute leaking into shared code.
--
-- ⭐ NO `effective_from`/`effective_to` either, for the same reason. Dated reference data exists
-- because a regulated number CHANGES ON A DATE and an old event must still resolve the rule that
-- applied to it (ADR-0005). A gestation figure that changes was simply wrong before; there is no
-- date to look it up by. Stored due dates are unaffected either way, because the projection is
-- computed AT CAPTURE and frozen onto the event.
GRANT SELECT ON species_gestation TO werf_app;--> statement-breakpoint
ALTER TABLE species_gestation ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE species_gestation FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY species_gestation_read ON species_gestation FOR SELECT USING (true);--> statement-breakpoint

-- The four species that gestate and for which ONE mean figure is a defensible projection.
--
-- ⛔ `poultry` and `game` are ABSENT ON PURPOSE, and their absence is the feature. A hen does not
-- gestate — 21 days is INCUBATION, a different biological event this product does not model — and
-- `game` is a category, not a species: a springbok is about 168 days and a kudu about 270, so any
-- single number stored here would be wrong for most of the animals it was read for. A species with
-- no row cannot have a due date projected for it, the breeding screens do not offer it, and the
-- server refuses rather than inventing one. That is the same discipline as a missing regulated
-- rate: a loud absence beats a quiet fabrication.
INSERT INTO species_gestation (species, gestation_days, source) VALUES
	('cattle', 283, 'Species mean, standard veterinary reference (Merck Veterinary Manual, reproductive parameters). Breed variation is real — Brahman run longer than Angus — so this projects a date, it does not promise one.'),
	('sheep', 147, 'Species mean, standard veterinary reference (Merck Veterinary Manual, reproductive parameters). Typical range 144–151 days.'),
	('goat', 150, 'Species mean, standard veterinary reference (Merck Veterinary Manual, reproductive parameters). Typical range 145–155 days.'),
	('pig', 114, 'Species mean, standard veterinary reference (Merck Veterinary Manual, reproductive parameters). The stockman''s "three months, three weeks and three days".')
ON CONFLICT (species) DO NOTHING;
