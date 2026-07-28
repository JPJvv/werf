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

**Partially delivered — named so they are not mistaken for done.** Struck-through entries were
CLOSED by the Phase 2 carry-forward work; the two that remain are the honest ones.
- ~~FR-014c (manage passkeys)~~ — **CLOSED** in Phase 2 (commit bb17b24). Settings → Security lists
  the enrolled devices by label and last use, adds another, and revokes one. Adding another is not a
  power-user feature: an owner with one passkey on one phone has an account that dies with the
  phone, which is what would make preferring this factor unsafe.
- ~~FR-017 "one live number or one badge" per tile~~ — **CLOSED.** The animals tile carries live
  head, the land tile the camp count, and the health tile a "N withholding" attention badge. Tiles
  with no true number to carry still carry none, deliberately (see the Phase 2 line).
- ~~Passkey enrolment from the client~~ — **CLOSED** in Phase 2 (commit bb17b24), and it was the
  largest remaining Phase 1 gap. Enrolment now offers the PASSKEY first and the authenticator app
  second, which is ADR-0007's ordering rather than fashion; sign-in satisfies the second factor with
  it when the ACCOUNT has one and the DEVICE can use one. Availability is asked BEFORE the button is
  rendered — a mandatory-2FA screen offering only a factor the browser cannot produce is a dead end
  for someone with no other route into their own account. **Phase 1 now has no open gaps.**
- ~~FR-008 write-back~~ — **CLOSED** in Phase 2 (`PATCH /auth/profile` + the pre-sign-in picker).
- ~~FR-004 farm switching~~ — **CLOSED.** A switcher in the shell header on every screen (hidden on
  a single-farm account), switching the device FIRST and telling the server best-effort so it works
  with no signal; and Settings → Farms adds a farm, which is one of the very few screens that
  honestly requires a connection and says so. `SessionFarm` gained `businessId` (defaulted, so a
  session cached before it existed still parses).
- ~~Invitation delivery~~ — **CLOSED for email**, through a provider-agnostic `Mailer` port
  (`apps/api/src/mail`, `SMTP_*` config). A PHONE-ONLY invitation still reaches nobody, and that is
  a decision: SMS is ruled out for the same SIM-swap reason it is ruled out as a second factor.

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
◐ Define a camp: code, name, GPS boundary, hectares, carrying_capacity_lsu (FR-150) — the create
  ACTION is DONE (commit 961e2d7): `POST /land-units` + `GET`, and an offline capture screen at
  `/land/new` reached from the first-run guide's own link, which until now landed on a placeholder.
  ⭐ The DUAL-WRITE now runs client→server, which nothing enforced: the client authors GeoJSON (it
  has no PostGIS) and the server derives the canonical `geometry` with ST_GeomFromGeoJSON, SRID
  forced to 4326 because ST_GeomFromGeoJSON returns 0 and the column type rejects it; the trigger
  then writes PostGIS' own normalisation back. Proven by comparing the stored mirror to
  ST_AsGeoJSON(boundary), not by asserting both are non-null. Terminology is not re-decided — the
  farm's vocabulary picks the word AND the `kind`, and a vineyard is asked nothing about grazing
  capacity. A duplicate code is refused on the device before it can jam the queue, and refused again
  server-side with a message. Still ◐: WALKING a boundary (capturing the polygon by GPS) is its own
  mapping feature — the API accepts and converts one, nothing yet produces one
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
☑ Create a mob/flock and manage it by head_count without individual rows (FR-102) — create ACTION
  DONE (commit fb74d6e): `POST /livestock/mobs` and a capture screen at `/animals/groups/new`,
  offered beside "record an animal" rather than buried, because for a smallholder running 300 sheep
  as a flock it is the only capture they will ever need. The head count feeds the live total, so the
  home tile shows 300 on a farm with ZERO animal rows — asserted directly, because a tile showing 0
  there is the whole failure FR-102 exists to prevent. The Animals screen also stops telling such a
  farm it has "recorded nothing yet".
  ✅ **The "manage" half is now DONE too (commit 06884c7), which is what restores this line to ☑.**
  The count moves by an append-only `tally` event carrying the reason — born, died, sold, bought,
  stolen, slaughtered, or counted — at `/animals/groups/count`, and `mobs.head_count` becomes the
  fold of that log over an immutable `initial_head_count` baseline (migrations 0017/0018).
  ⭐ DELTAS, NOT AN EDITED FIELD, and the reason is the one this product exists for: two people each
  record three deaths on their own phone in a dead zone, and deltas compose to 294, which is the
  truth. An edited head count is last-write-wins, lands on 297, and silently keeps three dead sheep
  in the count. A RECOUNT is the one absolute and RESETS the running total, because "I walked the
  camp and counted 297" is a stronger fact than arithmetic on a number just shown to be wrong.
  ⭐ The server RE-DERIVES the count from its whole log rather than stepping it by each delta:
  arrival order is not `occurred_at` order here and never will be, so a recount landing before an
  older lambing from a second phone would otherwise be overwritten by the arithmetic it corrects.
  Both sides run the same `projectHeadCount` over the same baseline and cannot disagree.
☑ Species-specific attributes via Zod-validated JSONB (FR-107) — DONE (commit 5e279b1). A strict
  per-species schema in `@werf/core/schemas`, enforced on the device before the save AND on the
  server write path from the same schema. Horn status on cattle, sheep, goats and game; wool class
  on sheep. An attribute the species does not have is REFUSED, not stored; an EMPTY record is valid
  on every species, because a farmer tagging fifty head is not stopping to record horn status on
  each one. ⚠️ **This line previously said "ADR-0006 AnimalIdentityRules seam" and that was wrong.**
  That seam is for what the LAW varies — the Animal Identification Act's mark rules. A horn is a
  horn in Namibia; putting a husbandry vocabulary behind a jurisdiction interface would make every
  future country restate that cattle can be polled. `woolClass` is a validated SHAPE and not an
  enum, deliberately: the SA classing code list is Cape Wools' and is not in this repo, and a
  fabricated picker would be wrong in a way a wool farmer spots immediately
