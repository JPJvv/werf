# @werf/db

Drizzle schema, migrations, and RLS policies for the Werf database. See
`docs/03-architecture/database-schema.md` and `.claude/rules/db.md` for the rules every
table obeys (UUIDv7 PKs, `farm_id`, soft-delete, audit columns, jurisdiction, RLS).

## Local database

```bash
pnpm real-stack:up # local env + Docker + migrations + the RLS-bound app login
pnpm db:up         # Docker services only (runs setup:local first)
pnpm db:migrate    # migrations through DATABASE_ELEVATED_URL
pnpm db:down      # stop it
```

`pnpm setup:local` gives `DATABASE_URL` the RLS-bound `werf_app` login and keeps the owner URL in
`DATABASE_ELEVATED_URL`. Production is self-hosted Postgres+PostGIS on AWS af-south-1 (ADR-0002);
both credentials live in the deployment secret store, never in the repo.

## Migrations

```bash
pnpm db:generate  # drizzle-kit diffs the schema -> migrations/NNNN_*.sql (a DRAFT)
```

- Generated SQL is a **draft**: review it, then hand-add what drizzle can't infer
  (extensions, the `uuid_generate_v7()` SQL function, RLS) before it is applied.
- **Never edit an applied migration** — write a new one. Additive-only: a farmer offline
  for six weeks syncs writes composed against a schema two releases old.
- UUIDv7 is a **SQL function**, not a C extension, so dev, testcontainers, and production
  behave identically. Client rows supply their own id; the default only serves the server.

## Tenancy

RLS (`0001_rls.sql`) and the PowerSync sync rules (`@werf/sync`) are derived from one
`TENANCY` registry so they cannot disagree — a permissive sync rule leaks across farms
even when RLS is perfect. The app connects as the non-superuser `werf_app` role and sets
`app.user_id` per transaction; provisioning (register a business, create the first farm)
uses an elevated path that bypasses RLS on purpose.

## Seed data plan (`pnpm db:seed`)

The seed is bound by these rules:

- **Synthetic only, and obviously fake.** No real person, farm, animal, or transaction.
  Names are recognisably invented ("Rietfontein", "Test Farmer"); addresses are fictional.
- **Invalid SA ID checksums on purpose.** Every employee/worker ID number in the seed
  fails the Luhn check-digit, so a seed row can never be mistaken for — or misused as — a
  real South African identity. POPIA does not apply to data that identifies nobody.
- **No real banking details, no real tax numbers.** Placeholder account numbers only.
- **Three farms, covering the enterprise matrix:** one livestock, one crop, one mixed — so
  the enterprise-adaptive home grid (FR-002) can be exercised end to end.
- **Deterministic.** Client-generated UUIDv7s are seeded from a fixed sequence so tests
  and screenshots are reproducible.

The seed never runs in CI against a shared database and is never a data source for
anything a farmer or auditor sees.
