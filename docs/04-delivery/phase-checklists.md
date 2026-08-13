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
☑ Bundle ≤250KB gz (NFR-009); pnpm verify exits 0 — the gate is ENFORCED, not merely measured:
  `apps/web/scripts/check-bundle-size.mjs` fails the build when the budget is exceeded. That was
  the Phase 2 first task this line asked for, and it was done; the line stayed ◐ with the old
  98.6KB figure for the whole phase, contradicting the Phase 2 line below that records the gate.
  A checklist line is part of the diff that makes it stale — fifth occurrence of that class.
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
☑ Define a camp: code, name, GPS boundary, hectares, carrying_capacity_lsu (FR-150) — the create
  ACTION is DONE (commit 961e2d7): `POST /land-units` + `GET`, and an offline capture screen at
  `/land/new` reached from the first-run guide's own link, which until now landed on a placeholder.
  ⭐ The DUAL-WRITE now runs client→server, which nothing enforced: the client authors GeoJSON (it
  has no PostGIS) and the server derives the canonical `geometry` with ST_GeomFromGeoJSON, SRID
  forced to 4326 because ST_GeomFromGeoJSON returns 0 and the column type rejects it; the trigger
  then writes PostGIS' own normalisation back. Proven by comparing the stored mirror to
  ST_AsGeoJSON(boundary), not by asserting both are non-null. Terminology is not re-decided — the
  farm's vocabulary picks the word AND the `kind`, and a vineyard is asked nothing about grazing
  capacity. A duplicate code is refused on the device before it can jam the queue, and refused again
  server-side with a message.
  ⭐ CLOSED: WALKING a boundary by GPS now exists (`/land/walk`, migration 0020, event type
  `boundary_walk`). The line above read "the API accepts and converts one, nothing yet produces one"
  for four sessions; a boundary could only be TYPED, which in practice meant no farm had one. The
  walk marks a corner per tap, closes the ring itself, and refuses — ON THE DEVICE, standing at the
  fence — too few corners, a line that crosses itself, and corners that enclose nothing. Area is
  measured by spherical excess, not on a flat grid, which at −29° is a 14% over-read east–west.
  ⭐ The boundary is an ABSOLUTE THAT RESETS, like a recount: `land_units.boundary` is the
  denormalised current value of the walk log, RE-DERIVED after every arrival by `(occurred_at, id)`
  — so two phones offline in the same week land on the walk that HAPPENED last, not the one that
  arrived last, and the superseded walk is kept because it is a true fact about a fence. The same
  cut runs on the device, so the two sides cannot disagree.
  ⭐ The walk is durable from the FIRST corner (a `DraftStore` sibling in @werf/sync), because a
  200 ha camp takes an hour and phones lock. The declared `hectares` is never overwritten by the
  measured one: one is off a title deed, the other is where the fence runs, and they are shown side
  by side
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
  one, nothing is asked and the herd is stated. DOB and its honest `estimated` flag now exist on the
  screen too, and a bought animal asks for the actual acquisition day: that day is stored on the
  animal AND timestamps the purchase event, rather than quietly substituting the day the phone was
  used. ⚠️ **`dobEstimated` is captured and stored but READ by nothing** — `herd.ts` classifies and
  `WeaningSessionScreen` stamps an age from a possibly-guessed DOB with no marker that it was a
  guess, so an estimate hardens into a fact on an append-only record. Honest at capture, invisible
  after it (tenth pass, tracked on `main`; nothing false reaches the SAPS pack, which prints no DOB). DOB stays a YYYY-MM-DD string, never a coerced Date (off-by-one guard). Still ◐ because
  FR-101 also promises a photo, which remains behind the approved Phase 3 FR-108 storage slice;
  visual/EID identifiers use the dedicated crush tagging action, and dam/sire are captured where
  they can be known honestly (birth/service) rather than demanded for every animal
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
☑ 📶 Automatic withdrawal period from product reference data: compute + store meat/milk withdrawal
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
  ✅ **The CROSS-DEVICE race is closed (`58fed1d`), the way JP decided: FLAG, NEVER REFUSE.** Device
  A records the dip; device B, which has not seen it, tallies to the abattoir. Both captures are
  honest and no ordering can help, because only the server ever sees both. The disposal is recorded
  and a retroactive compliance flag is DERIVED on read — not stamped on arrival, which would be
  order-dependent — and surfaced on the residue register at `/attention`.
  ✅ **Head arriving by `purchase` is no longer unconditionally clear (`2e35e94`).** The group model
  has `transfer_out`/`transfer_in`, which carry the withholding across without tripping the
  food-chain guard, and a purchase may record an OPTIONAL declared seller withdrawal — blank means
  "unknown history", which is never invented.
  ✅ **A carried withholding is a FLOOR, not a ceiling (sixth pass).** The date frozen on the
  transfer is re-derived against the source mob at read time, so a dose that lands after the
  transfer still reaches the flock it walked into.
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
  The stock-theft list and capture, `/not-sent` (the captures the SERVER refused) and `/attention`
  (the residue register, FR-131) are all in the both-theme axe sweep alongside the other capture
  screens. ⛔ Those last two are DIFFERENT SCREENS with near-identical headings — "what needs your
  attention" and "Needs your attention" — and this line named only the first while claiming both,
  which is how `/attention` reached a review with no axe coverage at all in either theme or either
  state. `/attention` and `/land/walk` are in the POPULATED sweep too, since each renders one
  sentence when empty. (The entry counts are deliberately not restated here, for the same reason as
  above.)