☑ Multiple identifiers per animal; UNIQUE(farm_id, type, value) partial on deleted_at IS NULL
  (FR-109) — the add-identifier ACTION is DONE (commit 2b722e9): `POST /livestock/identifiers` and a
  crush-shaped tagging session at `/animals/tag`, one animal per screen, Save & next, queue fixed
  when the session opens so the list does not shrink under a thumb. A number already live on ANOTHER
  animal is refused in BOTH places for different reasons: on the device before the save, because in
  a crush the cause is nearly always a misread digit; and on the server, because a second device
  cannot see this one's captures and because silently moving a live tag corrupts the identity chain
  an evidence pack and an export audit rest on. Reissuing a retired tag still works, and is tested.
  The knock-on is the point of FR-109: an animal is now called by its NUMBER everywhere it appears,
  through ONE lookup, and an untagged animal says "without a number" rather than showing a blank
☑ Move animals between mobs and camps; movement retained as an event, never an overwrite (FR-103) —
  API + SCREEN DONE (commit cc91a9b). `POST /livestock/moves` sends only the DESTINATION; the FROM
  side is never restated by the client.
  ⚠️ CORRECTED 2026-07-27 (`7b17c2e`). This line used to say the FROM side "is read from the
  animal's own row, so the stored history cannot disagree with the herd" — which was the DEFECT,
  written up as the design. `animals.mob_id` is the denormalised "where is it now", and arrival
  order is not `occurred_at` order: a move dated the 2nd arriving after one dated the 9th recorded
  the 9th's destination as its own origin, permanently, in an append-only log the withdrawal guard
  reconstructs membership from. The FROM side is now reconstructed from the move log at that
  event's own place in it, and a back-dated move no longer walks the animal backwards. Two
  writes, two different facts: the append-only `move` event is the history, the animal row's
  land_unit_id/mob_id are a denormalised "where is it now". The screen is multi-select by design —
  a farmer opens a gate and a camp empties — so this also closes FR-112's selection UI for the event
  type where it is unavoidable: one event per animal, ONE shared batch_id.
  ⭐ TWO BUGS THE TESTS FOUND, both of which would have shipped. (1) A RE-FLUSHED MOVE JAMMED THE
  QUEUE: the flush is at-least-once, and on the retry the animal is already at the destination, so
  the domain correctly refuses "a move that changes nothing" — the outbox would never mark it sent
  and would stall every later capture behind a write that had succeeded. Idempotency for a capture
  that CHANGES THE STATE ITS OWN VALIDATION READS has to be checked BEFORE validation (`findEvent`).
  (2) omit-vs-null is load-bearing at every layer, and a default would silently destroy data:
  sending null for an unnamed destination turns "walk them to Camp 4" into "and take them out of
  their mob". Asserted at the wire as an ABSENT key, not described
☑ 📶 Batch operations: apply one event to a selected group in one action, one batch_id (FR-112) —
  the selection UI + one-action capture are DONE for the two captures that are batches BY NATURE:
  moving (a gate opens and a camp empties) and dosing (nobody doses one animal and walks away).
  Both give every animal its own event under one shared batch_id, so the run can be reviewed or
  corrected as the single action it was. Still ◐: weighing and tagging stay sequential on purpose —
  they are one-animal-at-a-time in the crush and a multi-select would be slower, not faster
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
☑ 📶 Record a birth: ease score, birth weight, dam, multiples (FR-104) — API + SCREEN DONE (commit
  434db44). TWO records from one action: the calf's herd row and the calving, filed against the DAM,
  because the calf has no history yet and "which cows calved, and how hard" is the question asked in
  September. The calf inherits its mother's species, herd and position (FR-113 satisfied without
  asking), and is the one animal whose date of birth is known exactly rather than estimated. Ease
  score is five large buttons, not a number field: it is a judgement with five answers, and a 4 or a
  5 twice on the same cow is a culling decision nobody reconstructs from memory. ⭐ A TWIN BIRTH
  records TWO of everything (commit 754c53f, gap B11 closed): the screen used to mint exactly one
  calf however many were born while storing `multiples: 2` on the event, so the two facts
  contradicted each other in the same action and a lambing season left the flock short by one per
  twin birth. `birthPayload` names ONE calfId and carries the count, so the shape that fits is one
  event per calf, each recording it was one of N — and each calf gets its own sex and weight,
  because twins differ in both. A single birth looks exactly as it did. Ease score stays asked once:
  it is the DAM's calving
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
☑ 📶 Record a sale or purchase: counterparty, price (Money/cents), weight (FR-106) — PURCHASE now
  has a path too (commit 434db44), folded into recording an animal rather than given a screen of its
  own: a bought animal is not a different KIND of animal, it is the same herd row plus a money
  event, and `source`/`acquired_at` land on the animal because an evidence pack reads those rather
  than trawling the event log. ✅ The optional sale WEIGHT is now on the screen too (commit 00f1016)
  — unrecoverable after the truck leaves, and without it a price says nothing about what the animal
  was worth. Original note follows — recordSale/
  recordPurchase done (sale → sold; Money is integer cents). SALE CAPTURE SCREEN done (commit c04bf36,
  in the `/animals/loss` RecordLossScreen — a loss is a death OR a sale): pick the animal, choose Died
  or Sold, give buyer + price; validated through recordSale, written as a lifecycle EVENT through the
  @werf/sync store, NO network in `save`; the projection folds it to 'sold' and destocks the animal
  (retained-but-marked). First CLIENT use of Money — rands rounded to integer cents at the input
  boundary, never a float. The local write now REACHES POSTGRES via the best-effort outbox flush
  (`POST /livestock/sales`, after its animal; Money crosses the wire as integer cents). Still ◐:
  PURCHASE (an acquisition, no status change) has no screen yet, and the optional sale weight isn't
  captured on-screen
☑ 📶 Record weaning with weight and age (FR-111) — API + SCREEN DONE (commit 434db44). A crush
  session, same shape as weighing, because weaning IS a crush day. The AGE is derived from the date
  of birth rather than asked — a farmer in a race is not going to work out that a calf is 207 days
  old — and omitted entirely where there is no DOB, because a guessed age is worse than no age in a
  growth comparison
