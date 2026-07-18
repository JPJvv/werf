/**
 * Pure business logic: payroll, compliance, sync conflict resolution. NO I/O — no
 * database, no HTTP, no clock (the date is injected). That is what makes these rules
 * testable as pure functions against table-driven, gazette-sourced fixtures.
 *
 * Phase 0 holds only the jurisdiction seam. Regulated rules (BCEA/SD13/NMW/UIF, PHI,
 * stock-theft) live ONLY under jurisdictions/za/ and arrive with their phases — never
 * hardcoded, always looked up by the date an event OCCURRED. See .claude/rules/domain.md.
 */

import type { Jurisdiction } from '@werf/core';

/** Jurisdictions with a rules implementation. One: ZA. No stubbed second country (ADR-0006). */
export const IMPLEMENTED_JURISDICTIONS: readonly Jurisdiction[] = ['ZA'];