```

**Exit gate:** `pnpm verify` exits 0; `pnpm test:e2e` green (both-theme axe, including the new
offline cold-start capture path); both CI lanes green on the PR; every checklist line is ☑ **or ◐ with its
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

**Where the gate stands — read live evidence from STATUS.md, not historical session prose.**

⚠️ **Read the figures from STATUS.md §1, not from here.** This paragraph restated a commit, a test
count and a bundle size for five sessions after they changed, and the arithmetic below ("three
clauses are unmet") was computed from those stale facts. Restating a number in a second document is
how it goes wrong; what belongs here is which CLAUSES hold and why.

| Clause | Reads |
|---|---|
| `pnpm verify` exits 0 | ✅ Uncached: 84 files / 953 tests; 7/7 builds on 2026-08-08 |
| `pnpm test:e2e` green (both-theme axe, incl. the offline cold-start path) | ✅ 27/27 on 2026-08-08 |
| both CI lanes green on the PR | ✅ At `a3894e6`: main gate 4m0s; E2E/axe 1m46s |
| every checklist line ☑ or ◐ with its remainder named | ✅ Remainders are enumerated below |
| the `reviewer`, `sync-auditor` **and** `compliance-checker` agents pass | ⛔ Owner-triggered passes are still required before merge-ready |
| the end-to-end farmer sentence | ✅ Every leg has a route and an offline capture path |

⛔ **The gate does not yet read true.** Its automated clauses and end-to-end journey are green, but
regulated livestock/stock-theft logic still waits on the owner-triggered reviewer, sync-auditor and
compliance-checker passes. The PR remains draft until their findings are closed.

> **The lesson, since it has now happened twice.** STATUS.md §1 concluded "every checklist line is
> ☑ or ◐, **so** the exit gate reads true as written". That "so" is a non-sequitur: the checklist
> is one clause of five. A gate is not read by checking the clause that is easiest to check.

**What Phase 2 still leaves, named rather than hidden in review history:**

- **FR-108 photos:** `photo_key` exists, but there is no object-storage tier or upload endpoint.
  The owner assigned the shared local-first attachment foundation to Phase 3. Until it is built, no
  screen or PDF may claim an image exists.
- **FR-132 due/overdue:** needs a vaccination-programme model and dated reference schedule.
- **FR-602 unmarked-past-window flag:** the pure function exists, but the prescribed period is not
  yet stored as verified dated reference data. Do not replace the missing row with a literal.
- **Phase 3 replication:** Phase 2 stores are behind the ADR-0003 seam but remain browser-local.

**Deferred to later phases (not a Phase 2 miss):** FR-110 pedigree/breed-% and FR-122/123 breeding
analytics + reminders; FR-134/135/136/137 injury, notifiable-disease flag, medicine inventory and
vet access; FR-143/144 Bluetooth EID/scale + sale-weight projection; FR-152/153/154 rest-period
warnings, feed and grazing plans; FR-604 removal certificates; FR-606–613 GlobalGAP/SIZA/
traceability/QR; FR-615 regulatory-rates admin UI; FR-015 global search; FR-706–710 analytical
reports; and the **PowerSync replication engine (Phase 3)** — Phase 2
livestock is offline-first through the ADR-0003 seam, not through live sync.

---

## Phase 3 — Offline sync

Goal: replace the Phase 2 browser-local adapters with the SQLite/OPFS + PowerSync replication layer
accepted in ADR-0003, without changing the domain-facing store contracts or losing a queued capture;
add the one shared local-first attachment path approved on 2026-08-08.

```
☑ 3a PowerSync web SDK is owned by `@werf/sync`; components never import it directly.
  `local-database.ts` is the only file allowed to import `@powersync/web`, enforced by an
  eslint `no-restricted-imports` rule (not just convention) scoped to everywhere outside
  `packages/sync`. `createLocalDatabase`/`LocalDatabase` are deliberately NOT re-exported from
  the package's main barrel yet: building it in showed the SDK's WASM engine (1–2.5MB) gets
  bundled into apps/web's initial chunk even unused, blowing NFR-009's 250KB budget and
  breaking the PWA precache manifest outright. It is reachable via `@werf/sync/local-database`
  for the slice that actually opens a connection (behind a dynamic import, code-split) —
  nothing calls it yet, which is correct: 3a is schema + factory, not a wired-up connection.
  `apps/web/vite.config.ts` also needed `worker: { format: 'es' }` — Rollup's default iife
  worker format cannot code-split and fails the build the moment anything imports the SDK.
☑ 3a Local SQLite/OPFS schema represents every Phase 2 syncable table and reference cache.
  DERIVED, not hand-written: `packages/sync/scripts/derive-local-schema.ts` reads the real
  Postgres schema (`@werf/db`) and the `TENANCY` registry (`packages/sync/src/tenancy.ts`,
  the same registry sync rules/RLS are derived from) and
  `pnpm --filter @werf/sync generate:schema` writes `local-schema-tables.generated.ts`;
  `test/local-schema-freshness.spec.ts` fails CI if the checked-in file drifts. The derivation
  module lives under `scripts/`, never `src/`, because it imports `@werf/db` → `pg`, which
  cannot resolve in a browser bundle and apps/web consumes `@werf/sync` as source with no
  pre-build step — confirmed by testing that `pg`-in-the-bundle failure directly during this
  slice. `test/local-schema.spec.ts` proves every non-`server-only` `TENANCY` table gets a
  local table, every `neverSyncColumns` entry (secrets, PostGIS geometry) is excluded, and the
  result builds a real `@powersync/common` `Schema` that passes `.validate()`.
  ⛔ **Known gap, not an oversight:** `theft_incident_animals` has a composite primary key
  (`incident_id`, `animal_id`) and no surrogate `id` column — the one table in this schema that
  already breaks db.md's "UUIDv7 primary key on every table" rule, independent of PowerSync.
  PowerSync requires one TEXT `id` per synced row, so this table cannot be represented locally
  yet; it is excluded from the generated schema with a test that fails loudly if the exclusion
  goes stale or a new table hits the same gap silently. Tracked as issue #10 (additive migration
  adding the surrogate id). Constructing the real `PowerSyncDatabase` (`local-database.ts`) was
  also confirmed, empirically, to hang forever under plain Node — it opens real OPFS/Worker/WASM
  machinery that only exists in a browser — which is why that file is typechecked but never
  unit-tested; a real open belongs in Playwright, once a later slice gives it a call site.