☑ occurred_at is captured separately from created_at everywhere; reports read occurred_at
  (CLAUDE.md) — the READ side now exists: the rainfall season total sums on `occurredAt` (the day
  the gauge was READ, never the day it was captured), and the client move projection folds position
  last-write-wins BY `occurredAt` rather than by insertion order. ⭐ Turning an INSTANT into a DAY
  now goes through `farmTime` in the FARM's zone: `toISOString().slice(0,10)` is the tempting
  one-liner and it is wrong for two hours out of every twenty-four in South Africa — a calf born at
  01:00 SAST would be recorded as born the previous day and its weaning age would be a day out
  forever
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
☑ 📶 Manual rainfall capture (FR-213, P1) — the READ side is now done too (commit 4a492b9): the
  season total is on the HOME screen beside the link, because "how much have we had this season" is
  asked every time a farmer thinks about it and a number you must open a screen to see is a number
  you stop checking. The season starts in JULY — splitting a summer-rainfall year at 1 January would
  cut every season in half exactly where the comparison matters — and it sums on `occurredAt`, the
  day the gauge was READ. Still ◐: nothing yet feeds grazing rest. Original note follows — — a farm/land-scoped `rainfall` event: how much (mm) and
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
☑ 📶 Record mating/service: natural or AI, sire, date, or bull-in/bull-out period (FR-120) — DOMAIN,
  API AND SCREEN DONE (closes B1). `POST /livestock/matings`, twelve integration tests shared with
  FR-121, and `RecordMatingScreen`. ⭐ The service is a WINDOW as often as it is a day, and the
  screen asks which: "a bull ran with them" is a first-class answer and the DEFAULT for natural
  service, because an extensive herd knows the six weeks and nothing finer, and a date field alone
  would make the farmer name a day the service did not happen on. Bull-out is optional — "he is
  still with them" is an ordinary October state. The sire is an on-farm animal or an external code
  and BOTH are optional: a guessed sire is worse than a blank one, because a pedigree is read as
  fact by everyone who comes after. A cross-farm sire is refused as NOT FOUND rather than as a
  tenancy error, so a caller cannot probe a neighbour's herd one uuid at a time
☑ 📶 Record pregnancy diagnosis: method + result; project due date from species gestation
  (gestation is reference data, not a magic number in code) (FR-121) — DOMAIN, REFERENCE DATA, API
  AND SCREEN DONE (closes B1). `species_gestation` + migration 0019 (deliberately NOT
  jurisdiction-scoped and NOT effective-dated: a withdrawal period is a registration and stops at
  the border, a gestation period is biology and does not; and a corrected figure was wrong before,
  not superseded), `GET /reference/species-gestation`, a client reference cache, and
  `RecordPregnancyScreen`. ⭐ THE DUE DATE NEVER CROSSES THE WIRE — the device previews one from its
  cached figures so the farmer sees a date at the gate, and the server projects and freezes the one
  that is stored (ADR-0005). `recordPregnancyTestRequestSchema` omits `dueDate` and a test proves
  the strip. ⛔ A species with NO gestation row REFUSES THE PROJECTION AND KEEPS THE FACT: `poultry`
  incubates rather than gestates and `game` spans a hundred days, so the server throws rather than
  falling back — but the diagnosis is still recorded, because refusing it would lose a real
  observation to protect a projection that was never available

Health 🇿🇦 (compliance-gated — legal-compliance.md first, compliance-checker before merge)
☑ 📶 Record a treatment: product, batch, dose, route, administered_by, reason (FR-130) — SCREEN DONE
  (commit d32451a) on top of the server endpoints that already existed. A dosing run is a batch by
  nature, so selection is the primary interaction and one batch_id ties the run together; products
  are filtered to the species actually selected, so a wrong choice is off the screen rather than
  something the farmer has to notice. ✅ Dose value, unit and ROUTE are now on the screen (commit
  00f1016): both are on the register a residue traceback reads, "20" is not a dose, and a dose
  without a route does not say what happened to the animal. A dose that was TYPED but is not a
  number blocks the save rather than being dropped — a register that silently lost the dose someone
  stood there and entered is worse than one that never had it, because nobody knows to go back
◐ 📶 Automatic withdrawal period from product reference data: compute + store meat/milk withdrawal
  ON THE EVENT (not on read — the rule at time of treatment, ADR-0005); block or hard-warn on
  sale/slaughter within it. Withdrawal periods live in regulatory reference data, by date (FR-131, FR-614)
  — DONE end to end (commits d32451a, e5fc018). The `veterinary_products` register reaches the
  DEVICE through `GET /reference/veterinary-products` (its own module, because reference data is not
  a livestock concern — chemical_products and regulatory_rates land there too) and is cached through
  `createReferenceCache`, a SIBLING of the append-only capture store rather than a widening of it: a
  capture store holds captured facts and must never be rewritten, while reference data is a
  replaceable snapshot of something authoritative elsewhere.
  ⭐ THE CLEAR DATE IS ON SCREEN IN THE CRUSH. "When can I sell this animal?" answered three weeks
  later is answered too late. A product with NO meat withholding says so explicitly, because silence
  reads as "the app does not know". What is STORED is a productId and never a withdrawal period —
  the number is regulated, the server resolves it from the registration in force on the treatment
  day, and the test asserts the ABSENCE of the withdrawal fields.
  ⭐ The SALE GUARD runs at capture as well as on the server, FOR AN INDIVIDUAL ANIMAL. Without it
  an offline sale of a treated animal commits locally, is refused forever on flush, and jams the
  queue with nothing on the phone explaining why — days after the truck has gone. It says NO and
  says WHEN in one panel; the LATEST clear date across all treatments wins; and a DEATH is never
  withheld, because the rule is about meat entering the food chain, not about recording what happened.
  ✅ **THE GROUP PATH IS NOW GUARDED AT CAPTURE TOO (2026-07-27, `8812347`).** The remainder this
  line used to name is closed, and it was wider than it looked: the device could not RECORD a
  whole-flock dose at all, so the guard had nothing to read. A counted mob is now a dose subject on
  the health screen, and a `sale`/`slaughter` tally out of a withheld mob is refused offline with
  the clear date on screen.
  ✅ Individual SLAUGHTER is guarded too (`7b17c2e`) — a flag on the death payload, not a word in
  free text, because a guard cannot read intent out of a sentence.
  ✅ Both client guards read BOTH routes a dose takes (`713634b`). A dose reaches an animal by its
  own treatment or by its mob's, and each client guard had been reading one column while the server
  read both — so the device previewed CLEAR and the flush refused.
  ✅ The flush now sends doses and moves BEFORE any disposal (`16fbb6a`). A point-in-time guard
  cannot refuse a dose that has not arrived yet.
  ⛔ **REMAINDER, named 2026-07-27 — a CROSS-DEVICE race is still open and cannot be closed by
  ordering.** Device A records the dip; device B, which has not seen it, tallies to the abattoir.
  Both are honest captures and neither device can know. Ordering fixes the single-device case only.
  The answer is a retroactive compliance flag on the disposal rather than a refusal, and it is a
  slice of its own. See STATUS.md §2.3c.
  ⛔ **REMAINDER — head arriving by `purchase` is unconditionally clear**, and with no `transfer`
  reason in the group model, splitting a dipped flock has to be expressed as sale-out + purchase-in.
  That is a modelling decision, not a defect, and it is STATUS.md §2.3b for the repo owner.
