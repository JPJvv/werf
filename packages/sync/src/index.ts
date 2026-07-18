/**
 * The thin abstraction over the sync engine. Application code reads and writes through
 * this adapter and MUST NOT import the PowerSync SDK directly — the ADR-0003 exit depends
 * on app code not knowing PowerSync exists.
 *
 * Phase 0 defines only the classification vocabulary. Sync rules, RLS agreement, and the
 * tenancy suite (test/tenancy.spec.ts) fill in during Phase 3 as tables arrive.
 */

/**
 * How a table is treated by sync. `server-only` tables (payroll_runs, payslips,
 * financial_transactions, injury_records, audit_log) must NEVER reach a device — a
 * stolen phone must not contain 40 workers' payslips.
 */
export type SyncClassification = 'farm-scoped' | 'reference' | 'server-only';

/** The set of tables classified for sync. Empty in Phase 0; adding a table without
 * classifying it will break the tenancy suite on purpose (see .claude/rules/db.md). */
export const SYNC_CLASSIFICATIONS: Readonly<Record<string, SyncClassification>> = {};
