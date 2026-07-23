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
  The grid, sizing, generation and fixed order are done. The live number is NOT: there is no
  domain data to count until the modules land (stated in the scope boundary above), so a tile is
  currently a door with a stable identity. `Tile` accepts `metric`/`badge` props and nothing
  populates them. The FR-017 half lands with Phase 2.
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
◐ @werf/core Zod schema for LandUnit (record + new shapes) — DONE, with the boundary crossing
  the wire as GeoJSON text, never PostGIS. Terminology "camp"/"block"/"other" is still the
  Phase 1 hardcoded landTerm(); moving it to the terminology layer is its own carry-forward item

Core animal records (apps/api + @werf/core + @werf/db, integration-tested on real Postgres)
☑ animals table + animal_identifiers + mobs + enums (animal_status, animal_sex, identifier_type);
  migration (0009) + RLS (all three farm-scoped, ENABLE+FORCE) + TENANCY; GIN index on attributes.
  Proven against real PostGIS: RLS isolation, WITH CHECK write-guard, cross-farm hidden. `species`
  is text (new species = code release, not migration); brand_id deferred to the FR-601 slice
◐ Create an individual animal: species, breed, sex, DOB(+estimated), source, acquired_at (FR-101)
  — the DATA layer + @werf/core Animal schema support every field; the create ACTION (API + capture
  screen) is a later slice. DOB stays a YYYY-MM-DD string, never a coerced Date (off-by-one guard)
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
  — recordDeath done (→ dead via the state machine); API + screen pending
◐ 📶 Record a sale or purchase: counterparty, price (Money/cents), weight (FR-106) — recordSale/
  recordPurchase done (sale → sold; Money is integer cents); API + screen pending
◐ 📶 Record weaning with weight and age (FR-111) — recordWeaning done; API + screen pending
◐ occurred_at is captured separately from created_at everywhere; reports read occurred_at (CLAUDE.md)
  — enforced in schema + domain (occurred_at is injected, distinct from created_at); the
  report/herd-summary read model that READS occurred_at is still pending
☐ 📶 Scope every event to the applicable herd — enterprise/species (cattle/sheep/pig/poultry) or the
  specific animal/mob — so a mixed farm files/filters events correctly; capture REQUIRES a herd
  selection when the event is not tied to one animal (FR-113, NEW from the 2026-07-23 mockup review).
  Mechanism = the events.enterprise_id column that already exists; no schema change (schema §5 note)
☐ 📶 Manual rainfall capture (FR-213, P1) — a farm/land-scoped `rainfall` event: how much (mm) and
  when (occurred_at). Needs an additive ALTER TYPE to add 'rainfall' to event_type + a @werf/core
  payload {mm, gauge?}. Cross-cutting (grazing rest/rotation + cropping both read it), surfaced into
  Phase 2 from the 2026-07-23 mockup review

Breeding (P1 only; FR-122/123 deferred)
☐ 📶 Record mating/service: natural or AI, sire, date, or bull-in/bull-out period (FR-120)
☐ 📶 Record pregnancy diagnosis: method + result; project due date from species gestation
  (gestation is reference data, not a magic number in code) (FR-121)

Health 🇿🇦 (compliance-gated — legal-compliance.md first, compliance-checker before merge)
☐ 📶 Record a treatment: product, batch, dose, route, administered_by, reason (FR-130)
☐ 📶 Automatic withdrawal period from product reference data: compute + store meat/milk withdrawal
  ON THE EVENT (not on read — the rule at time of treatment, ADR-0005); block or hard-warn on
  sale/slaughter within it. Withdrawal periods live in regulatory reference data, by date (FR-131, FR-614)
☐ 📶 Record a vaccination against a programme; show which animals are due/overdue (FR-132)
☐ 📶 🇿🇦 Record a dip/tick treatment (required in controlled areas) (FR-133)

Weights & performance
◐ 📶 Record a weight against an animal or a mob (FR-140) — capture DOMAIN LOGIC done
  (@werf/domain recordWeight → a `weight` event; a pure observation, no status transition; insists
  on exactly one subject, animal xor mob; payload validated at the boundary). API endpoint +
  crush-optimised capture SCREEN (FR-142) are a later slice