◐ 📶 Record a vaccination against a programme; show which animals are due/overdue (FR-132) — the
  CAPTURE is done (the health screen records a vaccination against a programme, commit d32451a). The
  DUE/OVERDUE read model is still ◐ and is named honestly: it needs a vaccination PROGRAMME SCHEDULE
  that has not been designed, and the Health tile deliberately carries "N withholding" — which is
  true and derivable today — rather than an "N due" the app cannot actually compute
◐ 📶 🇿🇦 Record a dip/tick treatment (required in controlled areas) (FR-133) — API + SCREEN DONE
  (the health screen's third kind, commit d32451a). ✅ The dip METHOD is now on the screen (commit
  00f1016) — a plunge dip and a pour-on are different operations with different coverage, and the
  dipping register in a controlled area has to say which. ⭐ Wiring it surfaced a latent defect: the
  client's `method` type was a hand-written union offering `'injectable'`, which the dip payload
  does not accept and the server would have refused on the wire. It had never fired only because
  the field was on no screen; the moment it appeared, a plausible-looking choice would have queued a
  capture that could never be sent, and it would have read as a sync bug rather than a typo in a
  type. It is now derived from the payload schema. Still ◐: the controlled-area prompt (§3.4) needs
  the controlled-area boundaries as reference data, which do not exist yet

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
☑ 🇿🇦 Mark an animal missing: status='missing', timestamped, GPS-anchored (FR-605) — API + SCREEN
  DONE (commit 434db44), as a third outcome on the loss screen. ⭐ It is the stock-theft path, not a
  third radio button: it asks for the day it was LAST SEEN rather than assuming today (a theft dated
  to the day it was noticed is dated wrong), and it takes a REAL GPS fix rather than saving without
  one. Geolocation works with no signal — GPS is a receiver, not a connection — so requiring it
  costs an offline farmer nothing, and it is what makes "GPS-anchored" a promise rather than a hope.
  When a fix fails the REASON is named, because "permission denied" and "no signal" need different
  actions from the person holding the phone
☑ 🇿🇦 Stock-theft evidence pack (server-side PDF, one action): identification, ownership chain,
  brand certificate, last-seen GPS+timestamp, movement history, treatment history, SAPS case
  number field. FACTS ONLY — no "suspect" field (defamation + POPIA s26) (FR-603) — the @werf/core
  evidencePackSchema CONTRACT is defined, facts-only with NO suspect field (enforced by omission +
  a guard comment). The whole SERVER side is done — `theft_incidents`, the PDF renderer
  (`evidence-pack.pdf.ts`), and both endpoints, with five passing integration tests.
  **The CLIENT path is now done too** (commit 91d1103), which is what closes gap B8 and restores
  this clause to the exit-gate sentence: `/animals/theft` lists the farm's incidents and
  `/animals/theft/new` files one — a CAPTURE, local and instant, because an incident is composed
  at a cut fence hours from town. Generating the pack is the ONE online-only action in livestock
  and the list says so per incident rather than offering a button that would 404, because the PDF
  is rendered from the rows the SERVER holds. ⛔ No suspect field anywhere in the chain — not on
  the screen, not in the store, not on the wire — and the screen says why in the farmer's own
  interest, immediately above the only free-text box a name could get into. A test asserts the
  absence. A failed GPS fix names the reason and stops; a second deliberate tap files without a
  point, because refusing outright loses the report and filing silently hands over a weaker
  document with no sign anything was lost. The entry point sits OUTSIDE the has-live-animals
  block: farms running stock as groups have no individual rows and are many of the farms most
  exposed to theft

Reporting & the grid's live numbers
☑ 📶 Herd/flock summary: counts by class, age, camp; excludes dead/sold from live counts (FR-705)
  — the CAMP breakdown is now SHOWN (commit 30ac2b6), which closes gap B10: each camp on `/land`
  carries the live head standing in it, counting GROUPS as well as individual animals so a flock of
  300 with no animal rows shows as 300 rather than as empty ground. `summariseHerd`'s `byLandUnit`
  had been computed and unit-tested since the read-model slice and nothing read it — a number the
  app knows and does not show is the same as a number it does not have. Empty ground says 0, never
  blank.
  — the CLASS breakdown is DONE (commit 4a492b9): cows, weaners, steers and "no age recorded", per
  species, on the Animals screen. ⭐ The rules are PER SPECIES in a table (ADR-0006) — a weaner
  becomes a heifer at a different age in cattle than a lamb becomes a hogget in sheep, and
  hard-coding cattle's answer is how a livestock app ends up quietly wrong for everyone else — and
  the class NAMES are jurisdiction-neutral tokens so Afrikaans can say "koeie" without English being
  baked into the rule. An animal with no recorded birth date is NAMED rather than sorted, because on
  an extensive farm that is a large part of the herd and counting them as cows would invent the
  number being checked. Original note follows —
  — pure @werf/domain summariseHerd done: live = alive only (dead/sold/culled/missing retained by
  status, excluded from live head), mob head counts folded in (FR-102), breakdowns by species / sex /
  camp / enterprise / status. CLIENT READ-MODEL WIRING done (commit a6c4928): `apps/web/.../herd.ts`
  is the projection — it folds the append-only lifecycle log onto the herd through the domain state
  machine (isMoreFinal, consumed not re-encoded) to derive each animal's current status, then runs
  summariseHerd over it, reactively (useEffectiveAnimals/useHerdSummary on useSyncExternalStore). So
  the Animals screen and the home tile now DROP when an animal is lost. Age/sex CLASS (weaner/cow/
  steer, species-specific ADR-0006) still a later slice; the mob create-action still deferred
