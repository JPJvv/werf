# Database Schema

PostgreSQL 16 + PostGIS. Drizzle ORM. This document is the source of truth; `packages/db/schema/` implements it.

---

## 1. Rules that apply to every table

These are not style preferences. Each one exists because violating it breaks sync, tenancy, or the law.

| Rule | Why |
|---|---|
| **UUIDv7 primary keys, client-generated** | The client is offline. It cannot ask a sequence for an ID. v7 (not v4) because it is time-ordered, so index locality survives. |
| **`farm_id` on every domain table** | Tenancy. RLS depends on it. A table without it cannot be secured. **The only exemption is reference data that belongs to nobody** — `regulatory_rates`, `chemical_products`, `market_prices`. These carry `jurisdiction` instead and are read-only to every client. If you are reaching for this exemption for anything a farmer typed, you are wrong. |
| **Soft delete (`deleted_at timestamptz`)** | Sync needs tombstones; audit needs history; compliance needs retention. A hard `DELETE` breaks replication *and* destroys records the BCEA requires us to keep. |
| **`created_at`, `updated_at`, `created_by`, `updated_by`** | Audit. Non-negotiable. |
| **`occurred_at` on anything that happened** | **The most important column in the database.** When it happened on the farm ≠ when the row was written. They differ by weeks. Reports use `occurred_at`. Sync uses `updated_at`. Confusing them puts a March calving in the April report. |
| **Money is `numeric(14,2)`** | Never float. Ever. |
| **Timestamps are `timestamptz`** | Stored UTC, displayed `Africa/Johannesburg`. |
| **Geometry is dual-written** | `geometry(...,4326)` for PostGIS queries + `geojson text` for the client. SQLite has no PostGIS. Both, always, kept consistent by a trigger. |
| **`attributes jsonb` validated by Zod** | See [ADR-0004](adr/ADR-0004-enterprise-model.md). Anything reported on is a real column. |
| **`jurisdiction` on anything regulated** | ISO 3166-1 alpha-2. Always `'ZA'` in v1. Costs one line today; costs a migration across 10k partitioned farms in year three. See [ADR-0006](adr/ADR-0006-multi-jurisdiction.md). |

---

## 2. Core

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_uuidv7;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE enterprise_type AS ENUM (
  'beef_cattle','dairy','sheep','goats','pigs','poultry','game',
  'row_crops','vegetables','orchards','vineyards','other'
);
CREATE TYPE user_role AS ENUM ('owner','manager','worker','bookkeeper','viewer','external');