☑ 3b PowerSync sync rules and Postgres RLS agree for every farm-scoped table; the cross-farm
  tenancy test fails when either side is deliberately made permissive
  2026-08-09: first attempt targeted classic `bucket_definitions` Sync Rules and hit a real
  ceiling — that format forbids JOINs/subqueries in both Parameter and Data Queries, which blocks
  `businesses`/`regulatory_rates`/`veterinary_products` (no bucket at all) and `users` (only the
  connected user's own row, not a co-member's) outright. Re-targeted to PowerSync Sync Streams
  (`edition: 3`), which supports `IN (SELECT ...)` subqueries. `packages/sync/scripts/
  derive-sync-streams.ts` generates `infra/powersync/sync-config.yaml` from `TENANCY`
  (`pnpm --filter @werf/sync generate:sync-rules`), drift-checked by
  `test/sync-streams-freshness.spec.ts`. `test/sync-streams-rls-agreement.spec.ts` reads the real
  RLS migrations off disk and proves tenant-scoped tables are built on `app_user_farm_ids()` and
  reference tables are `FOR SELECT USING (true)`, matching each stream. Empirically confirmed a
  hand-tampered permissive config fails the freshness test.
  ⭐ VALIDATED AGAINST A REAL SERVICE, not just config-parsed: `journeyapps/powersync-service:
  1.23.3` (`infra/powersync/`, Postgres storage backend, self-hosted via docker-compose) booted,
  accepted the generated config with zero errors, and REPLICATED REAL ROWS from all 15 synced
  tables — confirmed by reading the container's own replication log. Two things learned only by
  running it, not from docs: `EXISTS` does not validate under Streams either ("Unknown
  function") — every predicate uses `IN (SELECT ...)` instead, which does the same job — and a
  single invalid stream fails the ENTIRE sync config, no partial-success mode.
  ☑ **Expiry ceiling closed with a bounded bridge:** the rule cannot evaluate
  `farm_users.expires_at` — `now()` is rejected under classic Rules AND Streams — and RLS does
  not protect the replication connection. `MembershipExpiryService` now runs every minute and
  soft-deletes elapsed grants using database `now()`, making `deleted_at` the revocation signal
  RLS and every stream share. A real-Postgres integration test proves only elapsed live rows are
  tombstoned and a cross-artifact test proves every stream consumes that tombstone.
☑ 3b `PowerSyncBackendConnector` implemented (`packages/sync/src/connector.ts`) and `.connect()`
  EMPIRICALLY PROVEN end-to-end against the real self-hosted service, not just unit-tested:
  `fetchCredentials` calls a new `GET /api/sync/token` (`apps/api/src/sync/`), which mints a
  short-lived RS256 JWT (`TokenService.signPowerSyncToken`) from the caller's own session —
  deliberately minimal claims (`sub` only, no farm list), because farm membership is resolved by
  the sync stream's own `farm_users` lookup at replication time, not baked into the token; a
  revoked membership stops syncing on the next replicated write rather than waiting out the
  token's 15-minute TTL.
  ⛔ **Found empirically, 2026-08-09: config validating and rows replicating into the service's
  own storage is NOT the same claim as a connected client receiving them.** A real `.connect()` +
  `waitForFirstSync()` completed with no error and `operations_synced: 0` — every stream in
  `sync-config.yaml` needed `auto_subscribe: true`, which nothing had set, because Sync Streams
  are an opt-in subscription model and nothing in this repo ever subscribed. Fixed in the
  generator (`sync-streams.ts`'s `renderStream`), regenerated, and re-verified against the live
  service: a fresh test farm registered via the real `/api/auth/register` reached the client's
  local `farms` table with exactly its own row (`buckets: 16`, `operations_synced: 6` in the
  service log) — the per-user delivery rung this repo's own validation ladder needed (config
  accepted → rows replicated → parameters indexed → **rows delivered per user**, only the last of
  which this proves). This is now the standing posture: every stream auto-subscribes, matching
  offline-first's premise that a device holds its whole farm by default.
  `uploadData` deliberately THROWS on any queued write rather than draining it silently — db.md's
  "the write queue is never discarded by the system" — because no per-table upload route exists,
  permanently (ADR-0012, closed Phase 3 slice 3d). Proven directly: `connector.spec.ts`'s
  throw-on-nonempty-queue test asserts `complete()` is never called for an unroutable write.
  ⭐ UPDATE (3e): the real application read path now exists —
  `apps/web/src/sync/SyncConnection.tsx` mounts the ONE `.connect()` call inside `AppShell`, live
  as long as an authenticated session is, and the `landed()` hydration fix below landed in the SAME
  slice that wired it, exactly as this box demanded. The diagnostics-only `mode=connect` entry
  remains, unchanged, for the narrower OPFS-open proof it was built for.
☑ 3c Existing localStorage captures migrate transactionally into SQLite on upgrade; interruption
  at every step leaves either the old readable store or the complete new one, never half of each.
  All 12 `Local*.tsx` capture stores now back onto `createSqliteCaptureStore`
  (`packages/sync/src/sqlite-capture-store.ts`), one generic `localOnly` `capture_records` table
  plus a `capture_migrations` marker (`capture-schema.ts`) — `localOnly` keeps every row out of
  the CRUD upload queue, so the existing `Outbox.tsx` stays the sole uploader this slice. Migration
  is per-`store_key`, inside one `writeTransaction`, with the marker re-checked INSIDE the
  transaction (closing a `StrictMode`-driven TOCTOU race outside it would miss) — proven atomic
  under a real interruption in `sqlite-capture-store.spec.ts` and end-to-end against the real
  engine in `apps/web/e2e/capture-migration.spec.ts`. localStorage is read-only throughout, never
  cleared. ⭐ Found and closed in the same slice, not anticipated by the plan: the Outbox could
  flush against a partially-hydrated world (each store hydrates independently and
  asynchronously), producing a real wire-order violation — a tally posting before the dose it must
  be guarded by. Fixed by widening `CaptureStore<T>` with `settled()` and gating the flush AND the
  `'synced'` status on every store settling. A second, related bug (`TagSessionScreen`/
  `WeaningSessionScreen` freezing their work queue on a mount-time snapshot of pre-hydration data)
  was found by the same investigation and closed the same way. Full account:
  `docs/04-delivery/phase-3-capture-migration-2026-08-09.md`.
☑ 3c Rollback/support-window behaviour is documented for a client that stays offline 12 months —
  same doc: a device that never completes an SW install for this build never runs the migration at
  all (Workbox only activates once its full precache list, including the now-precached PowerSync
  engine, has downloaded), and localStorage is never deleted, so manual recovery remains possible
  indefinitely. NFR-009's bundle gate now excludes the precached engine from the interactive-path
  JS sum (owner-confirmed decision, 2026-08-09) — `apps/web/scripts/check-bundle-size.mjs`,
  `apps/web/vite.config.ts`.
☑ 3d Queue is durable across browser kill and reboot; read data may be evicted, queued writes may
  not. **Quota-pressure eviction is unimplemented** — no retention/eviction code exists yet, so
  the claim is vacuously true today rather than stress-proven; that proof is 3f's job (a
  dedicated box below), not re-claimed here. Kill/reboot itself is proven against the real
  engine, in a real browser, on the built PWA: `apps/web/e2e/offline-capture.spec.ts` captures
  with the network off, `page.reload()`s (a full document + worker + WASM reboot, on the capture
  ROUTE so the service-worker navigation fallback is exercised too) still offline, and asserts
  the record and the "Offline — your work is saved" status both survive — then lets the signal
  return and proves the queue drains and does not re-send. `apps/web/e2e/capture-migration.spec.ts`
  proves the same reboot shape for the 3c SQLite/OPFS store itself.