☑ 🇿🇦 FR-017 completed: each enterprise tile carries one live number or one attention badge —
  closes the Phase 1 ◐ (commit 4a492b9). Animals: live head, moving UP on a capture and DOWN on a
  loss, reactive and surviving a cold start. Land: the camp count. Health: a "N withholding" BADGE
  (a dot AND a number AND a word — never colour alone, NFR-411), which outranks a metric because
  something needing attention beats something being measured.
  ⭐ Health carries "N withholding" and NOT the "N due" the sketch suggested, for one reason: it is
  TRUE. A due/overdue count needs a programme schedule that does not exist, and a tile carrying a
  number the app cannot compute is worse than a tile carrying none — the whole point of FR-017 is
  that a tile is an instrument rather than a menu item. Labour, Money, Compliance and Sprays
  deliberately carry NOTHING until their phases give them something true to say

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
  all THIRTEEN Phase 2 capture screens, in BOTH themes, zero violations (`apps/web/e2e/a11y.spec.ts`).
  The capture screens ran in ONE theme until the exit-gate review caught it: `WCAG_TAGS` includes
  `wcag2aa`, so axe runs `color-contrast`, which is the one rule whose result depends on the theme.
  Now looped over `THEMES` like the rest of the file
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
⛔ compliance-checker passes on FR-131 and FR-601–605; legal-compliance.md read first — run
  2026-07-23 (health, SA identity) and 2026-07-25 (withdrawal periods + evidence pack). One real
  finding, fixed: product registrations must resolve by the TREATMENT day, not today.
  ⚠️ **DEMOTED FROM ☑ 2026-07-27.** This line read ☑ while the same file said NOT APPROVABLE forty
  lines below it. Three passes have now run; the third (2026-07-27) found a NEW SEV-1 in the code
  written to close the second's findings. **It goes back to ☑ only when a pass returns APPROVABLE**,
  and the passes so far are the reason to expect one more. Its two
  carry-forwards are now closed as well — `created_by`/`updated_by` on `theft_incidents` and
  `branding_registers` (migration 0015), because on a document handed to the SAPS Stock Theft Unit
  the reporter is part of the evidence, not metadata
☑ axe-core: 0 violations in BOTH themes on every new screen; pnpm verify exits 0; pnpm test:e2e
  green — 0 violations.
  ⚠️ **THIS CLAIM WAS TRUE OF THE ROUTES AND FALSE OF THE CONTROLS UNTIL 2026-07-27 (`e5792d3`).**
  The e2e seed wrote only the session, so every capture screen rendered its empty state under axe —
  and the spec's own "assert the heading rendered first" guard passed anyway, because the heading
  sits outside the conditional. The pickers, the date fields and both withholding panels had never
  been audited. There is now a populated pass per theme that walks each screen to its controls. (Counts as at the commit that wrote this line: 21 e2e tests, 73 files /
  668 tests, 124.82 KB gz. **The live figures are in the "Where the gate stands" paragraph below
  and nowhere else** — this line kept a stale second copy that disagreed with it by 26 lines'
  distance, which is why it now says where to look instead of restating a number.)
  The stock-theft list and capture, and the "what needs your attention" screen, are in the
  both-theme axe sweep alongside the other capture screens (`CAPTURE_SCREENS` holds 19 entries as
  at 2026-07-28; the count is deliberately not restated here for the same reason as above)
