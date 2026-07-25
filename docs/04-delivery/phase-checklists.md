# Phase Checklists

The executable, per-phase task lists. Each phase ends with the same **exit gate**: `pnpm verify`
exits 0, the checklist is fully ticked, and the `reviewer` agent passes. One phase per PR unless noted.

Full narrative and the eight-phase arc live in `docs/04-delivery/roadmap.md` (to be written).

---

## Phase 0 — Scaffold & repo hygiene

Goal: a monorepo that builds green and empty, with the repo set up the way an employer should see it.
No product features yet. **Plan the scaffold before writing code.**

```
□ pnpm monorepo: pnpm-workspace.yaml, turbo.json, root package.json, tsconfig base
□ Packages skeleton: packages/core, packages/ui, packages/db, packages/domain,
  packages/sync; apps/web (React 19 + Vite PWA), apps/api (NestJS)
□ Tooling: eslint + prettier, tsconfig project references, vitest, playwright config
□ pnpm scripts wired: dev, build, test, test:e2e, lint, typecheck, verify
  (verify = lint && typecheck && test && build, must exit 0 on an empty repo)
□ @werf/core: Money type (integer cents), typed errors, Jurisdiction type, Zod schema barrel
□ @werf/ui: Tailwind theme extension emitting the design tokens as [data-theme] CSS variables
□ Theme bootstrap: inline script in index.html sets data-theme before first paint; light default,
  does not follow prefers-color-scheme unless opted in
□ git init; .gitignore covers .env*, *.pem, infra/secrets/, .claude/gate-off, node_modules, dist
□ LICENSE = AGPL-3.0; NOTICE with your copyright
□ git config user.email = your GitHub email  (or the contribution graph stays empty)
□ Verify authorship: git log --format='%an <%ae>' after the first session
□ gitleaks pre-commit hook + gitleaks in CI
□ .github: ci workflow (lint/typecheck/test/build, both-theme axe), issue templates, PR template
□ Seed data plan: synthetic only, obviously fake, invalid SA ID checksums
□ README with a screenshot slot and "What's interesting here"; SECURITY.md; CONTRIBUTING.md
□ Commit CLAUDE.md and .claude/ (they are engineering documentation, not embarrassing)
□ Branch protection on main: CI required, PR required
□ Milestones created for phases 0–7
```

**Exit gate:** `pnpm verify` exits 0 on the empty scaffold; CI is green on `main`; `git log` shows your
GitHub email; no secrets or real data anywhere in history.

---

## Phase 1 — App shell, auth & 2FA

Goal: a farmer can register a business, choose enterprise types, land on the enterprise-adaptive
home grid, and sign in securely — with the shell, theme, language, and session all surviving a
cold start with the network off. No livestock/crop/labour features yet; the grid's tiles are real
and enterprise-driven, their live numbers arrive with their modules in Phases 2+.

**Scope boundary (read first).** Full PowerSync replication of domain tables is **Phase 3**, not here.
Phase 1 delivers the shell + auth + offline **session/theme/locale** persistence via the
`packages/sync` local adapter (never the PowerSync SDK directly — `.claude/rules/frontend.md`,
ADR-0003). The sync-status strip renders real state but has little to sync until Phase 3. Auth is
server-authoritative (`apps/api`) against a real Postgres; the client caches the session for the
30-day offline window (ADR-0007).