◐ 📶 Compute ADG between any two weights (pure @werf/domain, table-driven test); chart the curve
  (FR-141) — averageDailyGain done and table-driven: order-independent, measured on occurred_at,
  weight LOSS is a real negative signal (drought), same-instant readings throw. The chart is UI, deferred
☐ 📶 Weigh session: sequential capture optimised for the crush — one animal per screen,
  one thumb, no scrolling, works with a dead network (FR-142)

SA identity & stock theft 🇿🇦 (compliance-gated)
☐ 🇿🇦 branding_registers table + migration + RLS; mark ≤3 chars enforced in AnimalIdentityRules
  (ADR-0006), NOT a schema CHECK (Namibia's marks differ); certificate ref, mark type, body position (FR-601)
☐ 🇿🇦 Link an animal to its mark; flag animals unmarked past the prescribed window after
  acquisition — the window is reference data resolved by date, never hardcoded (FR-602)
☐ 🇿🇦 Mark an animal missing: status='missing', timestamped, GPS-anchored (FR-605)
☐ 🇿🇦 Stock-theft evidence pack (server-side PDF, one action): identification, ownership chain,
  brand certificate, last-seen GPS+timestamp, movement history, treatment history, SAPS case
  number field. FACTS ONLY — no "suspect" field (defamation + POPIA s26) (FR-603)

Reporting & the grid's live numbers
☐ 📶 Herd/flock summary: counts by class, age, camp; excludes dead/sold from live counts (FR-705)
☐ 🇿🇦 FR-017 completed: each enterprise tile now carries one live number or one attention badge,
  fed from the herd summary — closes the Phase 1 ◐. Tiles stop being empty doors.

Phase 1 carry-forward (closing the Phase 1 ◐/deferred items the gate named as Phase 2 work)
☑ Bundle size gate ENFORCED (not just measured) — the build fails over ≤250KB gz
  (NFR-009, .claude/rules/frontend.md; Phase 1 named this "a Phase 2 first task").
  apps/web/scripts/check-bundle-size.mjs runs in `pnpm --filter @werf/web build`; fail
  path proven against the real dist (currently 96.42 KB gz of a 250 KB budget)
☐ Terminology moves from landTerm() to a real terminology lookup; tile terminology labels
  (Herd/Blocks/Camps…) become translatable, resolving the Phase 1 vocabulary fork (FR-008 remainder)
☐ FR-008 remainders: a language control BEFORE sign-in (so an Afrikaans farmer can onboard in
  Afrikaans), and a profile-update endpoint so a later language change writes back and survives reload
☐ axe widened to the enrolment / recovery-codes / Settings screens (unaudited in Phase 1)
☑ Re-pointed the stale packages/db/seed allowlist path in .gitleaks.toml to the real
  packages/db/scripts/seed.mjs (intent kept, not just deleted); fixed the AppShell.tsx comment
  that still claimed the sync strip lands later — it renders now (both from the Phase 1 reviewer's carry list)

Quality gates
☐ Every write path works with the network off; no `if (!navigator.onLine) throw` anywhere
☐ Domain logic (ADG, gestation projection, withdrawal window, unmarked-animal flag) is pure,
  unit-tested, table-driven where the rule is table-driven; no mocks of our own code
☐ API integration tests against real Postgres in testcontainers; no mocking our own DB
☐ Tenancy: packages/sync/test/tenancy.spec covers every new table; a cross-farm animal/event
  leak fails the build; sync rules and RLS agree (CLAUDE.md)
☐ A real offline cold-start e2e on the BUILT PWA — capture an animal and an event with the
  network off, confirm it survives reload (the Phase 1 reviewer flagged nothing exercised this)
☐ compliance-checker passes on FR-131 and FR-601–605; legal-compliance.md read first
☐ axe-core: 0 violations in BOTH themes on every new screen; pnpm verify exits 0; pnpm test:e2e green
```

**Exit gate:** `pnpm verify` exits 0; `pnpm test:e2e` green (both-theme axe, including the new
offline cold-start capture path); CI green on `main`; every checklist line is ☑ **or ◐ with its
remainder named**; the `reviewer` **and** `compliance-checker` agents pass; a farmer can create a
camp → create an animal → give it a tag → record a weight and a treatment → wean it → mark another
missing → generate a stock-theft pack → see the herd count on the home tile, entirely offline for
the capture paths.

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