CREATE TABLE businesses (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  name          text NOT NULL,
  registration_number text,
  vat_number    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE TABLE farms (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  business_id   uuid NOT NULL REFERENCES businesses(id),
  name          text NOT NULL,
  -- ⭐ The jurisdiction whose law this farm operates under. NOT the user's location.
  -- v1 is locked to 'ZA' by a CHECK; the column exists so the second country is a
  -- registry entry, not a migration. See ADR-0006.
  jurisdiction  char(2) NOT NULL DEFAULT 'ZA',
  province      text NOT NULL,           -- drives controlled-area rules
  district      text,
  enterprise_types enterprise_type[] NOT NULL DEFAULT '{}',   -- ⭐ drives the whole UI
  centroid      geometry(Point,4326),
  centroid_geojson text,
  boundary      geometry(MultiPolygon,4326),
  boundary_geojson text,
  hectares      numeric(10,2),
  timezone      text NOT NULL DEFAULT 'Africa/Johannesburg',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  -- v1 lock. Removing this CHECK is the deliberate act of adding a country —
  -- it should require a migration and a conversation, not a config flag.
  CONSTRAINT farms_jurisdiction_v1 CHECK (jurisdiction = 'ZA')
);

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  email         citext UNIQUE,
  phone         text UNIQUE,
  password_hash text,                    -- argon2id
  full_name     text NOT NULL,
  locale        text NOT NULL DEFAULT 'en-ZA',   -- per USER, not per farm (SRS-19)
  theme         text NOT NULL DEFAULT 'light',   -- 'light'|'dark'|'system' (FR-016)
  -- ⭐ 2FA. See ADR-0007. TOTP seed encrypted with the PII key, NOT the DB key.
  -- SMS is NEVER a second factor: SIM swap is industrialised in South Africa,
  -- and SMS is the one factor that doesn't work in a camp with no signal.
  totp_secret_encrypted  bytea,
  totp_enrolled_at       timestamptz,
  recovery_codes_hashed  text[],          -- argon2id, single-use, 10 issued
  last_seen_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT users_contact CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

-- Passkeys (WebAuthn). Public keys — nothing here is secret, which is the point.
-- A breach of this table gives an attacker nothing. Compare a TOTP seed table.
CREATE TABLE user_passkeys (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id       uuid NOT NULL REFERENCES users(id),
  credential_id bytea NOT NULL UNIQUE,
  public_key    bytea NOT NULL,
  sign_count    bigint NOT NULL DEFAULT 0,
  transports    text[],
  device_label  text,                     -- "Samsung A15" — so a user can revoke one
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  deleted_at    timestamptz
);

-- Role is per FARM, not per user (SRS-12). Manager on one, worker on another.
CREATE TABLE farm_users (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  farm_id       uuid NOT NULL REFERENCES farms(id),
  user_id       uuid NOT NULL REFERENCES users(id),
  role          user_role NOT NULL,
  scope         jsonb,                   -- for 'external': {"herds":["..."],"modules":["health"]}
  expires_at    timestamptz,             -- for 'external'
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  UNIQUE (farm_id, user_id)
);

-- The financial attribution unit. Everything costs something to an enterprise.
CREATE TABLE enterprises (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  farm_id       uuid NOT NULL REFERENCES farms(id),
  name          text NOT NULL,           -- "Beef cattle", "Maize 2026", "Chardonnay"
  type          enterprise_type NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
```

---

## 3. Land — camps and blocks

One table. A camp and a block are the same thing wearing different words; the terminology layer decides which word the user sees.

```sql
CREATE TYPE land_unit_kind AS ENUM ('camp','block','other');

CREATE TABLE land_units (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  farm_id       uuid NOT NULL REFERENCES farms(id),
  enterprise_id uuid REFERENCES enterprises(id),
  parent_id     uuid REFERENCES land_units(id),   -- block splitting (FR-202)
  kind          land_unit_kind NOT NULL,
  code          text NOT NULL,                    -- "Camp 3", "B12"
  name          text,
  boundary      geometry(Polygon,4326),
  boundary_geojson text,                          -- ⭐ the client reads this
  hectares      numeric(10,2),
  carrying_capacity_lsu numeric(8,2),             -- camps
  soil_type     text,                             -- blocks
  irrigation    text,
  attributes    jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  UNIQUE (farm_id, code)
);
CREATE INDEX land_units_boundary_gix ON land_units USING GIST (boundary);
CREATE INDEX land_units_farm_idx ON land_units (farm_id) WHERE deleted_at IS NULL;
```

**The geometry trigger.** Keeping the dual write consistent by convention will fail. Enforce it:

```sql
CREATE OR REPLACE FUNCTION sync_geojson() RETURNS trigger AS $$
BEGIN
  IF NEW.boundary IS DISTINCT FROM OLD.boundary THEN
    NEW.boundary_geojson := ST_AsGeoJSON(NEW.boundary);
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER land_units_geojson BEFORE INSERT OR UPDATE ON land_units
  FOR EACH ROW EXECUTE FUNCTION sync_geojson();
```

---

## 4. Animals

See [ADR-0004](adr/ADR-0004-enterprise-model.md). One table for every species.

```sql
CREATE TYPE animal_status AS ENUM ('alive','sold','dead','missing','culled');
CREATE TYPE animal_sex    AS ENUM ('male','female','castrated','unknown');

CREATE TABLE animals (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  farm_id       uuid NOT NULL REFERENCES farms(id),
  enterprise_id uuid REFERENCES enterprises(id),
  species       text NOT NULL,          -- 'cattle','sheep','goat','pig','poultry','game'
  breed         text,
  sex           animal_sex NOT NULL,
  dob           date,
  dob_estimated boolean NOT NULL DEFAULT false,
  status        animal_status NOT NULL DEFAULT 'alive',
  status_at     timestamptz,
  dam_id        uuid REFERENCES animals(id),
  sire_id       uuid REFERENCES animals(id),
  mob_id        uuid REFERENCES mobs(id),
  land_unit_id  uuid REFERENCES land_units(id),   -- denormalised current location
  source        text,
  acquired_at   date,
  brand_id      uuid REFERENCES branding_registers(id),  -- 🇿🇦 Animal Identification Act
  brand_applied_at date,                                 -- 🇿🇦 null past window = flag
  attributes    jsonb NOT NULL DEFAULT '{}',             -- Zod-validated per species
  photo_key     text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES users(id),
  updated_by    uuid REFERENCES users(id),
  deleted_at    timestamptz
);

CREATE INDEX animals_farm_live_idx ON animals (farm_id, species)
  WHERE deleted_at IS NULL AND status = 'alive';
CREATE INDEX animals_mob_idx  ON animals (mob_id) WHERE deleted_at IS NULL;
CREATE INDEX animals_dam_idx  ON animals (dam_id);
CREATE INDEX animals_sire_idx ON animals (sire_id);
CREATE INDEX animals_attrs_gin ON animals USING GIN (attributes);

-- Many identifiers per animal (FR-109). A visual tag, an EID, a brand, a tattoo,
-- a national LITS-SA id — all at once, all unique per farm per type.
CREATE TYPE identifier_type AS ENUM ('visual_tag','eid','brand','tattoo','national_id','other');

CREATE TABLE animal_identifiers (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  farm_id       uuid NOT NULL REFERENCES farms(id),
  animal_id     uuid NOT NULL REFERENCES animals(id),
  type          identifier_type NOT NULL,
  value         text NOT NULL,
  is_primary    boolean NOT NULL DEFAULT false,
  applied_at    date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE UNIQUE INDEX animal_identifiers_unique
  ON animal_identifiers (farm_id, type, value) WHERE deleted_at IS NULL;
CREATE INDEX animal_identifiers_lookup ON animal_identifiers (farm_id, value)
  WHERE deleted_at IS NULL;

CREATE TABLE mobs (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  farm_id       uuid NOT NULL REFERENCES farms(id),
  enterprise_id uuid REFERENCES enterprises(id),
  name          text NOT NULL,
  species       text NOT NULL,
  land_unit_id  uuid REFERENCES land_units(id),
  head_count    integer,                 -- for group-only management (FR-102)
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
```

**Why `head_count` on `mobs` when `animals` exists:** FR-102. A smallholder with 300 sheep does not want 300 individual records. They want "Flock A: 300 head" and the ability to record a group treatment. Individual records are opt-in per mob. Both models coexist in one schema, which is the point.

---

## 5. Events — the heart

Everything that happens is an event. Append-only. This is the highest-volume table in the system and the one that must never be got wrong.

```sql
CREATE TYPE event_type AS ENUM (
  'birth','death','weight','treatment','vaccination','dip','move','sale','purchase',
  'weaning','mating','pregnancy_test','condition_score','missing','recovered',
  'planting','spray','fertiliser','irrigation','harvest','scouting','soil_test',
  'attendance','piece_work','task_complete'
);

CREATE TABLE events (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  farm_id       uuid NOT NULL,
  enterprise_id uuid,
  type          event_type NOT NULL,

  -- ⭐ Three timestamps, three meanings. Getting these confused is the classic bug.
  occurred_at   timestamptz NOT NULL,   -- when it happened on the farm  → REPORTS USE THIS
  created_at    timestamptz NOT NULL DEFAULT now(),   -- when the row was written
  synced_at     timestamptz,                          -- when it reached the server

  animal_id     uuid REFERENCES animals(id),
  mob_id        uuid REFERENCES mobs(id),
  land_unit_id  uuid REFERENCES land_units(id),
  employee_id   uuid REFERENCES employees(id),
  batch_id      uuid,                   -- groups one action across many animals
  payload       jsonb NOT NULL,         -- Zod-validated per event_type
  location      geometry(Point,4326),
  location_geojson text,
  notes         text,
  created_by    uuid REFERENCES users(id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
) PARTITION BY LIST (farm_id);
```

**Partitioned by `farm_id` from day one.** At NFR-305 (500k events/farm/year) × NFR-301 (10k farms) this table is the constraint. Partitioning later means a migration on a table with billions of rows, which is a thing that does not happen. Partitioning now costs one line.

```sql
-- Partitions are created by the farm-provisioning path
CREATE OR REPLACE FUNCTION create_farm_partition(p_farm_id uuid) RETURNS void AS $$
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS events_%s PARTITION OF events FOR VALUES IN (%L)',
    replace(p_farm_id::text,'-','_'), p_farm_id);
END $$ LANGUAGE plpgsql;

CREATE INDEX events_farm_occurred ON events (farm_id, occurred_at DESC);
CREATE INDEX events_animal        ON events (animal_id, occurred_at DESC) WHERE animal_id IS NOT NULL;
CREATE INDEX events_type_occurred ON events (farm_id, type, occurred_at DESC);
CREATE INDEX events_batch         ON events (batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX events_payload_gin   ON events USING GIN (payload);
```

**Payload shapes** (Zod in `packages/core/schemas/events/`):

```ts
birth:     { calfId, damId, sireId?, birthWeightKg?, easeScore: 1|2|3|4|5, multiples: number }
weight:    { kg: number, method: 'scale'|'tape'|'visual' }
treatment: { productId, batchNumber?, doseMl, route, reason,
             meatClearDate, milkClearDate }        // ⭐ computed at capture, stored
spray:     { productId, activeIngredients: string[], rateLPerHa, waterLPerHa,
             operator, equipment, windKph?, tempC?, targetPest,
             phiDays, earliestHarvestDate }        // ⭐ computed at capture, stored
harvest:   { quantity, unit, grade?, destination?, phiOverride?: { reason, by } }
attendance:{ startAt, endAt, breakMin, pin, gps? }
```

**Why withdrawal and PHI dates are stored, not computed on read:** the animal is sold two years later and the product's registered withdrawal period has since changed. The rule that applied is the rule *at the time of treatment*. Computing on read would apply today's rule to yesterday's event — the same class of bug that [ADR-0005](adr/ADR-0005-regulatory-rates.md) exists to prevent.

**Herd/species scoping on every event (FR-113) — implemented, and stamped rather than joined.** A mixed farm runs cattle *and* sheep *and* pigs; an event must file under the herd it concerns or the capture screen has "nowhere to mark it correctly." The mechanism is the `enterprise_id` column *already on `events`*: an enterprise is species-specific (a "Beef cattle" enterprise is `beef_cattle`, a "Dorper flock" is `sheep`), so tagging the event with `enterprise_id` gives it a herd. No schema change was needed. Three parts, all in place:

- **Nothing enters the log unfiled.** `assertHerdScoped` (@werf/domain) refuses an event that names neither an `animal_id`, a `mob_id`, nor an `enterprise_id`, and it is called inside the single shared `insertEvent` helper — so a capture added in a later phase cannot skip it. The one class of exception is a fact about the FARM rather than a herd, and it is a closed list: `FARM_SCOPED_EVENT_TYPES` in `@werf/core` (today just `rainfall`). A new event type is herd-scoped by default and has to be named there to escape the rule.
- **⭐ For an animal/mob event the herd is STAMPED at capture, not derived by joining to the subject on read.** This note previously said derivable-from-`animal_id`, and that was a mistake worth correcting: an animal can be moved between herds, so a report that joined to the animal's *current* enterprise would quietly re-file last season's dosing under the herd the animal is in today. The server reads the herd off the subject's own row at capture time and writes it onto the event — the same reasoning that stores withdrawal dates instead of recomputing them ([ADR-0005](adr/ADR-0005-regulatory-rates.md)). It is derived server-side and never taken from the request body, so a client cannot file a cow's weight under the sheep flock, and a capture composed by an older client still files itself correctly on arrival.
- **Capture asks for the herd, once.** An animal is filed under a herd when it is created, so every later event on it inherits one without asking again. The picker replaces the species picker rather than joining it — the herd answers both, so a sheep cannot be filed under the cattle enterprise, and two herds of the *same* species ("Bonsmara cows", "Feedlot") can be told apart, which a species never could. A farm with one herd is asked nothing and shown where the animal went. The animals read model takes an optional herd filter; the whole-farm total never filters, so an animal with no herd yet is never hidden.

**`rainfall` event type (FR-213) — implemented (migration 0014).** Environmental, **not** species-scoped: a `rainfall` event is farm/`land_unit`-scoped (`animal_id`/`mob_id`/`enterprise_id` all null), payload `{ mm: number, gauge?: string }`, `occurred_at` = the day the gauge was read. `mm` is non-negative rather than positive, because a dry gauge is a real reading. Added by one additive `ALTER TYPE ... ADD VALUE` (which is why the enum is enumerated) with the value appended last so the Postgres enum and `EVENT_TYPES` stay in the same order. Both grazing (rest/rotation) and cropping read it, so it is cross-cutting, not crop-only — and it is why `FARM_SCOPED_EVENT_TYPES` exists.

---

## 6. Labour 🇿🇦

Read [legal-compliance.md §2](../00-business/legal-compliance.md) before touching this.

```sql
CREATE TYPE contract_type AS ENUM ('permanent','seasonal','casual','fixed_term');

CREATE TABLE employees (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  farm_id       uuid NOT NULL REFERENCES farms(id),
  user_id       uuid REFERENCES users(id),     -- if they have app access
  full_name     text NOT NULL,

  -- ⭐ Encrypted with a key SEPARATE from the DB key. Masked in every UI.
  -- Never logged. Never synced to a device (NFR-215).
  id_number_encrypted bytea,
  bank_account_encrypted bytea,

  date_of_birth date NOT NULL,                 -- 🇿🇦 FR-318: block <15, flag 15-17
  job_title     text NOT NULL,
  contract_type contract_type NOT NULL,
  start_date    date NOT NULL,
  end_date      date,
  wage_rate     numeric(14,2) NOT NULL,
  wage_unit     text NOT NULL,                 -- 'hour','day','month'
  ordinary_hours_per_week numeric(4,1) NOT NULL DEFAULT 45,
  locale        text NOT NULL DEFAULT 'en-ZA', -- ⭐ payslip/contract language (SRS-20)
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

-- ⭐⭐ THE most important table in the labour module. See ADR-0005 and ADR-0006.
CREATE TABLE regulatory_rates (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  jurisdiction  char(2) NOT NULL DEFAULT 'ZA',   -- ⭐ ADR-0006
  code          text NOT NULL,        -- 'NMW_FARM','BCEA_THRESHOLD','UIF_CEILING',...
  value         numeric(14,4) NOT NULL,
  unit          text NOT NULL,
  effective_from date NOT NULL,
  effective_to  date,                 -- NULL = in force
  gazette_reference text NOT NULL,    -- ⭐ NOT NULL. Every rate traces to a source.
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (jurisdiction, code, effective_from)
);
CREATE INDEX regulatory_rates_lookup
  ON regulatory_rates (jurisdiction, code, effective_from DESC);

-- Seed. VERIFY AGAINST THE GAZETTE BEFORE USING — these decay annually.
INSERT INTO regulatory_rates (jurisdiction, code, value, unit, effective_from, effective_to, gazette_reference) VALUES
  ('ZA','NMW_FARM', 28.79, 'ZAR_PER_HOUR', '2025-03-01', '2026-02-28', 'GG (2025) — verify'),
  ('ZA','NMW_FARM', 30.23, 'ZAR_PER_HOUR', '2026-03-01', NULL,        'GG 54075, 2026-02-03'),
  ('ZA','BCEA_THRESHOLD', 261748.45, 'ZAR_PER_YEAR', '2025-04-01', '2026-04-30', 'GG (2025) — verify'),
  ('ZA','BCEA_THRESHOLD', 269600.90, 'ZAR_PER_YEAR', '2026-05-01', NULL,         'GN 7384, GG 54544, 2026-04-17'),
  ('ZA','OVERTIME_MULTIPLIER',        1.5, 'FACTOR',  '2000-01-01', NULL, 'BCEA s10'),
  ('ZA','SUNDAY_MULTIPLIER',          2.0, 'FACTOR',  '2000-01-01', NULL, 'BCEA s16'),
  ('ZA','PUBLIC_HOLIDAY_MULTIPLIER',  2.0, 'FACTOR',  '2000-01-01', NULL, 'BCEA s18'),
  ('ZA','OVERTIME_WEEKLY_CAP_HOURS', 10.0, 'HOURS',   '2000-01-01', NULL, 'BCEA s10'),
  ('ZA','DEDUCTION_CAP_ACCOMMODATION', 0.10, 'FRACTION_OF_WAGE', '2000-01-01', NULL, 'SD13'),
  ('ZA','DEDUCTION_CAP_FOOD',          0.10, 'FRACTION_OF_WAGE', '2000-01-01', NULL, 'SD13');

-- Note every code above is a SOUTH AFRICAN statute name. That is correct HERE —
-- this is jurisdiction-scoped data. It would be a defect in packages/core.
-- See ADR-0006 § the naming rule.

CREATE TABLE payroll_runs (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  farm_id       uuid NOT NULL REFERENCES farms(id),
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  status        text NOT NULL,        -- 'draft','warned','approved','paid'
  approved_by   uuid REFERENCES users(id),
  approved_at   timestamptz,
  warnings      jsonb NOT NULL DEFAULT '[]',   -- ⭐ shown BEFORE approval (FR-307)
  total_gross   numeric(14,2),
  total_net     numeric(14,2),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (farm_id, period_start, period_end)
);

CREATE TABLE payslips (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  farm_id       uuid NOT NULL,
  payroll_run_id uuid NOT NULL REFERENCES payroll_runs(id),
  employee_id   uuid NOT NULL REFERENCES employees(id),
  ordinary_hours numeric(6,2) NOT NULL DEFAULT 0,
  overtime_hours numeric(6,2) NOT NULL DEFAULT 0,
  sunday_hours   numeric(6,2) NOT NULL DEFAULT 0,
  holiday_hours  numeric(6,2) NOT NULL DEFAULT 0,
  piece_units    numeric(10,2),
  lines         jsonb NOT NULL,   -- ⭐ every line, with the rate AND the gazette ref used
  gross         numeric(14,2) NOT NULL,
  deductions    jsonb NOT NULL,
  net           numeric(14,2) NOT NULL,
  pdf_key       text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payroll_run_id, employee_id)
);
```

**`payslips.lines` carries the gazette reference for every rate used.** When a labour lawyer asks in 2029 why Thabo was paid R28.79/hour in February 2026, the payslip itself answers: `GG 54075`. Not a lookup. Not an inference. The document says so.

```sql
-- Health data. POPIA s26. Restricted to owner + H&S role. NEVER synced broadly.
CREATE TABLE injury_records (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  farm_id       uuid NOT NULL REFERENCES farms(id),
  employee_id   uuid NOT NULL REFERENCES employees(id),
  occurred_at   timestamptz NOT NULL,
  description   text NOT NULL,
  body_part     text,
  treatment     text,
  days_lost     integer,
  reported_to_coida boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
```

### Delegation and tasks

```sql
CREATE TYPE task_status AS ENUM ('open','in_progress','blocked','done','cancelled');

CREATE TABLE tasks (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  farm_id       uuid NOT NULL REFERENCES farms(id),
  title         text NOT NULL,
  description   text,
  status        task_status NOT NULL DEFAULT 'open',
  priority      smallint NOT NULL DEFAULT 2,

  -- ⭐ The delegation chain, recorded rather than inferred. "Who told me to do
  --    this" is the question that matters when work goes wrong.
  assigned_by_user_id uuid NOT NULL REFERENCES users(id),
  assigned_to_user_id uuid REFERENCES users(id),
  team_id             uuid,
  parent_task_id      uuid REFERENCES tasks(id),   -- manager re-delegates a slice

  due_at        timestamptz,
  occurred_at   timestamptz,                        -- when the work was actually done
  completed_at  timestamptz,
  completed_by_user_id uuid REFERENCES users(id),
  requires_completion_photo boolean NOT NULL DEFAULT false,   -- FR-338

  enterprise_id uuid REFERENCES enterprises(id),
  land_unit_id  uuid REFERENCES land_units(id),
  recurrence_rule text,                             -- RFC 5545 RRULE; NULL = one-off
  recurrence_parent_id uuid REFERENCES tasks(id),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id),
  deleted_at timestamptz
);
CREATE INDEX tasks_assignee ON tasks (farm_id, assigned_to_user_id, status, due_at);
CREATE INDEX tasks_due      ON tasks (farm_id, due_at) WHERE status <> 'done';
```

**Role administration is a rule, not a column** (FR-322/323). A user may create or edit a `farm_users` row only for a role strictly below their own, enforced in a policy — and it is separate from access to the `employees` row for the same person. **A manager may administer a worker's account and may not see their wage, ID number, or banking.** Two different grants that look like one; keeping them separate is the whole of FR-323.

### Grievances 🇿🇦

```sql
CREATE TYPE grievance_status AS ENUM ('lodged','acknowledged','investigating','resolved','withdrawn');

CREATE TABLE grievances (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  farm_id       uuid NOT NULL REFERENCES farms(id),

  -- ⭐ NULL when lodged anonymously, and it must be genuinely null — not a
  --    "hidden" flag over a populated column that a support query can read back.
  raised_by_employee_id uuid REFERENCES employees(id),
  is_anonymous  boolean NOT NULL DEFAULT false,

  -- ⭐ Who this grievance is ABOUT. This column exists solely so the row can be
  --    HIDDEN from them (FR-332). It is never used to display anything to them.
  concerns_user_id uuid REFERENCES users(id),
  routed_to_user_id uuid NOT NULL REFERENCES users(id),

  category      text NOT NULL,
  body          text NOT NULL,
  status        grievance_status NOT NULL DEFAULT 'lodged',
  resolution    text,
  resolved_at   timestamptz,
  occurred_at   timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
```

> ⚠️ **`grievances` is server-only and it is exempt from the `audit_log` pattern in one respect: the audit row must not leak the body to a farm-scoped reader.** The confidentiality guarantee (FR-332) is worthless if the manager complained about can read the grievance out of the audit trail, and "the audit log is admin-only" is not an answer on a farm where the owner's brother is the manager.
>
> **Anonymity must survive metadata.** If `is_anonymous`, then no `created_by`, no device identifier, and no `audit_log` row that pins the insert to a session. If we cannot deliver that end-to-end, the UI says **confidential**, not **anonymous**, because overclaiming here gets a worker identified.

### Documents 🇿🇦

```sql
CREATE TYPE document_kind AS ENUM (
  'contract','payslip_ack','policy','induction','training_certificate',
  'licence','permit','id_document','medical_certificate','other'
);

CREATE TABLE documents (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  farm_id       uuid NOT NULL REFERENCES farms(id),
  employee_id   uuid REFERENCES employees(id),
  kind          document_kind NOT NULL,
  title         text NOT NULL,
  object_key    text NOT NULL,          -- object store; same convention as photo_key
  issued_at     date,
  expires_at    date,                   -- drives the renewal alert (FR-809)
  -- ⭐ POPIA s26. TRUE for medical_certificate, always. Restricts every read path.
  is_health_data boolean NOT NULL DEFAULT false,
  acknowledged_at timestamptz,          -- FR-336
  acknowledged_language char(5),        -- which language it was presented in
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id),
  deleted_at timestamptz,
  CHECK (kind <> 'medical_certificate' OR is_health_data)
);
CREATE INDEX documents_expiry ON documents (farm_id, expires_at)
  WHERE expires_at IS NOT NULL AND deleted_at IS NULL;
```

**The `CHECK` is the point.** A medical certificate cannot be inserted as ordinary data by an endpoint that forgot, because the constraint refuses it. Health-data restriction (FR-334) is then one predicate on one column rather than a rule every read path has to remember — and the approver's leave screen selects the leave row and `expires_at`, never the `object_key`.

---

## 7. Compliance 🇿🇦

```sql
-- Animal Identification Act 6 of 2002
CREATE TABLE branding_registers (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  farm_id       uuid NOT NULL REFERENCES farms(id),
  jurisdiction  char(2) NOT NULL DEFAULT 'ZA',   -- mark rules are national
  mark          text NOT NULL,          -- ZA: ≤3 characters (Animal Identification Act)
  mark_type     text NOT NULL,          -- 'tattoo','freeze_brand','hot_brand'
  species       text[] NOT NULL,
  body_position text,
  certificate_reference text,
  registered_at date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  -- ⚠️ The ≤3 rule is South African. When a second jurisdiction arrives this
  -- CHECK moves into AnimalIdentityRules (ADR-0006), because Namibia's marks
  -- are not South Africa's marks. Fine as a CHECK while ZA is the only country.
  CONSTRAINT mark_length CHECK (char_length(mark) <= 3)
);

-- Stock Theft Act 57 of 1959.
-- ⚠️ NOTE WHAT IS ABSENT: there is no suspect column, and there never will be.
-- See legal-compliance.md §3.2 — defamation exposure for our customer,
-- POPIA s26 criminal-behaviour processing exposure for us.
CREATE TABLE theft_incidents (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  farm_id       uuid NOT NULL REFERENCES farms(id),
  discovered_at timestamptz NOT NULL,
  last_seen_at  timestamptz,
  last_seen_location geometry(Point,4326),
  last_seen_location_geojson text,
  land_unit_id  uuid REFERENCES land_units(id),
  head_count    integer NOT NULL,
  case_number   text,                            -- ZA copy: "SAPS case number" (ADR-0006: neutral column)
  reporting_station text,                        -- ZA copy: "SAPS station"
  status        text NOT NULL DEFAULT 'open',   -- 'open','recovered','closed'
  observations  text,                            -- facts only
  evidence_pack_key text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE TABLE theft_incident_animals (
  incident_id   uuid NOT NULL REFERENCES theft_incidents(id),
  animal_id     uuid NOT NULL REFERENCES animals(id),
  recovered_at  timestamptz,
  PRIMARY KEY (incident_id, animal_id)
);

-- Reference data. Synced read-only to the client so the PHI/withdrawal
-- check works in the crush with no signal.
CREATE TABLE chemical_products (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  jurisdiction  char(2) NOT NULL DEFAULT 'ZA',   -- ⭐ a registration is per-country
  name          text NOT NULL,
  registration_number text NOT NULL,   -- ZA: Act 36 of 1947
  active_ingredients text[] NOT NULL,
  crop          text,
  phi_days      integer,               -- pre-harvest interval
  reentry_hours integer,
  version       integer NOT NULL DEFAULT 1,
  effective_from date NOT NULL,
  effective_to  date,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE veterinary_products (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  jurisdiction  char(2) NOT NULL DEFAULT 'ZA',
  name          text NOT NULL,
  registration_number text,
  active_ingredients text[] NOT NULL,
  species       text[] NOT NULL,
  meat_withdrawal_days integer,
  milk_withdrawal_hours integer,
  dose_per_kg   numeric(10,4),
  route         text,
  version       integer NOT NULL DEFAULT 1,
  effective_from date NOT NULL,
  effective_to  date,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE compliance_checklists (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  farm_id       uuid NOT NULL REFERENCES farms(id),
  standard      text NOT NULL,          -- 'globalgap_ifa','siza_social','siza_env'
  standard_version text NOT NULL,
  cycle_year    integer NOT NULL,
  status        text NOT NULL DEFAULT 'in_progress',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE compliance_items (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  farm_id       uuid NOT NULL,
  checklist_id  uuid NOT NULL REFERENCES compliance_checklists(id),
  control_point text NOT NULL,
  level         text NOT NULL,          -- 'major_must','minor_must','recommendation'
  status        text NOT NULL DEFAULT 'not_started',
  evidence_ref  jsonb,                  -- ⭐ points at rows already in the system
  corrective_action text,
  owner_user_id uuid REFERENCES users(id),
  due_date      date,
  closed_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
```

**`compliance_items.evidence_ref` is the whole GlobalGAP feature.** It is a pointer at data that already exists because the farmer recorded a spray. Audit prep stops being data entry and becomes gap-closing. That is the difference between a fortnight and an afternoon, and it is the sentence the salesperson says.

---

## 8. Fleet & fuel

FR-509…518, FR-616…619. Bulk diesel is bought, stored on the property, drawn down vehicle by vehicle, stolen, and refunded by SARS. Four of those five need a ledger with a balance.

```sql
CREATE TYPE fuel_type    AS ENUM ('diesel_50ppm','diesel_500ppm','petrol_93','petrol_95','lpg','other');
CREATE TYPE meter_type   AS ENUM ('odometer','hour_meter','none');
CREATE TYPE vehicle_kind AS ENUM ('tractor','bakkie','truck','harvester','loader','atv',
                                  'implement','pump','generator','other');

CREATE TABLE vehicles (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  farm_id        uuid NOT NULL,
  enterprise_id  uuid REFERENCES enterprises(id),  -- default attribution, overridable per dispense
  fleet_number   text NOT NULL,                    -- what is painted on the door
  registration   text,                             -- NULL for an unlicensed implement
  kind           vehicle_kind NOT NULL,
  make           text, model text, year int,
  fuel_type      fuel_type,
  tank_capacity_ml  integer,
  meter           meter_type NOT NULL DEFAULT 'none',
  meter_reading   integer,                         -- last known: km, or engine hours
  road_use        boolean NOT NULL DEFAULT false,  -- ⭐ drives the SARS eligible/non-eligible default
  -- FR-504 equipment register is specified but not yet schema'd (Phase 4). When it
  -- lands, a vehicle IS equipment: add `equipment_id uuid REFERENCES equipment(id)`
  -- additively and backfill. Do NOT duplicate maintenance scheduling here.
  photo_key       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (farm_id, fleet_number)
);

CREATE TABLE fuel_tanks (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  farm_id        uuid NOT NULL,
  name           text NOT NULL,                    -- 'Main diesel', 'Workshop petrol'
  fuel_type      fuel_type NOT NULL,
  capacity_ml    integer NOT NULL,
  low_threshold_ml integer,                        -- FR-514 warning
  land_unit_id   uuid REFERENCES land_units(id),
  location          geometry(Point,4326),
  location_geojson  text,                          -- ⭐ PostGIS does not sync. Both, always.
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (farm_id, name)
);
```

### The ledger

```sql
CREATE TYPE fuel_txn_type AS ENUM (
  'delivery',        -- bulk fill INTO a reserve            (+ tank)
  'dispense',        -- reserve OUT to a vehicle/activity   (− tank)
  'direct_purchase', -- filling station straight to vehicle (no tank)
  'transfer',        -- tank to tank
  'dip_adjustment',  -- measured reading reconciles the calculated balance
  'return'           -- fuel put back (drained, over-drawn)  (+ tank)
);

CREATE TABLE fuel_transactions (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  farm_id        uuid NOT NULL,
  type           fuel_txn_type NOT NULL,

  occurred_at    timestamptz NOT NULL,             -- when the nozzle was in the tank
  created_at     timestamptz NOT NULL DEFAULT now(),
  synced_at      timestamptz,

  tank_id        uuid REFERENCES fuel_tanks(id),   -- NULL only for 'direct_purchase'
  counter_tank_id uuid REFERENCES fuel_tanks(id),  -- 'transfer' destination
  vehicle_id     uuid REFERENCES vehicles(id),
  fuel_type      fuel_type NOT NULL,

  -- ⭐ SIGNED millilitres. The tank balance is one SUM, and it cannot disagree
  --    with itself. Never store a magnitude plus a direction flag.
  volume_ml      integer NOT NULL,
  meter_reading  integer,                          -- odometer km / engine hours at the nozzle
  price_per_litre_tc integer,                      -- ⭐ TENTHS of a cent. R21.95/ℓ = 21950
  total_cost_cents   bigint,                       -- Money. Rounded once, here.

  -- attribution (FR-517) — captured at the nozzle, not reconstructed in June
  enterprise_id  uuid REFERENCES enterprises(id),
  land_unit_id   uuid REFERENCES land_units(id),
  activity       text,
  operator_employee_id uuid REFERENCES employees(id),

  -- SARS (FR-616)
  refund_eligible boolean,                         -- NULL = not yet classified
  eligibility_reason text,

  supplier       text,
  invoice_ref    text,
  attachment_keys text[],                          -- photographed delivery note; same
                                                   -- object-store convention as animals.photo_key
  location          geometry(Point,4326),
  location_geojson  text,
  notes          text,
  created_by     uuid REFERENCES users(id),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,

  CHECK (type = 'direct_purchase' OR tank_id IS NOT NULL),
  CHECK (volume_ml <> 0)
);

CREATE INDEX fuel_txn_farm_occurred ON fuel_transactions (farm_id, occurred_at DESC);
CREATE INDEX fuel_txn_tank    ON fuel_transactions (tank_id, occurred_at DESC) WHERE tank_id IS NOT NULL;
CREATE INDEX fuel_txn_vehicle ON fuel_transactions (vehicle_id, occurred_at DESC) WHERE vehicle_id IS NOT NULL;
CREATE INDEX fuel_txn_refund  ON fuel_transactions (farm_id, refund_eligible, occurred_at);
```

**Why this is not in `events`, when §5 says everything is an event.** Because the tank balance is arithmetic, and `events.payload` is deliberately opaque jsonb. A running reserve level, a dip variance, and an eligible-litre total for a tax period are all `SUM()` over a signed integer column — that wants a typed column and a partial index, not a GIN lookup into jsonb on every read. The cost of this decision is explicit and must be paid, not assumed: `fuel_transactions` needs its **own** PowerSync sync rule, its **own** RLS policy, and its **own** row in `packages/sync/test/tenancy.spec.ts`. A new table that quietly skips those is exactly the leak §12 warns about.

**Tank balance** — one query, derived, never a stored counter that drifts:

```sql
CREATE VIEW fuel_tank_balances AS
  SELECT t.id AS tank_id, t.farm_id, t.capacity_ml,
         COALESCE(SUM(x.volume_ml), 0) AS balance_ml
  FROM fuel_tanks t
  LEFT JOIN fuel_transactions x
         ON x.tank_id = t.id AND x.deleted_at IS NULL
  WHERE t.deleted_at IS NULL
  GROUP BY t.id;
```

A `dip_adjustment` is how a measured reading meets the calculated one: the farmer enters what the dipstick says, and the system writes the **difference** as a signed transaction with a reason. The variance is therefore visible forever as its own row rather than silently absorbed into a corrected total.

> **⚠️ A dip variance is a fact about a tank, never an allegation about a person.** `fuel_transactions` has an `operator_employee_id` on a *dispense* because a farmer needs to know which machine drew fuel; a `dip_adjustment` has none, and the shrinkage report must not name one. This is the same rule, for the same two reasons — defamation exposure for our customer and POPIA s26 exposure for us — that keeps a suspect field off the stock theft pack (FR-603). It is asserted by test in both places.

### SARS diesel refund

```sql
CREATE TABLE diesel_refund_returns (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  farm_id        uuid NOT NULL,
  period_start   date NOT NULL,
  period_end     date NOT NULL,
  eligible_ml     bigint NOT NULL,
  non_eligible_ml bigint NOT NULL,
  refund_cents    bigint NOT NULL,
  -- ⭐ The rate rows actually applied, pinned. A return regenerated in 2029
  --    must reproduce to the cent, and the percentage changed on 2026-04-01.
  rate_refs      jsonb NOT NULL,
  generated_at   timestamptz NOT NULL DEFAULT now(),
  generated_by   uuid REFERENCES users(id),
  submitted_at   timestamptz,                      -- farmer tells us; we never file
  UNIQUE (farm_id, period_start, period_end)
);
```

Rates resolve through `rates.lookup(farm.jurisdiction, code, occurred_at)` per [ADR-0005](adr/ADR-0005-regulatory-rates.md) — codes `DIESEL_REFUND_PCT_ONLAND`, `FUEL_LEVY_REFUND_CPL`, `RAF_LEVY_REFUND_CPL`. **Per litre, by the date that litre was burnt, not by the return's end date.** A return for the period spanning 1 April 2026 refunds 80% of the litres before it and 100% of the litres after. This is structurally identical to a pay period spanning 1 March and it is tested the same way.

---

## 9. Market prices (reference)

FR-901…908. Server-populated, read-only on the device, and the only data in the product that cannot be produced offline.

```sql
CREATE TABLE market_price_series (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  jurisdiction   char(2) NOT NULL DEFAULT 'ZA',
  code           text NOT NULL UNIQUE,   -- 'SAFEX_WMAZ','BEEF_A2','DIESEL_50PPM_INLAND'
  label_en text NOT NULL, label_af text NOT NULL,
  unit           text NOT NULL,          -- 'ZAR_PER_TONNE','ZAR_PER_KG','ZAR_PER_LITRE'
  enterprise_types text[] NOT NULL,      -- FR-906: which farms ever see this
  source         text NOT NULL,          -- 'DMRE','JSE','RMAA'
  source_url     text,
  attribution    text,                   -- FR-908: what the licence obliges us to display
  cadence        text NOT NULL,          -- 'monthly','weekly','daily','intraday_delayed'
  -- ⭐ Licence enforced as DATA, not as a thing someone remembers.
  --    A series we may display but NOT redistribute to devices sets this false,
  --    and the sync rule reads it. See ADR-0009.
  syncable       boolean NOT NULL DEFAULT false,
  active         boolean NOT NULL DEFAULT true
);

CREATE TABLE market_prices (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  series_id      uuid NOT NULL REFERENCES market_price_series(id),
  contract_month date,                   -- SAFEX only; NULL for spot
  value_micros   bigint NOT NULL,        -- millionths of the unit. No floats, ever.
  -- ⭐ THREE timestamps, and the first one is the one the UI must show (FR-904).
  as_at          timestamptz NOT NULL,   -- what the SOURCE says the price is as at
  fetched_at     timestamptz NOT NULL,   -- when we pulled it
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (series_id, contract_month, as_at)
);
CREATE INDEX market_prices_series_asat ON market_prices (series_id, as_at DESC);
```

**No `farm_id`, and that is correct** — a maize price is not farm data. It is the same class as `regulatory_rates`: reference data, filtered on sync by the farm's `jurisdiction`, never written by a client. It is therefore the one table in this document exempt from the `farm_id` rule in §1, and the exemption is stated here so a reviewer does not have to guess.

**`as_at` vs `fetched_at` is the whole feature.** A weekly carcass price fetched this morning is still last week's price, and a farmer who reads it as today's will price a load wrong. The UI renders `as_at`; `fetched_at` exists so we can tell a stale *feed* from a stale *market*.

---

## 10. Audit

```sql
CREATE TABLE audit_log (
  id            bigserial PRIMARY KEY,
  farm_id       uuid NOT NULL,
  user_id       uuid,
  table_name    text NOT NULL,
  record_id     uuid NOT NULL,
  action        text NOT NULL,        -- 'insert','update','delete','conflict_resolved'
  before        jsonb,
  after         jsonb,
  source        text,                 -- 'web','sync','api','system'
  ip_address    inet,
  occurred_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_record ON audit_log (table_name, record_id, occurred_at DESC);
CREATE INDEX audit_log_farm   ON audit_log (farm_id, occurred_at DESC);

-- ⭐ Immutable at the database level (NFR-211). Not by convention. By grant.
REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC;
REVOKE UPDATE, DELETE ON audit_log FROM werf_app;
```

`bigserial`, not UUIDv7 — audit rows are written server-side only and never sync, so there is no offline ID problem, and a sequence gives cheap ordering.

---

## 11. RLS

Every domain table. No exceptions.

```sql
ALTER TABLE animals ENABLE ROW LEVEL SECURITY;
ALTER TABLE animals FORCE ROW LEVEL SECURITY;   -- ⭐ applies to the table owner too

CREATE POLICY animals_tenant ON animals
  USING (farm_id IN (
    SELECT farm_id FROM farm_users
    WHERE user_id = current_setting('app.user_id')::uuid
      AND deleted_at IS NULL
      AND (expires_at IS NULL OR expires_at > now())
  ));

-- Financial data: owner + bookkeeper only (SRS-13)
CREATE POLICY financial_role ON financial_transactions
  USING (farm_id IN (
    SELECT farm_id FROM farm_users
    WHERE user_id = current_setting('app.user_id')::uuid
      AND role IN ('owner','bookkeeper')
      AND deleted_at IS NULL
  ));

-- Health data: POPIA s26
CREATE POLICY injury_role ON injury_records
  USING (farm_id IN (
    SELECT farm_id FROM farm_users
    WHERE user_id = current_setting('app.user_id')::uuid
      AND role IN ('owner')
      AND deleted_at IS NULL
  ));

-- Fuel: the LOG is operational, the CLAIM is financial. Different policies,
-- on purpose — a manager must be able to dispense, and must not see the refund.
CREATE POLICY fuel_txn_tenant ON fuel_transactions
  USING (farm_id IN (
    SELECT farm_id FROM farm_users
    WHERE user_id = current_setting('app.user_id')::uuid
      AND deleted_at IS NULL
      AND (expires_at IS NULL OR expires_at > now())
  ));

CREATE POLICY diesel_refund_role ON diesel_refund_returns
  USING (farm_id IN (
    SELECT farm_id FROM farm_users
    WHERE user_id = current_setting('app.user_id')::uuid
      AND role IN ('owner','bookkeeper')
      AND deleted_at IS NULL
  ));

-- ⭐ Grievances: tenant scope is NOT enough. The person a grievance names must
--    not see it, even though they are a legitimate user of that farm (FR-332).
--    This is the only policy in the system that excludes a user from their OWN
--    farm's data, and it is deliberate.
CREATE POLICY grievance_access ON grievances
  USING (
    farm_id IN (
      SELECT farm_id FROM farm_users
      WHERE user_id = current_setting('app.user_id')::uuid
        AND role IN ('owner','manager')
        AND deleted_at IS NULL
    )
    AND (concerns_user_id IS NULL
         OR concerns_user_id <> current_setting('app.user_id')::uuid)
    AND (routed_to_user_id = current_setting('app.user_id')::uuid
         OR EXISTS (SELECT 1 FROM farm_users fu
                    WHERE fu.farm_id = grievances.farm_id
                      AND fu.user_id = current_setting('app.user_id')::uuid
                      AND fu.role = 'owner'))
  );

-- Health documents: POPIA s26. Same posture as injury_records.
CREATE POLICY documents_health ON documents
  USING (
    farm_id IN (
      SELECT farm_id FROM farm_users
      WHERE user_id = current_setting('app.user_id')::uuid
        AND deleted_at IS NULL
    )
    AND (NOT is_health_data
         OR EXISTS (SELECT 1 FROM farm_users fu
                    WHERE fu.farm_id = documents.farm_id
                      AND fu.user_id = current_setting('app.user_id')::uuid
                      AND fu.role = 'owner'))
  );
```

**`grievance_access` deserves the extra reading it demands.** Every other policy in this file answers "is this user in this farm". This one also answers "is this user the subject of this row", and excludes them if so. That is unusual enough to be worth a test with a name that says what it protects: a manager who is the subject of a grievance sees zero rows, zero notifications, and **no count that changed**. An inference channel defeats the guarantee as thoroughly as a read does.

`tasks` takes the ordinary tenant policy, plus a worker-scoped variant: a `worker` reads tasks assigned to them or their team, and nothing else. A worker who can enumerate the farm's whole task list can enumerate the farm's whole operation.

`vehicles` and `fuel_tanks` take the same tenant policy as `animals`. **`market_price_series` and `market_prices` are the one pair with no `farm_id` and therefore no tenant policy** — they are reference data like `regulatory_rates`, granted `SELECT` to the application role and written only by the server-side poller. That exemption is stated in §9 and repeated here so a reviewer applying "every domain table, no exceptions" does not go looking for a column that should not exist.

**`FORCE ROW LEVEL SECURITY` matters.** Without it, the table owner bypasses RLS, and the application role is often the owner in a small deployment. That is a cross-tenant leak waiting for the first migration that runs as owner.

**And the warning that bears repeating:** these policies are only one of three layers (§ Architecture 6). PowerSync sync rules are a *separate* system with its own language, and a permissive sync rule leaks data across farms even when every policy above is perfect — because replication does not go through the query path RLS protects. `packages/sync/test/tenancy.spec.ts` asserts the two agree. It is not optional and it does not get skipped.

---

## 12. Sync classification

Every table is one of these. This table is the input to both the sync rules and the tenancy test.

| Class | Tables | Rule |
|---|---|---|
| **Full sync** | `animals`, `animal_identifiers`, `mobs`, `land_units`, `events`, `enterprises`, `branding_registers`, `vehicles`, `fuel_tanks`, `fuel_transactions` | Farm-scoped, bidirectional |
| **Reference sync** | `chemical_products`, `veterinary_products`, `regulatory_rates`, `notifiable_diseases`, `public_holidays`, `market_price_series`, `market_prices` | **Filtered by the farm's `jurisdiction`**, read-only. Required for offline PHI/withdrawal checks. A ZA device never downloads Namibian withdrawal periods. |
| **Filtered sync** | `employees` (minus encrypted columns), `attendance` events, `tasks`, `documents` (metadata only, **excluding `is_health_data` rows**) | Role-gated |
| **Server only** | `payroll_runs`, `payslips`, `financial_transactions`, `injury_records`, `audit_log`, `compliance_items`, `user_passkeys`, `users.totp_secret_encrypted`, `diesel_refund_returns`, `grievances` | **Never touch a device.** Money, health, audit, and auth secrets stay home. |

The "server only" row is a security decision as much as an architectural one. A stolen phone should not contain 40 workers' payslips.

**The fuel tables sit on both sides of that line deliberately.** `fuel_transactions` is full-sync because the nozzle is in a shed with no signal and a log that needs a network is not a log. `diesel_refund_returns` is server-only because it is a money artefact and a statutory submission, and it belongs with `payroll_runs` for the same reason. The device holds the evidence; the server holds the claim.

**`tasks` sync, but only the assignee's own.** A worker's device holds the work assigned to them and their team, because a to-do list that needs a network is not a to-do list on a farm. It does not hold the farm's whole task board.

**`grievances` never sync, and `documents` sync as metadata with health rows excluded.** A grievance on a device is a grievance on a phone that a manager can pick up, and the confidentiality guarantee (FR-332) cannot survive that. Medical certificates are POPIA s26 and sit with `injury_records`. The device may know that a leave request has a certificate on file; it may not hold the certificate. **This is the one place where the offline-first default is deliberately overridden, and the override is the feature** — an approver works from dates and a boolean, both of which sync fine.

**`market_prices` is reference sync with one extra condition.** The sync rule must filter on `market_price_series.syncable`, because some series are licensed for display but not for redistribution ([ADR-0009](adr/ADR-0009-market-data-feeds.md)). A permissive rule here is not a tenancy leak — it is a **licence breach**, which is a different failure with the same root cause, and `packages/sync/test/tenancy.spec.ts` gains a case asserting a non-syncable series never reaches a device.

---

## 13. Retention

Enforced by a nightly job, per [legal-compliance.md §1.6](../00-business/legal-compliance.md).

```sql
-- ⚠️ The BCEA 3-year floor OVERRIDES a farmer's delete request.
-- POPIA s14 says delete when the purpose is served; BCEA s31 says keep 3 years.
-- The statutory retention wins. A "delete my account" button must not
-- destroy records the farmer is legally required to hold.
CREATE VIEW retention_eligible AS
  SELECT 'employees' AS table_name, id, deleted_at
  FROM employees
  WHERE deleted_at < now() - interval '3 years'
UNION ALL
  SELECT 'events', id, deleted_at
  FROM events
  WHERE deleted_at < now() - interval '30 days'
    AND type NOT IN ('treatment','spray','attendance')   -- these have statutory holds
UNION ALL
  -- ⚠️ FIVE years, and it is measured from the LATER of use and the refund return.
  -- Customs & Excise Act Schedule 6 Part 3 Note 6. This is the LONGEST hold in
  -- the system — longer than the BCEA's three — so it is the one that decides
  -- how long a "delete my farm" request actually takes to complete.
  SELECT 'fuel_transactions', x.id, x.deleted_at
  FROM fuel_transactions x
  WHERE x.deleted_at < now() - interval '5 years'
    AND x.occurred_at  < now() - interval '5 years'
    AND NOT EXISTS (
      SELECT 1 FROM diesel_refund_returns r
      WHERE r.farm_id = x.farm_id
        AND x.occurred_at BETWEEN r.period_start AND r.period_end
        AND r.generated_at > now() - interval '5 years');
```

---

## 14. Migrations

Drizzle Kit. `pnpm db:generate` diffs the schema and writes SQL; review it before committing — generated migrations are a draft, not an artifact.

Rules:
- Forward-only in production. Roll forward, never down.
- Additive first: add a column, backfill, switch reads, drop the old column in a later release. A device that has been offline for six weeks will sync against the new schema with old-shaped writes.
- Never rename in one step. Add → dual-write → backfill → switch → drop.
- **Every migration is tested against a restored production-shaped dump before it ships.**

The offline client is what makes migrations hard here. A farmer offline for a month is a real scenario, and their queued writes were composed against a schema that is now two releases old. Additive-only is not conservatism; it is the only thing that works.