```
Data & tenancy foundation
☑ Zod schemas in @werf/core/schemas: Business, Farm, User, FarmUser(role), Enterprise —
  the single source of truth; TS types via z.infer (FR-001..005)
☑ user_role + enterprise_type enums in @werf/core, matching docs/03-architecture/database-schema.md
☑ @werf/db: drizzle schema for businesses, farms, users, user_passkeys, farm_users, enterprises;
  farms.jurisdiction char(2) DEFAULT 'ZA' + CHECK (jurisdiction='ZA') (FR-018)
☑ RLS policies scoping every table by farm_id; PowerSync sync rules that AGREE with them,
  with the tenancy test (packages/sync/test/tenancy.spec.ts) covering a cross-farm leak (CLAUDE.md)
☑ Migrations via drizzle-kit; pnpm db:migrate / db:generate wired to a real local Postgres
☑ Regulated-lookup seam resolves by (jurisdiction, code, occurred_at), jurisdiction from the FARM (FR-019)
☑ db:seed: 3 synthetic farms (livestock, crop, mixed) — obviously fake, invalid SA ID checksums

Auth & 2FA (apps/api, NestJS — server-authoritative, integration-tested on real Postgres)
☑ Register a business: name, optional reg number, contact, physical address (FR-001)
☑ Select ≥1 enterprise type at onboarding; add/remove later, additively, no migration, no data loss (FR-002, FR-003)
☑ Create multiple farms under one business; switch active farm without re-login (FR-004)
☑ Invite a user by email/phone; assign a per-FARM role (role is per farm, not per user) (FR-005)
☑ Authenticate; issue access (15 min) + rotating single-use refresh (30 day) tokens (ADR-0007)
☑ 2FA mandatory for owner + bookkeeper, optional for manager: passkey (WebAuthn) preferred,
  TOTP (RFC 6238) universal fallback. SMS is NEVER a second factor (FR-014, ADR-0007)
☑ TOTP seed encrypted at rest with the PII key, not the DB key (ADR-0007)
☑ Recovery codes: 10, single-use, argon2id-hashed, shown once, printable; copy says "put them in the safe" (FR-014a)
☑ 2FA required at LOGIN, not at every refresh; a refresh expiring with writes queued HOLDS the queue,
  never clears it (ADR-0007, offline-sync invariant 5)

App shell (apps/web + @werf/ui)
☑ Routing + auth guard; unauthenticated → login; the shell renders offline from cached session (FR-006)
☑ 📶 Session persists offline for a configurable window (default 30 days) via the sync adapter (FR-006)
◐ 🇿🇦 Home = grid of ≥96px tiles GENERATED from farm.enterprise_types; fixed order, never personalised;
  2 cols phone / 3 tablet / 4 desktop; each tile carries ONE live number or ONE badge (FR-017).
  The grid, sizing, generation and fixed order are done. FIRST live number now populated (commit
  bd334d0): the animals tile carries `summariseHerd().liveTotal` from the local herd, live and
  reactive — capturing an animal moves it, and it survives a cold start. `Tile` metric/badge props
  are wired via HomeGrid `metrics`. Still ◐: the OTHER tiles (health "N due", etc.) have no number
  yet — they populate as their read models land.
  NOTE: this line previously read ☑ with the FR-017 clause deleted from it rather than met —
  exactly the rewording the exit gate below warns about. It was caught in review and restored.
◐ Terminology engine: "camp" for cattle, "block" for vines — decided in ONE place
  (`landTerm()` in `home/tiles.ts`), consumed by both the grid and the first-run guide, and
  covered by tests that pin the mixed-farm case. NOT yet read from a terminology table: the
  lookup moves there when the modules needing the full vocabulary land (Phase 2). Tile labels
  remain English-only for the same reason — translating them here would fork the vocabulary.
☑ Enterprise adaptation: a cattle farm never renders a Sprays tile; a vineyard never renders Herd (FR-002)
☑ Theme: light default, does NOT follow prefers-color-scheme unless "Match my phone" chosen;
  set before first paint (already bootstrapped); Settings → Appearance to change it (FR-016)
◐ Language switch EN ↔ Afrikaans per user; locale on the user, not the farm/browser (FR-008) —
  the account's locale is stored on the user row and adopted on every sign-in and cold start,
  so it follows the farmer onto a borrowed tablet. Two real remainders, both Phase 2:
  (a) there is no language control before sign-in — `LanguageSettings` sits behind `RequireAuth`,
  so although `RegisterScreen` submits the live UI locale, a farmer onboarding on a fresh device
  can only ever submit the default. An Afrikaans farmer cannot create an Afrikaans account.
  (b) a change made LATER from Settings is reverted on the next reload, because
  `AuthProvider` re-adopts `session.user.locale` on mount. It is session-scoped, not
  device-scoped as this line previously claimed. Both need a profile-update endpoint.
☑ 📶 Sync-status strip: persistent, non-modal — synced / N pending / syncing / error;
  copy says "saved"/"sent", never "sync" (FR-009)
☑ 📶 PWA install prompt at the right moment (deferred beforeinstallprompt), not on first paint (FR-007)
☑ 📶 Guided first-run: create first camp/block, first animal/planting, first employee (stubs to Phase 2+) (FR-010)

Quality gates
☑ Every write path works with the network off; no `if (!navigator.onLine) throw` anywhere
☑ axe-core: 0 violations in BOTH themes, wired into CI (NFR-401) — enables the deferred Phase 0 axe step
☑ API integration tests against real Postgres in testcontainers; no mocking our own DB
☑ Auth/session/2FA unit tests assert observable behaviour, not implementation
◐ Bundle ≤250KB gz (NFR-009); pnpm verify exits 0 — verify exits 0 and the bundle is 98.6KB gz,
  but the budget is MEASURED, not ENFORCED: nothing fails the build when it is exceeded.
  `.claude/rules/frontend.md` says it must. Wiring a size gate is a Phase 2 first task.
```

**Exit gate:** `pnpm verify` exits 0; `pnpm test:e2e` green (both-theme axe); CI green on `main`;
every checklist line is ☑ **or ◐ with its remainder named in the partial list below**; the
`reviewer` agent passes; a farmer can register → choose enterprises → enrol a second factor →
reach the adaptive grid → sign in, and the shell survives a cold start offline.

The "fully ticked" wording this gate used to carry has been replaced deliberately. A phase that
must be all-☑ to close pressures you into ticking a line you have not earned, or into quietly
rewording the line until it is true — both of which happened in draft here and were caught in
review. A ◐ that names precisely what is missing is worth more than a ☑ that is not quite honest.