☑ 3d 4xx records are retained and set aside while the round continues; 5xx/unrecognised failures
  abort the round; an expired refresh token holds rather than clears the queue. Not new work —
  this was built and proven during 3c's own follow-up (STATUS.md §5 item 12: sync-auditor Finding
  2, the bounded 90s throttle retry) and by `Outbox.test.tsx`'s pre-existing invariant-5 test
  ("keeps every capture when the session cannot be refreshed"), which asserts the capture store is
  byte-identical, nothing joined the sent-log, and the session was not cleared. Audited during 3d
  and found already correct and already covered; no code changed.
☑ 3d Every changing-state capture checks idempotency before validation on the server. Audited
  every mutation in `livestock.service.ts`, `land.service.ts`, `rainfall.service.ts` against
  `event-capture.ts`'s `findEvent` rule: the two captures that overwrite state their own
  validation reads — `recordMobTally` (head count) and `recordMove` (animal position) — both
  check `findEvent` BEFORE validating, proven by
  `livestock.integration.test.ts`'s "does not take the same animals off twice when the flush
  retries" and "is idempotent on the client id even though the first move changed what it
  validates". Every other capture is a pure append to `events` (or, for `recordBoundaryWalk`, a
  re-derivation that is a projection rather than a validation — see that function's own comment)
  and is idempotent via `onConflictDoNothing` alone, with no self-referential state to race.
  Audited during 3d, no gap found, no code changed.

⛔ **Not this slice — read before assuming `PowerSyncBackendConnector.uploadData` is an open
  TODO.** `connector.ts`'s header now states the decided architecture: every capture table is
  `Table.createLocalOnly` (`capture-schema.ts`), so PowerSync's own CRUD upload queue is empty by
  construction and `Outbox.tsx` stays the permanent uploader, not a stand-in awaiting a 3d
  migration. This was checked against the installed SDK, not assumed:
  `CrudBatch`/`CrudTransaction.complete()` (`@powersync/common`) acknowledge a batch as a whole —
  there is no per-entry completion — so "a 4xx record is retained and set aside while the round
  continues" cannot be expressed on top of the native CRUD queue without either discarding the
  refused entry (forbidden) or blocking every entry behind it forever (the `Outbox.tsx`
  strand-the-queue shape already fixed once). `uploadData` throwing on a non-empty batch is now
  documented as a tripwire for that invariant, not a stopgap for missing routing. Owner question
  raised in STATUS.md §3: this reading conflicts with how earlier STATUS/doc entries phrased
  `uploadData` as "not yet wired — 3d"; flagged rather than silently resolved.
◐ 3e Two-device conflict matrix — CLOSED for mobs/tallies, the entity pair this slice scoped to
  (fallback clause: "the smallest complete vertical rung that proves the two-device issue #8
  journey end-to-end"). Append-only events coexist; aggregate projections fold from the immutable
  `initialHeadCount` baseline over the `(occurred_at, id)` total order — same rule the server
  applies, same result either side. Animals/moves/health/land hydration merging is NOT built —
  named here so it is not silently assumed covered by this box's checkmark. Evidence: fake-driven
  `Outbox.test.tsx`'s `tripwire 3e (issue #8)` suite (5 tests) + `hydrated-table-store.spec.ts` (5
  tests) + `HydratedLivestock.test.ts` (4 `mergeById` tests) + `herd.test.ts` (2 hydrated-fold
  tests) + the real-service e2e below.
◐ 3e Recount resets rather than adds, and arrival order cannot change the derived result — proven
  for mobs/tallies: `Outbox.test.tsx`'s "a hydrated RECOUNT still resets, and funds a decrease the
  created baseline alone could not" and "hydration arriving OUT OF chronological order projects
  the same result".
