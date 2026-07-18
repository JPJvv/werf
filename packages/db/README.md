# @werf/db

Drizzle schema, migrations, and RLS policies. **Empty in Phase 0** — no domain tables
exist yet. See `docs/03-architecture/database-schema.md` and `.claude/rules/db.md`.

## Seed data plan (`pnpm db:seed`)

The seed is a Phase 1+ task. When it lands it is bound by these rules:

- **Synthetic only, and obviously fake.** No real person, farm, animal, or transaction.
  Names are recognisably invented (e.g. "Rietfontein", "Test Farmer"); addresses are
  fictional.
- **Invalid SA ID checksums on purpose.** Every employee/worker ID number in the seed
  fails the Luhrmann check-digit, so a seed row can never be mistaken for — or misused as
  — a real South African identity. POPIA does not apply to data that identifies nobody,
  and we keep it that way by construction.
- **No real banking details, no real tax numbers.** Placeholder account numbers only.
- **Three farms, covering the enterprise matrix:** one livestock, one crop, one mixed —
  so the enterprise-adaptive home grid (FR-002) can be exercised end to end.
- **Deterministic.** Client-generated UUIDv7s are seeded from a fixed sequence so tests
  and screenshots are reproducible.

The seed never runs in CI against a shared database and is never a data source for
anything a farmer or auditor sees.