```

**Exit gate:** `pnpm verify` exits 0; `pnpm test:e2e` green (both-theme axe, including the new
offline cold-start capture path); CI green on `main`; every checklist line is ☑ **or ◐ with its
remainder named**; the `reviewer`, `sync-auditor` **and** `compliance-checker` agents pass; a farmer
can create a camp → create an animal → give it a tag → record a weight and a treatment → wean it →
mark another missing → file a stock-theft incident and generate its pack → see the herd count on the
home tile, entirely offline for the capture paths.

> **Amended 2026-07-26 (first amendment).** "→ generate a stock-theft pack →" was struck from that
> sentence. It had been in the gate since the phase was written and was never buildable by a farmer:
> the server side was complete but there was no client route to it. An earlier paragraph here
> paraphrased the clause away as "server-side and needs a connection" — true and beside the point,
> since needing a connection is not the same as having no UI.
>
> **Amended again 2026-07-26 (second amendment) — the clause is RESTORED**, because the slice was
> built (commit 91d1103). It reads "file a stock-theft incident and generate its pack", which is
> deliberately more than the original: FILING is offline like every other capture in that sentence,
> and generating the pack is not and cannot be, so the gate now names both halves instead of one
> word that hid the difference. Everything before the pack in this sentence is still an offline
> path end to end.

**Where the gate stands (2026-07-28, eighth session — AUDIT, branch `phase-2/livestock` @ `7917645`).**
`pnpm verify` exits 0 **on CI** (**78 files / 806 tests**, bundle **138.72 KB** gz); CI green on both
lanes at HEAD — run `30374965420`, 2026-07-28, which is the first run to cover `f38af66`, `e5792d3`
and the B1 slice `2590c9f`.

◐ **`pnpm test:e2e` is NOT green and this line no longer claims it is.** A cold local run on
2026-07-28 was **25 passed / 2 failed, exit 1** — `a11y.spec.ts:50` and `:64`, both light theme,
both on the second-factor choice screen. See STATUS.md §4 A9; the cause is narrowed but not proven.

⚠️ **`pnpm verify` cannot be fully run on a machine with no Docker.** 13 test files — the entire
testcontainers integration tier, 272 of the 806 tests — fail to boot with *"Could not find a working
container runtime strategy"* and the gate exits 1. That is an environment condition, not a defect,
but "the gate is green" is only checkable where Docker runs, and locally it is 534 of 806.

⛔ **THE EXIT GATE DOES NOT READ TRUE.** The gate has five clauses. `pnpm verify` ✅ (on CI),
`pnpm test:e2e` ◐ **(demoted 2026-07-28 — it fails cold, see above)**, CI-green-on-`main` ⚪
(unmeetable before the merge, by construction). **THREE clauses are now unmet, not two**, and the
FIRST one below is still the live blocker:

- **"the `reviewer`, `sync-auditor` and `compliance-checker` agents pass" — THEY DO NOT.** All
  three were run over `a6c8eff..HEAD` on 2026-07-26 (fifth session) and `compliance-checker`
  returned **NOT APPROVABLE**. All twelve of those findings are now closed in code (STATUS.md §2c).
  ⛔ **A THIRD pass ran 2026-07-27 over `5c769b4..HEAD` and the verdict is STILL NOT APPROVABLE** —
  on a NEW SEV-1 found in the code written to close the previous ones: the outbox flush sent health
  events after the disposals the withdrawal guard had to judge against them, so a point-in-time
  guard returned 201 for meat inside an active withholding. That, and seven other findings across
  the three agents, are fixed in `16fbb6a`…`e5792d3` (STATUS.md §2d).
  ⛔ **THE FOURTH PASS RAN 2026-07-28 over `7c2acd9..HEAD` and the verdict is STILL NOT APPROVABLE**
  — seven findings including a **NEW SEV-1** (`AdjustMobScreen.tsx:128` memoises the capture id, so
  a second tally on the same mob on the same day silently overwrites the first and never reaches the
  server) and three SEV-2s. **Three of the four are inside pass three's own fixes.** `reviewer`
  returned NOT APPROVABLE independently. STATUS.md §2f. **The pattern is now measured four passes
  running: each pass finds real defects in the previous pass's fixes.**
- **"CI green on `main`" — structurally unmeetable before the PR exists**, because CI does not run
  on feature branches (STATUS.md §4 G5). This clause can only ever go true AT MERGE. Read it that
  way rather than treating it as a pre-PR blocker; it is the one clause the phase cannot satisfy
  by working harder.

The other three clauses hold — but the second of them only as of 2026-07-27. `pnpm verify` exits 0;
every checklist line is ☑ or ◐ with its remainder named; and the end-to-end sentence is TRUE.
⚠️ **The checklist clause was FALSE for a whole session and nothing caught it**: three lines
described the code as it stood BEFORE the fixes — one of them writing the FR-103 defect up as the
design — and a ☑ on the compliance-checker line contradicted this same file forty lines below it.
Reconciled 2026-07-27. **When a fix lands, the checklist line it makes stale is part of the diff.** The two
clauses of that sentence which were false when it was first written — creating a camp, and tagging
an animal — were the first two slices of this stretch of work.

> **The lesson, since it has now happened twice.** STATUS.md §1 concluded "every checklist line is
> ☑ or ◐, **so** the exit gate reads true as written". That "so" is a non-sequitur: the checklist
> is one clause of five. A gate is not read by checking the clause that is easiest to check.

**What Phase 2 still leaves for its successor, named rather than implied:**
- ~~**FR-120/121 mating and pregnancy diagnosis**~~ — **CLOSED 2026-07-28 (`2590c9f`), closes B1.**
  ⚠️ This line said "API and screens not started" for a whole session AFTER they were built, and so
  did its duplicate below. Both are the §2d defect class again: *a checklist line is part of the diff
  that makes it stale.* Caught by the eighth session's audit, not by the commit that made it false.
  ⛔ Note what is closed is the SLICE, not its correctness: pass four found a SEV-2 in it — a
  diagnosis for a species with no gestation row is refused 400 by the server and set aside forever,
  so "the fact is still recorded" is false on the wire. STATUS.md §2f.
- **FR-108 photos** — `photo_key` exists; the local store and deferred upload do not.
- ~~**FR-107 species-specific attribute validation**~~ — **CLOSED** (commit 5e279b1).
- ~~**FR-014/014c passkey enrolment and management from the client**~~ — **CLOSED** (commit
  bb17b24). The last Phase 1 gap. Enrolment offers the passkey FIRST and TOTP as the fallback,
  sign-in satisfies the second factor with it, and Settings → Security lists, adds and revokes.
- ~~**FR-120/121 mating and pregnancy diagnosis**~~ — **CLOSED 2026-07-28 (`2590c9f`).** Everything
  this paragraph listed as missing now exists: `species_gestation` + migration 0019 (biology, so NOT
  jurisdiction-scoped, unlike `veterinary_products`), its `reference-global` sync classification and
  seed, the reference endpoint, the client cache, and both capture screens wired through `App.tsx`.
  It was not half-built, which was the point of parking it.
- **FR-108 photos** — BLOCKED on infrastructure, not on design. `photo_key` exists and
  `architecture.md` plans presigned direct-from-client upload to S3; there is no object storage
  anywhere in this repo and no upload endpoint. Building only the local half would set `photo_key`
  with no image behind it — and `evidence-pack.pdf.ts` prints "Photograph on file: Yes" off exactly
  that field, so the pack would claim a photograph the Stock Theft Unit cannot be shown.
- **FR-132 due/overdue** — needs a vaccination programme schedule that has not been designed.
- **FR-602 unmarked-past-window flag** — `isUnmarkedPastWindow` is done and tested, but the
  prescribed window is dated reference data that `regulatory_rates` does not yet carry, and
  inventing it in code would be exactly the defect the domain rules forbid.

**Deferred to later phases (not a Phase 2 miss):** FR-110 pedigree/breed-% and FR-122/123 breeding
analytics + reminders (P2); FR-134/135/136/137 injury, notifiable-disease flag, medicine inventory,
vet access (P2); FR-143/144 Bluetooth EID/scale + sale-weight projection (P3); FR-152/153/154
rest-period warnings, feed, grazing plan (P2/P3); FR-604 removal certificate, FR-606–613 GlobalGAP/
SIZA/traceability/QR (P2/P3); FR-615 regulatory-rates admin UI (P2); FR-015 global search (P2);
FR-706–710 the analytical reports (P2); and the **PowerSync replication engine (Phase 3)** — Phase 2
livestock is offline-first through the ADR-0003 seam, not through live sync.

---

## Phase 3 — Labour & Wages 🇿🇦 — CRITICAL PATH

Goal: **the wedge.** A farm can pay people correctly and prove it. This is the phase someone pays
for, and it is the phase that gets a farmer sued if it is wrong.

Sub-phases map 1:1 onto [roadmap.md](roadmap.md) Phase 3 (3a–3i). Autonomy for the whole phase is
**LOW** — see [claude-code-playbook.md](claude-code-playbook.md), which is generated from the
roadmap and now says so correctly.

### ⛔ Two external blockers. Neither is a formality, and both have been open since the second session.

**Do not start 3a until both are answered** — they are STATUS.md §2 items 4 and 5, restated here so
a session reading only this file cannot miss them.

```
⛔ B-1 🇿🇦 THE LABOUR-LAW REVIEW IS BOOKED, with a date
   Gates sub-phase 3i, which is an exit-gate line — the phase cannot close without a signed
   written sign-off. It is on someone else's calendar, so the lead time IS the risk: booking it
   in week seven of an eight-week phase means the phase does not close in Phase 3.
   Book it before 3a, not before 3i. → STATUS.md §2.4