☑ 3e HYDRATION TRIPWIRE, LEFT BY THE TENTH PASS — CLOSED. `landed()` in `apps/web/src/sync/
  Outbox.tsx` is now `sentLog.has(id) || hydratedTallyIds.has(id)`, where `hydratedTallyIds` comes
  from `HydratedLivestock.tsx`'s `useHydratedTallies()` (`packages/sync/src/hydrated-table-store.ts`,
  a new read-only reactive store over the down-synced `mobs`/`events` tables, farm-scoped, never
  imports `@powersync/web` from application code — ADR-0003 intact). `needsHead`'s fold now merges
  local and hydrated tallies via `mergeById` (local wins on a shared id — a device's own capture is
  never staler than its own later-hydrated echo). `AdjustMobScreen`'s `headAsAt` needed the SAME
  merge independently — found while implementing, not anticipated: without it, a decrease against a
  mob this device never captured anything about refused at CAPTURE TIME with "this group is managed
  as individual animals" before ever reaching the outbox.
  Proven two ways, not one:
  - **Fake-driven** (`Outbox.test.tsx`, watched to FAIL first by temporarily reverting the fix):
    Device B hydrates a birth another device landed, without it in Device B's own sent log; Device
    B's decrease is sent, not held; cross-farm hydrated rows never fund a decrease; a hydration
    failure still holds the whole queue fail-closed; hydration arriving out of order does not change
    the projection.
  - **Real service** (`apps/web/e2e/real-sync-hydration.spec.ts`, gated behind `WERF_REAL_STACK=1`,
    not part of `pnpm test:e2e`'s default lane — needs `apps/api` + `werf-postgres` +
    `werf-powersync` live, see the spec's own header for the exact bootstrap): a real REST-landed
    birth tally, a real second login, a real PowerSync `.connect()`, real SQLite hydration, the
    real capture UI, a real send, and a real Postgres row-count check for the resulting decrease.
    Also covers test 10 (browser reload preserves both the read projection and the — by then empty —
    queue; real OPFS persistence, which no fake reaches). Run 3× clean (fresh `apps/api` process
    each time, in-memory auth-throttle counters reset) — 3/3 green.
  ⭐ **The real-service run found a genuine, previously-unknown production defect the fake suite
  structurally cannot see**: `events` (migration 0010) is a Postgres PARTITIONED table with one
  partition, `events_default`. PowerSync attributes replicated WAL rows to the PARTITION's own
  relid, not the parent's, and explicitly REFUSES `publish_via_partition_root` (`PSYNC_S1143`,
  confirmed against `journeyapps/powersync-service:1.23.3` by setting it and reading the boot
  error). So `FROM events` against the partitioned parent VALIDATES and "replicates" — the config
  loads clean, the server logs show flushes — while a connected client receives **zero rows**,
  forever, no error anywhere. `mobs` (not partitioned) hydrated correctly the whole time, which is
  what made this take four restarts and a raw-row diagnostic to isolate rather than being obvious
  from the first red run. Fixed at the SOURCE (`packages/sync/scripts/derive-sync-streams.ts`'s new
  `PARTITIONED_SOURCE_TABLE` map + `sync-streams.ts`'s new `SyncStreamDef.sourceTable`, rendering
  `FROM events_default AS events` — the alias keeps the LOCAL client table name, which is matched
  by stream key, not by Postgres FROM text, unaffected), regenerated (not hand-patched — the
  freshness spec would have caught a hand-patch drifting from the generator), all 125
  `@werf/sync` tests green. **This is production-blocking knowledge, not a dev-only quirk**: the
  af-south-1 deploy's publication needs the identical aliased config or down-sync of every event
  (tally, move, treatment, dose, birth, death, sale — everything the product's whole event log
  carries) silently delivers nothing to any client, forever, with a config that validates and a
  server that reports success. Found independently by `reviewer` and `sync-auditor` (issue #8
  itself); NOT a Phase 2 defect — it cannot fire in the shipped configuration.
