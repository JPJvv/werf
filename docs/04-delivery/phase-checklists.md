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

## Phases 2–7 — to be written

Detailed checklists for Phase 2 (livestock), Phase 3 (offline sync — the hard one), Phase 4
(crops/fields), Phase 5 (labour, wages, finance), Phase 6 (compliance packs), and Phase 7 (polish,
i18n, PWA hardening) are authored at the start of each phase from the SRS and functional-requirements
backlog, so they reference real FR/story IDs. Do not pre-write them speculatively — write each phase's
checklist when you reach it, against the requirements as they stand.