**Deferred to later phases (not a Phase 1 miss):** FR-011/012/013 (external grants, export, import),
FR-014b (support-channel 2FA reset + 48h delay), FR-015 (global search), and full PowerSync
replication of domain data (Phase 3).

**Partially delivered — named so they are not mistaken for done:**
- **FR-014c (manage passkeys):** the API enrols, lists and revokes; there is no management UI.
- **FR-017 "one live number or one badge" per tile:** `Tile` accepts `metric`/`badge` props and
  nothing populates them, because no domain data exists to count until Phase 2. Tiles are doors.
- **Passkey enrolment from the client:** the API ceremonies are complete and tested; the client
  enrols TOTP only. A farmer can satisfy FR-014 today, but not with the factor ADR-0007 prefers.
- **FR-008 write-back:** the account's locale is applied on sign-in and set at onboarding, but a
  language change made later is device-scoped — there is no profile-update endpoint yet.
- **FR-004 farm switching:** the API switches active farm; the shell has no switcher UI, and no
  client path creates a second farm.
- **Invitation delivery:** `invite` records a membership; nothing emails or SMSes the invitee.

---

## Phase 2 — Livestock

Goal: a farmer on a cattle, sheep, goat, or mixed farm can define camps, create animals
(individually or as a mob), give them identifiers, record everything that happens to them —
births, deaths, sales, weaning, movements, treatments, vaccinations, dips, weights, mating,
pregnancy tests — and see a herd/flock summary, all with the network off. The SA-specific
spine lands too: the branding register, the unmarked-animal flag, marking an animal missing,
and the one-action stock-theft evidence pack. The home grid's tiles finally carry the live
numbers FR-017 promised, because there is now something to count.

**Scope boundary (read first — this is where Phase 2 ends and Phase 3 begins).**
The **PowerSync replication engine is still Phase 3.** Phase 2 builds livestock as
offline-first *through the ADR-0003 `packages/sync` seam*, exactly as Phase 1 built the
session: real capture behaviour against the local-data adapter interface now, the real
PowerSync SQLite/OPFS engine swapped underneath in Phase 3 with no UI rewrite. That means the
client's local-state layer in this phase is the adapter, not `usePowerSync` watched queries
directly (`.claude/rules/frontend.md`, ADR-0003). The server (`apps/api`) remains
authoritative for the schema, RLS, and anything the client must not compute (withdrawal
periods, the evidence-pack PDF). Every domain table gets its **PostGIS `geometry` + denormalised
GeoJSON `text`** pair (camps, event location) and its **sync TENANCY classification** in the
same commit as the table — both, always (CLAUDE.md gotchas).

**Compliance gate.** FR-131 (withdrawal periods), FR-601–605 (Animal Identification Act,
stock theft) and FR-614 (`regulatory_rates`) are legal, not cosmetic. Read
`docs/00-business/legal-compliance.md` FIRST for each, and the `compliance-checker` agent must
pass before any of them merges. No regulated number in code — withdrawal periods and the
unmarked-animal window resolve by `(jurisdiction, code, occurred_at)` through the FR-019 seam.