⚠️ **`sync-auditor` pass, 2026-08-10, over `585ddb2..fc3d9e2` (the 3d audit, ADR-0012, this whole 3e
  slice) — did NOT clear (two SEV-2).** Per STATUS.md §6 clause 2 that is not the terminal condition;
  both are fixed below, each with a test watched to FAIL first, and a re-pass over the fix diff is
  the next step, not optional. The hydration TRIPWIRE above (issue #8, `landed()`) is unaffected —
  a different bug in the same mechanism.
  - **Finding 1 (SEV-2, compliance-gated FR-131) — FIXED.** The withholding guard read raw local
    `tallies`, blind to a `transfer_in` this device only knows about via down-sync, at THREE call
    sites: `AdjustMobScreen.tsx`'s capture-time guard (the SEV-2 — previewed CLEAR on a sale the
    server would refuse), `Outbox.tsx`'s `mobDisposalSubjects` taint chain-walk (a refused dose on
    a hydrated-only transfer's source mob held nothing), and `residue.ts`'s register (display-only,
    LOW/MED). Root cause was two-part: `mapHydratedTally` silently dropped `counterpartMobId`/
    `carriedWithholdUntil`/`declaredWithdrawalUntil` even though the server persists them (traced
    to `livestock.service.ts`'s insert before trusting the schema alone), and all three call sites
    passed raw `tallies` instead of the local+hydrated `mergeById` fold. Fixed both; all three call
    sites now read the fold. Tests: `AdjustMob.test.tsx` (a mob whose ENTIRE arrival history is
    hydrated refuses a slaughter), `Outbox.test.tsx` (a refused dip on a source mob holds a
    slaughter on the destination when the connecting transfer is hydrated-only, present before the
    FIRST flush attempt — a mid-test hydration cannot exercise this once an item has already sent),
    `AttentionScreen.test.tsx` (the register flags the same hydrated-only case). ⛔ Per CLAUDE.md's
    compliance gate: this slice is not merge-ready, and its PR must not be marked ready, until the
    owner asks for a `compliance-checker` pass and it closes — the original "this diff touches no
    regulated code" framing (used to justify not requesting one) is now stale.
  - **Finding 2 (SEV-2) — NOT fixed; tripwired, and an owner decision is raised in STATUS.md §3.**
    `PARTITIONED_SOURCE_TABLE` (the fix above) is a hand-maintained map, not derived from
    `pg_inherits`, and it is correct TODAY only because `FarmsService.createFarm` — the real
    onboarding path — never calls `create_farm_partition`. `packages/db/scripts/seed.mjs` and
    `events.integration.test.ts`'s own fixtures DO call it, so events for THOSE farms already
    silently fail to down-sync, reproducibly, today. A regression test
    (`apps/api/src/farms/farms.integration.test.ts`, "never gives a REAL onboarding farm its own
    events partition") pins today's safe reality and goes red the day anyone wires
    `create_farm_partition` into real onboarding without also teaching the generator — the tripwire,
    not the fix. The fix is an architecture decision (wire provisioning + make the generator read
    partitions dynamically, vs. retire per-farm partitioning) that is JP's to make, not mine to guess.
  - **LOW (resource leak, not a data leak) — fixed.** `hydrated-table-store.ts`'s `db.watch()` had no
    teardown; `HydratedLivestockProvider` built a fresh store pair per farm switch and never closed
    the previous one. Added `close()` (an internal `AbortController`, wired to the real SDK's
    `SQLWatchOptions.signal`) and a `useEffect` (not `useMemo` — a memo's return has no cleanup hook)
    keyed on the store value, closing on farm switch/unmount. Fail-first test:
    `hydrated-table-store.spec.ts`, "close() stops watching".
✅ **`sync-auditor` RE-PASS, 2026-08-10, over `fc3d9e2..dd49a20` (the fix commit above).** Confirmed
  Finding 1's three call sites genuinely fixed and consistent, no fourth call site missed, the
  `Outbox.test.tsx` timing was correct (hydrates before `render()`), and the LOW fix matched the
  real SDK. Two things it found, both fixed same day (`HydratedLivestock.tsx`,
  `farms.integration.test.ts` — both within the files the findings name, both fail-first tested, so
  per STATUS.md §6 clause 3 this did not require ANOTHER pass):
  - **MEDIUM — genuinely new, introduced by the LOW fix itself.** The `useEffect` cleanup and the
    `useMemo`-built store pair were not symmetric under React 18 StrictMode: mount → run the effect
    → immediately simulate an unmount (run the cleanup) → remount (re-run the effect), all against
    the SAME memoized pair since `farmId` never changed across that synthetic cycle.
    `AbortController.abort()` has no undo, so hydration died PERMANENTLY after the first mount in
    `pnpm dev` (`main.tsx` wraps `&lt;App/&gt;` in `&lt;StrictMode&gt;`) — invisible to every
    existing test and to `pnpm test:e2e` (a production build strips the double-invoke). Fixed by
    moving construction INSIDE the effect, mirroring `SyncConnection.tsx`'s already-established
    shape for exactly this class of resource — the effect's setup and cleanup are now symmetric, so
    a StrictMode cycle closes one pair and builds a fresh one, same as a real farm switch. First
    paint reads a permanently-unsettled, subscription-free placeholder (`settled()` already started
    `false` by design — one more tick of a state every consumer already tolerated). Fail-first test:
    `AdjustMob.test.tsx`, "a StrictMode double-invoke does not permanently kill hydration" — renders
    `&lt;StrictMode&gt;&lt;App/&gt;&lt;/StrictMode&gt;` and asserts a pre-hydrated birth is still
    visible after mount.
  - **Test-coverage gap in Finding 2's tripwire.** The original tripwire only exercised
    `AuthService.register`'s own direct farm insert, not `FarmsService.createFarm` — the exact
    function Finding 2's text names, and a genuinely SEPARATE insert path (confirmed: `register`
    does not call `createFarm`). Strengthened to assert BOTH paths land in `events_default`.
✅ **Finding 2 CLOSED, 2026-08-13 — JP chose retirement, not wiring-up, after the "wire it up
  properly" option was found to hide a worse defect.** JP's first answer was option (a): wire
  `create_farm_partition` into `FarmsService.createFarm` and teach the generator to read
  partitions from `pg_inherits` dynamically. Before implementing, a second look surfaced a
  conflict the original three-option framing missed: `generate-sync-streams.ts` writes a STATIC
  file, generated at build/deploy time, never regenerated per farm at signup — and PowerSync
  rejects `publish_via_partition_root` (`PSYNC_S1143`, already confirmed), so a stream can only
  ever read a partition that existed when the config was generated. Reading `pg_inherits`
  dynamically only helps at generation time; it cannot see a farm that signs up afterward. Under
  (a), every farm created after the last config deploy would silently down-sync nothing —
  converting Finding 2's latent risk into a guaranteed one for every real farm, which is worse
  than the status quo it was meant to fix. Taken back to JP with the new fact; JP chose to retire
  partitioning outright. Migration 0021 drops `create_farm_partition`; `events_default` is now the
  permanent, only partition; `PARTITIONED_SOURCE_TABLE`/`sourceTable` in `derive-sync-streams.ts`
  stay as they are (still true, now permanently rather than by accident). Full record: STATUS.md §3.
◐ 3f Retention window degrades only the read set; storage-quota tests prove the queue survives.
  **Queue-survival half CLOSED, 2026-08-13**: `sqlite-capture-store.spec.ts`'s new fail-first test
  found a REAL durability bug this checklist line exists to catch — `persist()` swallowed a
  `QuotaExceededError` and left the record in-memory only, so a browser restart before the NEXT
  successful write lost it silently, contradicting db.md's "the write queue is never bounded and
  never evicted." Fixed in `sqlite-capture-store.ts`: a failed persist joins a retry set
  (`unpersisted`) drained by a bounded interval (`PERSIST_RETRY_INTERVAL_MS`, self-stops once
  empty) rather than being dropped. ⚠️ Known, narrow follow-on (documented in `scheduleRetry`'s own
  comment, not silently left): the store has no `close()`, so a farm switch mid-retry leaks the
  timer — harmless for correctness (one shared on-device `werf.db`, farm-scoped by row, not by
  file) but not yet symmetric with `hydrated-table-store.ts`'s `close()` fix; wiring it through all
  twelve `Local*.tsx` providers is unstarted. ⛔ **Read-set window half NOT built — an owner
  decision, not an oversight.** Empirically probed against the real service (see
  `sync-streams.ts`'s 2026-08-13 header addendum): `subscription.parameter()` genuinely exists, but
  the service refuses ANY expression mixing row data with a subscription/connection parameter
  except via `=` — *"This expression already references row data, so it can't also reference
  connection parameters unless the two are compared with an equals operator"* — so
  `occurred_at > subscription.parameter('cutoff')` cannot load. Same problem class as
  `farm_users.expires_at`'s `now()` ceiling (§3b), and per STATUS.md §3's standing instruction not
  to invent a sweep-shaped fix without JP: left open. See STATUS.md § 3 for the decision this is
  waiting on.
☑ 3g Additive-migration tests send an old-client payload after the new schema is deployed.
  `livestock.integration.test.ts`'s new `mob creation (FR-102)` test builds the EXACT pre-0018
  request shape (no `initialHeadCount` key at all, not merely `undefined`) and proves today's
  `newMobSchema` still accepts it and `recordMob` derives the baseline correctly — watched to FAIL
  first by making `recordMob` read the body's own `initialHeadCount` instead of the captured
  `headCount`.
☑ 3h Sync health reports queue depth/failure per farm without PII. New `apps/web/src/sync/
  syncHealth.ts`: a pure fold (`deriveSyncHealth`) over the SAME `queue`/`blocked`/`waiting`
  `Outbox.tsx` already computes, wired through a new `useSyncHealth()` hook/context. "Without PII"
  is a TYPE guarantee, not a runtime filter — `SyncHealthByKind` has no free-text field at all, only
  counts and the closed `CaptureKind` enum — pinned by a test asserting the exact key set. ⚠️ Scope
  note: the pure fold and its wiring into `OutboxProvider` are both unit-tested; there is
  deliberately no consuming screen yet (this checklist line asks for a reporting SURFACE, not a new
  UI, and every existing hook of this shape — `useRefusedCaptures`, `useHeldCaptures` — already had
  a screen before it existed, unlike this one; a future support/diagnostics consumer is what would
  use it).
☑ 3i(a) Attachment metadata is farm-scoped, client-UUIDv7, soft-deleted and synced through SQLite.
  Migration `0022_attachments.sql` (hand-written — see its own header on why `drizzle-kit generate`
  could not be used cleanly here): `attachments` table, `attachment_subject_type`/`attachment_status`
  enums, RLS + FORCE, indexes incl. a partial index for the orphan-cleanup sweep 3i(b) will need.
  `TENANCY.attachments` added (`packages/sync/src/tenancy.ts`); local schema and
  `infra/powersync/sync-config.yaml` regenerated and empirically confirmed loading clean against the
  real `journeyapps/powersync-service:1.23.3` (restarted, "Loaded sync config" with no error) — the
  publication is `FOR ALL TABLES`, confirmed via `pg_publication_tables`, so no publication-side fix
  was needed this time. `tenancy.spec.ts`'s generated-from-the-registry test caught the missing
  fixture row exactly as db.md promises adding a table without classifying it would.
  ⛔ **Not yet built: the binary path.** "The binary stays in OPFS until its checksum-confirmed
  server acknowledgement is durable" is 3i(c) scope, unstarted this session.
◐ 3i(c) Animal photos and later crop/grievance documents use one deferred queue: capture commits
  locally with no signal, browser kill/reload loses neither metadata nor blob, and retry is idempotent.
  ⛔ **Deliberately NOT started this session — a scoping decision, not an oversight.** `Outbox.tsx`
  is the most defect-dense file in the repo (ten review passes, each finding a bug in the previous
  pass's fix); a correct integration is not "append a `FlushItem`" — it needs an `animalrow:`
  subject namespace mirroring `mobrow:` (so an attachment behind an unsent/refused animal is HELD,
  not 404-set-aside), touches the animal items' `provides`, and needs `Outbox.test.tsx` coverage
  plus an OPFS-durability e2e (`local-db-diagnostic.spec.ts`'s shape) since OPFS is browser-only and
  the unit tier cannot reach it. Design decisions made so the next session starts warm rather than
  re-deriving them: (a) the three-leg send (create → PUT → finalize) is end-to-end idempotent by
  construction (3i(b)), so it can be ONE `FlushItem`, not three; (b) ordering is FK-only, after
  animals — no safety ordering applies (nothing here is evidence a disposal guard reads), but it
  needs the new `animalrow:` subject; (c) the local blob is released only once `finalize` returns,
  never on the PUT's own 200 — a PUT can succeed while the app is killed before `finalize` runs, and
  the queue must still hold the blob to retry that leg; (d) a `BlobStore` port/OPFS-adapter split,
  the same port/adapter shape 3i(b)'s `ObjectStorage` uses, for testability without a browser.
◐ 3i(b) The API authorises the farm before issuing a short-lived presigned upload; object keys are
  server-derived, never arbitrary client paths, and another farm can neither upload nor read them.
  **Closed.** `apps/api/src/attachments/`: `createAttachment`/`finalizeAttachment`
  (`assertCanCapture` + a farm-scoped subject check before either), object key deterministic from
  `(farmId, id)` — a retried create reuses it rather than orphaning a new one. 9/9 integration tests
  green against real Postgres AND real MinIO (testcontainers, never mocked): cross-farm create
  refused, cross-farm subject refused, cross-farm finalize refused, both idempotency shapes, and the
  wire response is pinned by parsing it through `attachmentUploadUrlSchema` after a JSON round-trip
  (caught a real contract bug — see STATUS.md § 3).
◐ 3i(b) One S3-compatible adapter uses MinIO in development/integration tests and S3 in `af-south-1`
  in production; tests cover checksum/size refusal, quota pressure, retry and orphan cleanup.
  **Checksum and size refusal closed** — empirically confirmed against `minio/minio:latest` that a
  presigned PUT with `ChecksumSHA256` bound into the SigV4 signature is refused server-side (400
  `XAmzContentChecksumMismatch`) on a body that doesn't hash to the declared value, so `finalize`
  only re-derives size/checksum from the stored object via `HeadObject` rather than re-hashing the
  body itself (`object-storage.ts`'s header has the full empirical account). A size-lie test and a
  checksum-lie test (the latter written directly to the bucket, bypassing the presign — the PUT-time
  enforcement makes a mismatched object impossible to produce any other way) both pass.
  docker-compose gains a `minio` service + one-shot bucket init for dev parity.
  ⛔ **Quota pressure, retry-on-transient-failure and orphan cleanup NOT built** — the agreed stage
  boundary for this slice (STATUS.md § 5); the partial index `0022_attachments.sql` added for an
  orphan sweep exists but nothing reads it yet.
☑ 3i(d) Existing Phase 2 `photo_key` rows migrate without inventing an attachment; null remains none.
  Grepped: no code path in `apps/web/src` has ever set `photoKey` — Phase 2 genuinely stored no
  photo. `livestock.integration.test.ts`'s new test proves `recordAnimal` with no photo leaves
  `photo_key` null AND creates no `attachments` row for it — creating an animal must never invent an
  attachment. No data migration was needed because there is no non-null production data to migrate.
☐ Offline matrix in testing-strategy.md runs against real Postgres and the real adapter
☐ `pnpm verify` and `pnpm test:e2e` green; owner-triggered sync-auditor findings closed
```

**Exit gate:** six weeks of offline captures reach another device with every `occurred_at` intact;
a deliberately permissive sync rule fails tenancy tests; no queue record or queued attachment is
lost on retry, refusal, refresh expiry, schema upgrade, browser restart or quota pressure.

---

## Phase 4 — Crops & fields

Goal: ship the crop notebook replacement on the real Phase 3 sync layer.

```
☐ 4a Blocks and plantings (FR-201…204), with canonical PostGIS geometry plus synced GeoJSON text
☐ 4b Fertiliser and harvest capture (FR-205…207), fully offline
☐ 4c Versioned chemical-product reference data (FR-208…212), available on the device
☐ 4d PHI and re-entry rules enforced at capture and at the server boundary; regulated intervals
  come from dated reference data, never constants
☐ 4d US-030 passes with the network off, including the explicit override/reason audit path
☐ 4e Grazing, feed and inventory links (FR-150…153, FR-501…503)
☐ Crop home metrics are derived from local data and never require signal to render
☐ `pnpm verify` and `pnpm test:e2e` green; regulated crop logic waits on the owner-triggered
  compliance pass before merge-ready
```

---

## Phase 5 — Labour & wages 🇿🇦 — CRITICAL PATH

Goal: **the wedge.** A farm can pay people correctly and prove it. This is the phase someone pays
for, and it is the phase that gets a farmer sued if it is wrong.

Sub-phases map 1:1 onto [roadmap.md](roadmap.md) Phase 5 (5a–5i). Autonomy for the whole phase is
**LOW** — see [claude-code-playbook.md](claude-code-playbook.md), which is generated from the
roadmap and now says so correctly.

### ⛔ Two external blockers. Neither is a formality, and both have been open since the second session.

**Do not deploy Phase 5 until both are answered.** Placeholder dev/test rate rows may support the
mechanics, but a production seed must reject every unverified row.
a session reading only this file cannot miss them.

```
⛔ B-1 🇿🇦 THE LABOUR-LAW REVIEW IS BOOKED, with a date
   Gates sub-phase 5i, which is an exit-gate line — the phase cannot close without a signed
   written sign-off. It is on someone else's calendar, so the lead time IS the risk: booking it
   in week seven of an eight-week phase means the phase does not close.
   Book it while Phases 3–4 build, not before 5i.

⛔ B-2 🇿🇦 EVERY FIGURE IN legal-compliance.md §2.2 RE-VERIFIED AGAINST THE CURRENT GAZETTE
   That table is dated July 2026 and self-describes as decaying. The minimum wage changes every
   March and the BCEA earnings threshold every April, and BOTH have already changed once inside
   the window this pack documents. Seeding `regulatory_rates` from a stale figure produces a
   payroll run that is confidently, checkably wrong — and every payslip generated from it is a
   BCEA s33 document with a wrong number on it, handed to a real person.
   Re-verify FIRST, then seed. Record the Gazette number and date on every row you seed.
   Record the source and verification date in the compliance register.
```

> **Neither blocker is satisfied by reading this repo.** They are answered by a human with a
> calendar and a human with the current Gazette. If a session reaches this checklist and they are
> still open, the correct action is to say so and stop, not to seed plausible numbers and carry on.

### Session and review discipline — this phase only

```
□ 5a is a SESSION OF ITS OWN, and a review unit of its own. It is the foundation every other
  sub-phase reads from: get the rate lookup wrong and every number downstream is wrong in a way
  the tests will cheerfully confirm. Do not bundle it with 5b.
□ 5d–5e (the payroll engine and the blocking logic) are MULTIPLE SMALL SESSIONS, never one.
  ⛔ NEVER BATCH PAYROLL SLICES. One rule, one diff, one review, one commit.
□ MANDATORY HUMAN REVIEW OF EVERY DIFF in 5d–5e. Not "the gate is green" — read the diff.
  The gate cannot tell you that overtime was classified against the wrong day's rate.
□ `compliance-checker` runs PER SLICE in this phase, not batched at the end
  ⛔ **AMENDED 2026-07-28 — THE AGENT IS OWNER-TRIGGERED AND IS NEVER SPAWNED UNPROMPTED.** Every
  "before commit" below now means: the slice may be written, tested and COMMITTED without it, but it
  is **not merge-ready and its PR must not be marked ready** until JP has asked for the pass and the
  findings are closed. Whoever writes the slice must SAY OUT LOUD that it is waiting on one, so the
  decision is made by JP rather than by silence. Reading `legal-compliance.md` first is unchanged.
  Governing rule: `CLAUDE.md` § "Compliance gate on regulated code"
  (CLAUDE.md). Read its output yourself; do not accept a summary of it.
□ Hand-calculate at least one payslip on paper per payroll slice, and compare. Every slice.
```

### 5a · Rates, the lookup, and the jurisdiction seam ⭐ standalone session + standalone review

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

### 5b · Employees

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

### 5c · Attendance and piece work 📶 offline

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

### 5d · The payroll engine ⭐ MULTIPLE SMALL SESSIONS — never batched, every diff reviewed

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

### 5e · Compliance warnings and blocking ⭐ MULTIPLE SMALL SESSIONS — never batched

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

### 5f · Payslips and contracts 🇿🇦

```
□ BCEA s33-compliant payslip (FR-308) — every element s33 requires, none missing
□ BCEA s29 written particulars of employment (FR-302)
□ ⭐ BOTH IN THE EMPLOYEE'S LANGUAGE, not the owner's and not the browser's (SRS-20).
  A payslip a worker cannot read does not discharge the obligation it exists to discharge
□ Generated server-side (payslips are server-only and never sync to a device — db.md)
□ Regenerating an old payslip uses THAT PERIOD's rates, not today's
□ compliance-checker over the s33 and s29 output, before commit
```

### 5g · The BCEA s31 record — the inspector at the gate 🇿🇦

```
□ One button (FR-309): name, occupation, time worked, remuneration
□ 3-year retention, and the soft-delete tombstones actually support it
□ Inspector-ready as printed — this is the artifact a Department of Employment and Labour
  inspector is handed at the farm gate, so "export to CSV and open it in something" is a fail
□ US-023 passes
```

### 5h · Leave and the statutory exports

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

### 5i · External labour-law review 🇿🇦 ⛔ EXIT-GATE LINE

```
□ The review actually happened (booked at B-1, before 5a)
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

**Deliberately NOT in Phase 5, so it is named rather than implied:** FR-305 (task assignment),
FR-314 (labour cost allocated to enterprise/camp/block), FR-315 (teams) and FR-317 (injury-on-duty
register, health data restricted to owner + H&S role) are not in the roadmap's 5a–5i and are not
smuggled in here. FR-317 in particular needs its own access-control design and should not ride
along on a payroll slice.

---

## Phases 6–7 — to be written

Detailed checklists for Phase 6 (finance & compliance 🇿🇦) and Phase 7 (hardening & pilot) are
authored at the start of each phase from the SRS and
functional-requirements backlog, so they reference real FR/story IDs. Do not pre-write them
speculatively — write each phase's checklist when you reach it, against the requirements as they
stand.

> The earlier map put full PowerSync replication in Phase 1 and crops beside livestock in Phase 2,
> while the built code had only browser-local adapters and no crop module. That made a phase appear
> complete by changing the checklist rather than meeting the authoritative roadmap. The reconciled
> sequence is Phase 2 livestock, Phase 3 offline sync, Phase 4 crops, Phase 5 labour, Phase 6
> finance/compliance and Phase 7 hardening/pilot.
