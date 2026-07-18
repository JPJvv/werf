---
paths: ["packages/db/**", "packages/sync/**"]
---
# Database and sync rules

READ docs/03-architecture/database-schema.md and docs/03-architecture/offline-sync.md.

## Every table

- UUIDv7 primary key, CLIENT-generated. The client is offline; it cannot ask a
  sequence for an ID. v7 not v4 — time-ordered, so index locality survives.
- farm_id on every domain table. A table without it cannot be secured.
- Soft delete only (deleted_at). A hard DELETE breaks replication AND destroys
  records the BCEA requires us to keep.
- created_at, updated_at, created_by, updated_by.
- occurred_at on anything that happened. This is the most important column in
  the database. Reports use occurred_at. Sync uses updated_at. Confusing them
  puts a March calving in the April report.
- Money is numeric(14,2). Timestamps are timestamptz, stored UTC.
- Geometry is dual-written: geometry(...,4326) for PostGIS + geojson text for
  the client. SQLite has no PostGIS. Both, always, via the sync_geojson trigger.
- RLS + FORCE ROW LEVEL SECURITY. Without FORCE, the table owner bypasses RLS —
  and the app role is often the owner in a small deployment.
- jurisdiction char(2) on ANYTHING REGULATED: regulatory_rates, chemical_products,
  veterinary_products, branding_registers, farms. Always 'ZA' in v1.
  One line today; a migration across 10k partitioned farms in year three. ADR-0006.
- users.totp_secret_encrypted and employees' ID/banking use the PII KEY, not the
  DB key, and NEVER sync to a device. user_passkeys stores public keys only —
  a breach of that table gives an attacker nothing, which is the point.

## Migrations

- NEVER edit an applied migration. Write a new one. (Enforced by a hook.)
- Additive-only. Add → backfill → switch reads → drop, two releases later.
  A farmer offline for six weeks will sync writes composed against a schema
  from two releases ago. "Roll back and nobody notices" is not available to us.
- Never rename in one step.
- Never tighten a constraint in the same release that starts enforcing it.
- Review generated SQL before committing. Drizzle's output is a draft.

## Sync

- Sync rules are NOT RLS. Two systems, one invariant, SILENT failure mode.
  A permissive sync rule leaks farm B's data onto farm A's phone even when
  every RLS policy is perfect, because replication bypasses the query path
  RLS protects. Change one, change both.
- packages/sync/test/tenancy.spec.ts must pass. It is generated from the
  classification table, so adding a table without classifying it breaks the build.
  That is intentional. Do not skip it. Do not weaken it.
- Server-only tables (payroll_runs, payslips, financial_transactions,
  injury_records, audit_log) must never appear in any sync rule. A stolen phone
  must not contain 40 workers' payslips.
- Conflict resolution: field-LWW by occurred_at; events append-only never merged;
  status is a state machine (dead > sold > culled > missing > alive);
  financial is server-authoritative.
- EVERY conflict resolution writes an audit row. No silent resolution, ever.
- The write queue is never discarded by the system. Only a human, explicitly.
  An expired refresh token HOLDS the queue — `if (tokenExpired) queue.clear()`
  is a plausible two-line mistake that destroys a farmer's month of work.