⛔ B-2 🇿🇦 EVERY FIGURE IN legal-compliance.md §2.2 RE-VERIFIED AGAINST THE CURRENT GAZETTE
   That table is dated July 2026 and self-describes as decaying. The minimum wage changes every
   March and the BCEA earnings threshold every April, and BOTH have already changed once inside
   the window this pack documents. Seeding `regulatory_rates` from a stale figure produces a
   payroll run that is confidently, checkably wrong — and every payslip generated from it is a
   BCEA s33 document with a wrong number on it, handed to a real person.
   Re-verify FIRST, then seed. Record the Gazette number and date on every row you seed.
   → STATUS.md §2.5
```

> **Neither blocker is satisfied by reading this repo.** They are answered by a human with a
> calendar and a human with the current Gazette. If a session reaches this checklist and they are
> still open, the correct action is to say so and stop, not to seed plausible numbers and carry on.

### Session and review discipline — this phase only

```
□ 3a is a SESSION OF ITS OWN, and a review unit of its own. It is the foundation every other
  sub-phase reads from: get the rate lookup wrong and every number downstream is wrong in a way
  the tests will cheerfully confirm. Do not bundle it with 3b.
□ 3d–3e (the payroll engine and the blocking logic) are MULTIPLE SMALL SESSIONS, never one.
  ⛔ NEVER BATCH PAYROLL SLICES. One rule, one diff, one review, one commit.
□ MANDATORY HUMAN REVIEW OF EVERY DIFF in 3d–3e. Not "the gate is green" — read the diff.
  The gate cannot tell you that overtime was classified against the wrong day's rate.
□ `compliance-checker` runs PER SLICE in this phase, before each commit, not batched at the end
  (CLAUDE.md). Read its output yourself; do not accept a summary of it.
□ Hand-calculate at least one payslip on paper per payroll slice, and compare. Every slice.
```

### 3a · Rates, the lookup, and the jurisdiction seam ⭐ standalone session + standalone review

```
□ ⛔ B-1 and B-2 above are both answered before this sub-phase begins
□ regulatory_rates carries jurisdiction char(2) (ADR-0006); 'ZA' in v1
□ rates.lookup(jurisdiction, code, occurredAt) — resolves BY THE DATE THE WORK WAS DONE,
  never now(). A recalculated February payslip must resolve February's rate
□ A MISSING RATE THROWS. It does not default, fall back, or return the nearest row. A loud
  failure is a five-minute fix; a silent one is a season of wrong payslips nobody distrusts
□ Seed from the Gazette, with gazetteReference + effective_from/effective_to on EVERY row
□ A period spanning 1 March resolves BOTH rates — the every-year case, tested explicitly
□ FR-615: admin UI to update a rate without a deploy (a rate change must not need an engineer)
□ PayrollRules interface with exactly ONE implementation (ZA) — ADR-0006 says why this is the
  narrow case where the seam is justified, and CLAUDE.md says it is not over-engineering
□ NO SA statute name outside jurisdictions/za/ — checked, not assumed
□ The NFR-507 regulated-constants lint rule actually fires on this phase's code
□ compliance-checker over the seeded rates and the lookup, before commit
```

### 3b · Employees

```
□ Employee record (FR-301): name, ID number, job title, start date, contract type, wage rate,
  banking details
□ ID number and banking encrypted with the PII KEY, not the DB key, and NEVER synced to a
  device (.claude/rules/db.md). A stolen phone must not carry 40 workers' ID numbers
□ ID number masked in every read model and every log
□ Age verification at hire (FR-318): block under-15 outright; flag 15–17 for restricted-work
  rules. This is a criminal-liability line, not a validation nicety
□ NFR-203 (PII handling) satisfied and demonstrated by a test, not asserted in a comment
□ Seasonal bulk add + short-form contract + end date (FR-311)
□ compliance-checker (POPIA + child-labour rules), before commit
```

### 3c · Attendance and piece work 📶 offline

```
□ Attendance capture (FR-303): start/end, worker PIN, optional GPS
□ ⛔ NO BIOMETRICS. POPIA s26 and legal-compliance §1.3 — consent from an employer to a farm
  worker is of questionable voluntariness, and this is settled (CLAUDE.md). Do not reopen it
□ Piece work (FR-304): units, rate, worker, block/camp
□ Both capture paths work with the network OFF, and survive a reboot
□ occurred_at is the day worked, captured separately from created_at — a week of attendance
  synced on Friday must not land in Friday's payroll
□ GPS is OPTIONAL and is attendance evidence, not worker tracking (ADR-0010 refused tracking)
```

### 3d · The payroll engine ⭐ MULTIPLE SMALL SESSIONS — never batched, every diff reviewed

```
□ Pure functions in packages/domain. NO I/O, no database, no clock — the engine is testable
  on paper because it will be checked on paper