```
Land foundation (needed before animals have somewhere to live)
☑ 🇿🇦 land_units table + migration (0008) + RLS + TENANCY(farm-scoped); PostGIS
  geometry(Polygon,4326) + boundary_geojson text with the land_units_sync_geojson() trigger
  enforcing the dual write; `boundary` in neverSyncColumns (SQLite has no PostGIS). Proven end
  to end against real PostGIS: RLS isolation, WITH CHECK write-guard, trigger derives+updates
  geojson through the app path. postgis extension enabled here (first geometry table) (FR-150)
◐ Define a camp: code, name, GPS boundary, hectares, carrying_capacity_lsu (FR-150) — the DATA
  layer supports every field; the create ACTION (API endpoint + capture screen) is a later slice
☑ @werf/core Zod schema for LandUnit (record + new shapes) — DONE, with the boundary crossing
  the wire as GeoJSON text, never PostGIS. Terminology now comes from the real terminology layer
  (`apps/web/src/i18n/terminology.ts`), which decides the TERM while the dictionaries hold the word
  — so "camp"/"block" is one decision, translatable, and shared by the grid and the first-run guide

Core animal records (apps/api + @werf/core + @werf/db, integration-tested on real Postgres)
☑ animals table + animal_identifiers + mobs + enums (animal_status, animal_sex, identifier_type);
  migration (0009) + RLS (all three farm-scoped, ENABLE+FORCE) + TENANCY; GIN index on attributes.
  Proven against real PostGIS: RLS isolation, WITH CHECK write-guard, cross-farm hidden. `species`
  is text (new species = code release, not migration); brand_id deferred to the FR-601 slice
◐ Create an individual animal: species, breed, sex, DOB(+estimated), source, acquired_at (FR-101)
  — OFFLINE CAPTURE SCREEN done (`/animals/new`, commit bd334d0): writes a `newAnimalSchema` record
  (client uuidv7) through the @werf/sync capture-store adapter with NO network in the path, and the
  home tile counts it live. The LOCAL write now REACHES POSTGRES: the best-effort outbox flush
  (`apps/web/src/sync/Outbox.tsx`) sends the queued animal to `POST /livestock/animals` on reconnect,
  animals first so the events that reference them do not FK-fail. The animal is also FILED UNDER ITS HERD at capture (FR-113): on a farm with
  several the herd is the only subject question asked and the species follows from it; on a farm with
  one, nothing is asked and the herd is stated. Still ◐: only herd/species/sex/breed are captured on
  the screen (DOB, source, acquired_at, identifiers are later). DOB stays a YYYY-MM-DD string, never
  a coerced Date (off-by-one guard)
◐ Create a mob/flock and manage it by head_count without individual rows (FR-102) — data layer done
  and proven (a mob is a complete record with zero animal rows behind it); create ACTION pending
◐ Species-specific attributes via Zod-validated JSONB (FR-107, ADR-0006 AnimalIdentityRules seam) —
  the `attributes` jsonb column + GIN index exist and the schema leaves it an open record; the
  PER-SPECIES validator (horn_status for cattle, wool_class for sheep) is its own later slice
◐ Multiple identifiers per animal; UNIQUE(farm_id, type, value) partial on deleted_at IS NULL (FR-109)
  — schema + partial-unique DONE and proven, including reuse of a retired tag after soft-delete;
  the add-identifier ACTION (API + UI) is a later slice
◐ Move animals between mobs and camps; movement retained as an event, never an overwrite (FR-103)
  — capture DOMAIN LOGIC done (@werf/domain recordMove → a `move` event holding before AND after of
  camp+mob, plus the denormalised land_unit_id/mob_id change to apply; refuses a no-op and an animal
  that has left the herd; omit=unchanged vs null=cleared). `move` payload is now concrete in @werf/core.
  API endpoint + capture screen deferred
◐ 📶 Batch operations: apply one event to a selected group in one action, one batch_id (FR-112)
  — DOMAIN primitive done (@werf/domain recordBatch: stamps one shared batch_id across a group,
  overriding any per-animal id, one event per animal; proven against recordWeight + recordMove).
  The selection UI + the one-action capture screen are a later slice
◐ 📶 Attach photos: stored locally, photo_key set, upload deferred to sync, never blocks a write
  (FR-108) — the photo_key column exists; the local-store + deferred-upload flow is a client slice

Lifecycle events (events table — append-only, the heart; database-schema.md §5)
☑ events table + event_type enum + partitioning + the three-timestamp discipline
  (occurred_at ≠ created_at ≠ synced_at); payload Zod-validated per type; PostGIS location pair.
  Migration 0010 (PARTITION BY LIST(farm_id), composite PK, create_farm_partition + default
  partition, farm-scoped RLS, events_sync_geojson trigger); TENANCY(farm-scoped, `location`
  stripped). Proven against real PG (RLS isolation, WITH CHECK, partition routing, default
  fallback, occurred_at≠created_at, the location trigger). @werf/core event envelope + per-type
  payload registry
◐ 📶 Record a birth: ease score, birth weight, dam, multiples (FR-104) — capture DOMAIN LOGIC done
  (@werf/domain recordBirth + the animal-status state machine, table-driven); the API endpoint +
  capture SCREEN are a later slice, and must add the FR-113 herd selection
◐ 📶 Record a death with cause → status='dead', retained forever, excluded from live counts (FR-105)
  — recordDeath done (→ dead via the state machine). OFFLINE CAPTURE SCREEN done (`/animals/loss`,
  commit a6c4928): pick a live animal, give a cause, record — validated through recordDeath, written
  as a lifecycle EVENT (never an edit of the append-only herd row) through the @werf/sync capture
  store (`werf-events:<farmId>`), NO network in `save`. The client PROJECTION (`herd.ts`) folds the
  event onto the herd via the domain state machine so the animal is retained-but-marked in the list
  and drops from live head — the first time the count can go DOWN. The local write now REACHES
  POSTGRES via the best-effort outbox flush (`POST /livestock/deaths`, after its animal). Still ◐:
  only DEATH (cull/missing follow the same shape, later). NOTE: sale (FR-106) + weaning (FR-111)
  screens reuse this exact pattern
◐ 📶 Record a sale or purchase: counterparty, price (Money/cents), weight (FR-106) — recordSale/
  recordPurchase done (sale → sold; Money is integer cents). SALE CAPTURE SCREEN done (commit c04bf36,
  in the `/animals/loss` RecordLossScreen — a loss is a death OR a sale): pick the animal, choose Died
  or Sold, give buyer + price; validated through recordSale, written as a lifecycle EVENT through the
  @werf/sync store, NO network in `save`; the projection folds it to 'sold' and destocks the animal
  (retained-but-marked). First CLIENT use of Money — rands rounded to integer cents at the input
  boundary, never a float. The local write now REACHES POSTGRES via the best-effort outbox flush
  (`POST /livestock/sales`, after its animal; Money crosses the wire as integer cents). Still ◐:
  PURCHASE (an acquisition, no status change) has no screen yet, and the optional sale weight isn't
  captured on-screen
◐ 📶 Record weaning with weight and age (FR-111) — recordWeaning done; API + screen pending
◐ occurred_at is captured separately from created_at everywhere; reports read occurred_at (CLAUDE.md)
  — enforced in schema + domain (occurred_at is injected, distinct from created_at); the
  report/herd-summary read model that READS occurred_at is still pending
☑ 📶 Scope every event to the applicable herd — enterprise/species (cattle/sheep/pig/poultry) or the
  specific animal/mob — so a mixed farm files/filters events correctly; capture REQUIRES a herd
  selection when the event is not tied to one animal (FR-113, NEW from the 2026-07-23 mockup review).
  No schema change, as designed. Three parts, all in: (a) `assertHerdScoped` (@werf/domain,
  table-driven) refuses an event naming neither an animal, a mob, nor an enterprise, called inside
  the ONE shared `insertEvent` so a capture added in a later phase cannot skip it; the exception is
  a closed list (`FARM_SCOPED_EVENT_TYPES` — rainfall), so a new type is herd-scoped by default.
  (b) The herd is STAMPED at capture from the SUBJECT's own row, server-side, never from the body —
  an animal can be moved between herds, so joining on read would re-file last season's dosing under
  today's herd (the ADR-0005 reasoning; database-schema.md §5 corrected accordingly). (c) Capture
  asks ONCE: an animal is filed under a herd when created (the herd picker replaces the species
  picker — it answers both, and tells two cattle herds apart), a single-herd farm is asked nothing
  and shown where the animal went, and the session carries the farm's enterprises so this works
  offline. Animals screen gains a herd filter; the whole-farm total never filters, so a herdless
  animal is never hidden
☑ 📶 Manual rainfall capture (FR-213, P1) — a farm/land-scoped `rainfall` event: how much (mm) and
  when (occurred_at). Migration **0014** adds 'rainfall' to event_type by `ALTER TYPE … ADD VALUE`
  (the one enum DDL safe across the LIST-partitioned events table), appended LAST so the array and
  the Postgres enum stay in the same order. Pure `recordRainfall` (@werf/domain root, not under
  livestock/ — it is cross-cutting); `mm` is NON-NEGATIVE because a dry gauge is a real reading.
  Its OWN api module at `POST /rainfall` rather than a /livestock endpoint, so the crop side never
  reaches into livestock for its own rainfall; the shared write discipline (idempotency, capture
  role, the events projection) moved to `common/event-capture.ts`. Offline capture screen at
  `/rainfall` with its own store (`werf-rainfall:<farmId>`) + outbox flush, reached from home as a
  SECONDARY link and never a tile (the grid's set and order are muscle memory, and rain belongs to
  no enterprise). The screen ASKS for the reading day rather than assuming today — the common case
  is yesterday's gauge read at the house this morning. 6 real-PG integration tests + 5 web journey
  tests. Still ◐ on the READ side: nothing yet reports a season total or feeds grazing rest

Breeding (P1 only; FR-122/123 deferred)
◐ 📶 Record mating/service: natural or AI, sire, date, or bull-in/bull-out period (FR-120) — capture
  DOMAIN LOGIC done (@werf/domain recordMating → a `mating` event against the dam; on-farm sireId or
  external sireCode; bull-in/bull-out period). API + screen deferred
◐ 📶 Record pregnancy diagnosis: method + result; project due date from species gestation
  (gestation is reference data, not a magic number in code) (FR-121) — recordPregnancyDiagnosis +
  projectDueDate done: gestation is INJECTED (never hardcoded), the due date is computed AT CAPTURE
  and stored on the event, and is absent on an open/uncertain result. The species-gestation REFERENCE
  DATA source (a table/seed the caller reads) + API + screen are a later slice

Health 🇿🇦 (compliance-gated — legal-compliance.md first, compliance-checker before merge)
◐ 📶 Record a treatment: product, batch, dose, route, administered_by, reason (FR-130) — capture
  DOMAIN LOGIC done (@werf/domain recordTreatment; exactly-one subject animal xor mob). API + screen deferred
◐ 📶 Automatic withdrawal period from product reference data: compute + store meat/milk withdrawal
  ON THE EVENT (not on read — the rule at time of treatment, ADR-0005); block or hard-warn on
  sale/slaughter within it. Withdrawal periods live in regulatory reference data, by date (FR-131, FR-614)
  — withholdUntil computes the clear date at capture from an INJECTED product withdrawal period (never
  hardcoded) and stores it on the event; isWithinWithdrawal is the sale/slaughter guard. The
  veterinary_products REFERENCE TABLE (the withdrawal source, like chemical_products for spray) + the
  sale-flow that consults the guard + the API/screen are a later slice
◐ 📶 Record a vaccination against a programme; show which animals are due/overdue (FR-132) — recordVaccination
  done (programme + optional withdrawal); the due/overdue read model is deferred with the herd read models
◐ 📶 🇿🇦 Record a dip/tick treatment (required in controlled areas) (FR-133) — recordDip done
  (method + optional withdrawal); API + screen + the controlled-area prompt (§3.4) deferred

Weights & performance
◐ 📶 Record a weight against an animal or a mob (FR-140) — capture DOMAIN LOGIC done
  (@werf/domain recordWeight → a `weight` event; a pure observation, no status transition; insists
  on exactly one subject, animal xor mob; payload validated at the boundary). API ENDPOINT done
  (`POST /livestock/weights`, LivestockService writes through RLS, 7 real-PG integration tests,
  commit c70fbd5). OFFLINE CAPTURE SCREEN done (`/weigh`, commit 990c41c): writes each reading
  through the @werf/sync capture-store adapter (`werf-weights:<farmId>`) with NO network in `save`,
  validated through the domain recordWeight before it persists. The LOCAL write now REACHES POSTGRES
  via the best-effort outbox flush (`POST /livestock/weights`, after the animal it references). Still
  ◐: only an ANIMAL weight is captured on the screen (a mob weigh is later), and the method is fixed
  to the crush `scale` (tape/visual deferred)
◐ 📶 Compute ADG between any two weights (pure @werf/domain, table-driven test); chart the curve
  (FR-141) — averageDailyGain done and table-driven: order-independent, measured on occurred_at,
  weight LOSS is a real negative signal (drought), same-instant readings throw. NOW SURFACED in the
  weigh session (990c41c): the growth since an animal's previous reading is stated after each save,
  a loss shown as a real negative, the same-instant throw caught so it never crashes a capture. The
  CHART/curve (the read model over the full series) is still UI, deferred
☑ 📶 Weigh session: sequential capture optimised for the crush — one animal per screen, one thumb,
  no scrolling, works with a dead network (FR-142) — done (`/weigh`, commit 990c41c): walks the
  local herd one animal at a time, a single large weight field, one ochre Save & next that advances
  to the next animal, a Skip, an offline commit and a weighed-count at the end. Full-journey web
  test through the real `<App/>` proves capture survives a cold start with nothing sent

SA identity & stock theft 🇿🇦 (compliance-gated)
☑ 🇿🇦 branding_registers table + migration (0011) + RLS + TENANCY(farm-scoped); certificate ref,
  mark type, species[], body position. Proven against real PG: RLS isolation, WITH CHECK, cross-farm
  hidden, the mark CHECK. NOTE the ADR-0006 reconciliation: the ≤3-char rule is a DB CHECK per
  database-schema.md §7 (authoritative for schema; "fine while ZA is the only country", moves into
  AnimalIdentityRules when a 2nd jurisdiction arrives) — the @werf/core schema stays jurisdiction-neutral
  (mark = non-empty string), so no ZA rule is baked into the neutral layer (FR-601)
◐ 🇿🇦 Link an animal to its mark; flag animals unmarked past the prescribed window after
  acquisition — the window is reference data resolved by date, never hardcoded (FR-602) — animals.brand_id
  / brand_applied_at added additively (0011); isUnmarkedPastWindow done (window INJECTED, asOf injected,
  marked/no-acquisition never flagged). Surfacing the flag in a read model/UI is deferred
◐ 🇿🇦 Mark an animal missing: status='missing', timestamped, GPS-anchored (FR-605) — recordMissing
  done (alive→missing via the state machine; last-seen GeoJSON REQUIRED). API + screen deferred
◐ 🇿🇦 Stock-theft evidence pack (server-side PDF, one action): identification, ownership chain,
  brand certificate, last-seen GPS+timestamp, movement history, treatment history, SAPS case
  number field. FACTS ONLY — no "suspect" field (defamation + POPIA s26) (FR-603) — the @werf/core
  evidencePackSchema CONTRACT is defined, facts-only with NO suspect field (enforced by omission +
  a guard comment). The server PDF generation, the theft_incidents table, and the one-action endpoint
  are a substantial later server slice

Reporting & the grid's live numbers
◐ 📶 Herd/flock summary: counts by class, age, camp; excludes dead/sold from live counts (FR-705)
  — pure @werf/domain summariseHerd done: live = alive only (dead/sold/culled/missing retained by
  status, excluded from live head), mob head counts folded in (FR-102), breakdowns by species / sex /
  camp / enterprise / status. CLIENT READ-MODEL WIRING done (commit a6c4928): `apps/web/.../herd.ts`
  is the projection — it folds the append-only lifecycle log onto the herd through the domain state
  machine (isMoreFinal, consumed not re-encoded) to derive each animal's current status, then runs
  summariseHerd over it, reactively (useEffectiveAnimals/useHerdSummary on useSyncExternalStore). So
  the Animals screen and the home tile now DROP when an animal is lost. Age/sex CLASS (weaner/cow/
  steer, species-specific ADR-0006) still a later slice; the mob create-action still deferred
◐ 🇿🇦 FR-017 completed: each enterprise tile now carries one live number or one attention badge,
  fed from the herd summary — closes the Phase 1 ◐. Tiles stop being empty doors. — the animals tile
  carries the live head count from the projection (moves up on a capture, DOWN on a loss, reactive
  and surviving a cold start). Still ◐: the OTHER tiles (health "N due", etc.) have no number yet —
  they populate as their read models land

Phase 1 carry-forward (closing the Phase 1 ◐/deferred items the gate named as Phase 2 work)
☑ Bundle size gate ENFORCED (not just measured) — the build fails over ≤250KB gz
  (NFR-009, .claude/rules/frontend.md; Phase 1 named this "a Phase 2 first task").
  apps/web/scripts/check-bundle-size.mjs runs in `pnpm --filter @werf/web build`; fail
  path proven against the real dist (currently 96.42 KB gz of a 250 KB budget)
☑ Terminology moves from landTerm() to a real terminology lookup; tile terminology labels
  (Herd/Blocks/Camps…) become translatable, resolving the Phase 1 vocabulary fork (FR-008 remainder)
  — `apps/web/src/i18n/terminology.ts` is the layer: it answers which TERM a farm uses
  ('camp'/'block', 'herd'/'flock'/'livestock') and NOTHING about words; the dictionaries hold the
  word per term per language, so a term with no word fails the build. tiles.ts carries a translation
  key instead of an English string and decides only which doors exist and in what order; the fixed
  labels (Health, Sprays, Money…) are translated too, because a half-Afrikaans grid is its own fork.
  Afrikaans makes the case: "herd" and "flock" are both "Trop", which only a token can express.
  Also fixed a real gap found while moving the rule — a farm running BOTH herd and flock species now
  says "Livestock" instead of being wrong half the time. Becomes a lookup against a terminology
  TABLE (via the sync adapter) when the vocabulary outgrows a closed token set; callers do not
  change then, because they already ask the layer
☑ FR-008 remainders: a language control BEFORE sign-in (so an Afrikaans farmer can onboard in
  Afrikaans), and a profile-update endpoint so a later language change writes back and survives
  reload — the picker lives in the shared signed-out `Screen` frame, so it is on sign-in,
  registration AND the second-factor step without any of them remembering it, and each language is
  named in ITSELF (someone who cannot read the current language cannot read a label describing
  theirs). Registration already submitted the live UI locale, so choosing there makes the ACCOUNT
  Afrikaans — an e2e-style web test walks it. `PATCH /auth/profile` is guarded with NO id in the
  body (the account is the authenticated caller), returns the public user projection built
  field-by-field so a later migration's column is invisible until deliberately exposed, and the
  client patches its CACHED session — which is the part that actually fixes the bug, because the
  boot path re-adopts the stored locale. Applied to the device FIRST and written back second: a
  farmer in a dead zone must still read the app in their language, and when the write-back cannot
  happen the screen says what is true rather than raising an error
☑ axe widened to the enrolment / recovery-codes / Settings screens (unaudited in Phase 1) — plus
  the five Phase 2 capture screens, in BOTH themes, zero violations (`apps/web/e2e/a11y.spec.ts`).
  Each screen is asserted to have RENDERED before it is audited: axe reports zero violations on a
  blank page, so an audit without that assertion passes hardest when the screen is broken
☑ Re-pointed the stale packages/db/seed allowlist path in .gitleaks.toml to the real
  packages/db/scripts/seed.mjs (intent kept, not just deleted); fixed the AppShell.tsx comment
  that still claimed the sync strip lands later — it renders now (both from the Phase 1 reviewer's carry list)

Quality gates
☑ Every write path works with the network off; no `if (!navigator.onLine) throw` anywhere — every
  capture (`save`) commits to a local store synchronously with no network in the path; the ONLY
  `navigator.onLine` read is the outbox's send DECISION, which is a reconciliation path, not a
  write. Confirmed by the sync-auditor agent on the slice that introduced the flush
☑ Domain logic (ADG, gestation projection, withdrawal window, unmarked-animal flag) is pure,
  unit-tested, table-driven where the rule is table-driven; no mocks of our own code — @werf/domain
  has no I/O and no clock anywhere: ids, `occurredAt`, gestation periods, withdrawal periods and
  `asOf` are all INJECTED, which is what makes the table-driven tests possible
☑ API integration tests against real Postgres in testcontainers; no mocking our own DB — every
  apps/api and @werf/db suite starts its own Postgres. (Enough of them that the gate needed
  `maxWorkers: 4` and `hookTimeout: 60_000` to stay reproducible — see vitest.workspace.ts)
☑ Tenancy: packages/sync/test/tenancy.spec covers every new table; a cross-farm animal/event
  leak fails the build; sync rules and RLS agree (CLAUDE.md) — and the table list is now DERIVED
  from the drizzle schema (`SCHEMA_TABLE_NAMES` in @werf/db) rather than maintained by hand, so an
  unclassified table genuinely breaks the build instead of breaking it only if someone remembered
  this file existed (sync-auditor finding N3). Compared in BOTH directions, so a stale registry
  entry for a dropped table fails too
☑ A real offline cold-start e2e on the BUILT PWA — capture an animal and an event with the
  network off, confirm it survives reload (the Phase 1 reviewer flagged nothing exercised this).
  `apps/web/e2e/offline-capture.spec.ts`: captures an animal AND a weight with the browser
  genuinely offline, reloads ON THE CAPTURE ROUTE (so the service worker must serve a deep route
  from its precached shell — the assertion that would catch a missing navigation fallback), then
  lets the signal return and watches the queue drain animals-before-events. The flush assertion is
  an ORDER, not an exact call list, because it is deliberately at-least-once and every endpoint is
  idempotent on the client id; what IS strict is that a later open sends nothing. The jsdom
  coverage (`src/sync/Outbox.test.tsx`) remains as the fast, detailed version
☑ compliance-checker passes on FR-131 and FR-601–605; legal-compliance.md read first — run
  2026-07-23 (health, SA identity) and 2026-07-25 (withdrawal periods + evidence pack). One real
  finding, fixed: product registrations must resolve by the TREATMENT day, not today. Its two
  carry-forwards are now closed as well — `created_by`/`updated_by` on `theft_incidents` and
  `branding_registers` (migration 0015), because on a document handed to the SAPS Stock Theft Unit
  the reporter is part of the evidence, not metadata
☑ axe-core: 0 violations in BOTH themes on every new screen; pnpm verify exits 0; pnpm test:e2e
  green — 18 e2e tests, 0 violations; verify green at 61 files / 548 tests, bundle ~106 KB gz
```

**Exit gate:** `pnpm verify` exits 0; `pnpm test:e2e` green (both-theme axe, including the new
offline cold-start capture path); CI green on `main`; every checklist line is ☑ **or ◐ with its
remainder named**; the `reviewer` **and** `compliance-checker` agents pass; a farmer can create a
camp → create an animal → give it a tag → record a weight and a treatment → wean it → mark another
missing → generate a stock-theft pack → see the herd count on the home tile, entirely offline for
the capture paths.

**Where the gate stands (2026-07-25, branch `phase-2/livestock`).** `pnpm verify` exits 0 (61 files
/ 548 tests, bundle ~106 KB gz); `pnpm test:e2e` is green (18 tests, 0 axe violations in both
themes, including the offline cold-start capture on the built PWA); **no ☐ remains — every line is
☑ or ◐ with its remainder named**; `compliance-checker` has passed on the gated slices. Still owed
before the phase PR, and deliberately not claimed here: a `reviewer` pass over this checklist, a
`sync-auditor` pass over migration 0015 and the derived tenancy table list, and CI green on `main`
— which cannot happen until the PR exists, because CI does not run on feature branches.

The end-to-end sentence in the gate above is not yet true in one respect, and it is worth stating
plainly rather than reading the gate generously: a farmer cannot yet CREATE A CAMP or GIVE AN ANIMAL
A TAG from the app. Both data layers are done and proven, and both are named ◐ above with exactly
that remainder; the create ACTIONS are the largest thing Phase 2 leaves for its successor, along
with the API/screens for weaning, birth, movement, purchase, mating, pregnancy diagnosis and the
health captures (whose SERVER side is done — it is the offline product-selection screen that waits
on reference-data sync in Phase 3).

**Deferred to later phases (not a Phase 2 miss):** FR-110 pedigree/breed-% and FR-122/123 breeding
analytics + reminders (P2); FR-134/135/136/137 injury, notifiable-disease flag, medicine inventory,
vet access (P2); FR-143/144 Bluetooth EID/scale + sale-weight projection (P3); FR-152/153/154
rest-period warnings, feed, grazing plan (P2/P3); FR-604 removal certificate, FR-606–613 GlobalGAP/
SIZA/traceability/QR (P2/P3); FR-615 regulatory-rates admin UI (P2); FR-015 global search (P2);
FR-706–710 the analytical reports (P2); and the **PowerSync replication engine (Phase 3)** — Phase 2
livestock is offline-first through the ADR-0003 seam, not through live sync.

---

## Phases 3–7 — to be written

Detailed checklists for Phase 3 (offline sync — the hard one), Phase 4 (crops/fields), Phase 5
(labour, wages, finance), Phase 6 (compliance packs), and Phase 7 (polish, i18n, PWA hardening)
are authored at the start of each phase from the SRS and functional-requirements backlog, so they
reference real FR/story IDs. Do not pre-write them speculatively — write each phase's checklist when
you reach it, against the requirements as they stand.