□ Table-driven tests, because the BCEA rules are table-driven (CLAUDE.md)
□ Ordinary hours (BCEA s9): 45/week; 9/day on a 5-day week, 8/day on a 6-day week
□ Overtime (s10): max 10h/week, paid 1.5×
□ Sunday work (s16): 2×, or 1.5× if the worker ordinarily works Sundays
□ Public holiday (s18): 2× if not ordinarily worked
□ Night work (s17): allowance + transport, 18:00–06:00
□ Piece-rate top-up to the minimum floor — a piece worker below the NMW is topped up, always
□ Deduction caps: accommodation 10%, food 10% (Sectoral Determination 13), from the rates
  table and never from a literal
□ UIF: 1% employee + 1% employer, subject to the monthly CEILING (the ceiling is a rate row)
□ ⭐ The BCEA earnings threshold gates entitlements, and it is resolved BY DATE. A manager on
  R25,000/month is above it as of May 2026 and was below it in April — same person, different
  entitlement to overtime and Sunday pay. This is the single most misunderstood rule in the pack
□ Money is integer cents throughout. No float touches a wage, ever (CLAUDE.md)
□ US-020, US-021, US-022 — ALL scenarios
□ Payroll domain coverage ≥95%, higher than anywhere else in the repo, on purpose
□ Per slice: hand-calculate a payslip on paper; compliance-checker; human reads the diff
```

### 3e · Compliance warnings and blocking ⭐ MULTIPLE SMALL SESSIONS — never batched

```
□ Warnings surfaced BEFORE approval, never after (FR-307) — a warning after approval is a
  record of a decision already made
□ Overtime over the 10h weekly cap
□ Deduction capped (show what it was reduced FROM, and under which rule)
□ Piece rate topped up to the floor (show the shortfall)
□ Net below the floor — this one BLOCKS rather than warns
□ US-021 rejection scenario passes
□ Every warning names the statute and the date-resolved rate it was measured against, so an
  owner can check it rather than trust it
□ Per slice: compliance-checker; human reads the diff
```

### 3f · Payslips and contracts 🇿🇦

```
□ BCEA s33-compliant payslip (FR-308) — every element s33 requires, none missing
□ BCEA s29 written particulars of employment (FR-302)
□ ⭐ BOTH IN THE EMPLOYEE'S LANGUAGE, not the owner's and not the browser's (SRS-20).
  A payslip a worker cannot read does not discharge the obligation it exists to discharge
□ Generated server-side (payslips are server-only and never sync to a device — db.md)
□ Regenerating an old payslip uses THAT PERIOD's rates, not today's
□ compliance-checker over the s33 and s29 output, before commit
```

### 3g · The BCEA s31 record — the inspector at the gate 🇿🇦

```
□ One button (FR-309): name, occupation, time worked, remuneration
□ 3-year retention, and the soft-delete tombstones actually support it
□ Inspector-ready as printed — this is the artifact a Department of Employment and Labour
  inspector is handed at the farm gate, so "export to CSV and open it in something" is a fail
□ US-023 passes
```

### 3h · Leave and the statutory exports

```
□ Annual leave (FR-310): 21 consecutive days, or 1 day per 17 worked; accrual, balance,
  application, approval
□ Sick leave: 30 days per 36-month cycle (6-day week) — the CYCLE is the hard part
□ Family responsibility: 3 days/year
□ Maternity: 4 consecutive months
□ UIF declaration export (FR-312)
□ SARS-compatible payroll export (FR-313)
□ Bank EFT batch file (FR-316)
□ Every export is server-side and audit-logged — financial is server-authoritative (db.md)
```

### 3i · External labour-law review 🇿🇦 ⛔ EXIT-GATE LINE

```
□ The review actually happened (booked at B-1, before 3a)
□ Sign-off IN WRITING, filed in the repo or referenced by document ID from it
□ Every finding either fixed, or recorded in STATUS.md with a named owner and a reason
□ ⛔ The phase does not close without this. It is not a warning; it is the gate
```

**Exit gate:**
```
✓ pnpm verify exits 0
✓ pnpm test:e2e green (both-theme axe on every new screen)
✓ CI green on main
✓ Payroll domain coverage ≥95%
✓ Every US-02x scenario passes
✓ A period spanning 1 March uses BOTH rates          ← the every-year case
✓ A correction run for February uses FEBRUARY's rate
✓ NO regulated constant in code (the NFR-507 lint rule)
✓ NO SA statute name outside jurisdictions/za/
✓ reviewer + sync-auditor + compliance-checker all pass
✓ 🇿🇦 External labour-law review SIGNED OFF, in writing
✓ Every checklist line is ☑ or ◐ with its remainder NAMED
```

**Human check:** hand-calculate one payslip. On paper. Compare it. Then hand a real payslip to
someone who has been a farm bookkeeper for twenty years and watch their face.

**Deliberately NOT in Phase 3, so it is named rather than implied:** FR-305 (task assignment),
FR-314 (labour cost allocated to enterprise/camp/block), FR-315 (teams) and FR-317 (injury-on-duty
register, health data restricted to owner + H&S role) are not in the roadmap's 3a–3i and are not
smuggled in here. FR-317 in particular needs its own access-control design and should not ride
along on a payroll slice.

---

## Phases 4–7 — to be written

Detailed checklists for Phase 4 (finance & compliance 🇿🇦), Phase 5 (hardening & pilot), Phase 6
(integrations) and Phase 7 (intelligence) are authored at the start of each phase from the SRS and
functional-requirements backlog, so they reference real FR/story IDs. Do not pre-write them
speculatively — write each phase's checklist when you reach it, against the requirements as they
stand.

> The previous version of this paragraph described Phase 3 as "offline sync", Phase 4 as
> "crops/fields" and Phase 5 as "labour, wages, finance". All three were wrong against
> [roadmap.md](roadmap.md) — offline sync is **1c**, crops are part of **Phase 2**, and payroll is
> **Phase 3**. The same error had propagated into the playbook's autonomy table, which is the
> document that decides whether a phase may run unattended; it meant the payroll phase was not
> flagged as one to stay at the keyboard for. Both are corrected. If you find a third copy of that
> mapping anywhere, it is wrong too.
