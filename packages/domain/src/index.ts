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

export * from './rates/rate-lookup';
export * from './livestock/status';
export * from './livestock/lifecycle';
export * from './livestock/weights';
export * from './livestock/movement';
export * from './livestock/batch';
export * from './livestock/breeding';
export * from './livestock/health';
export * from './livestock/branding';
export * from './livestock/evidence';
export * from './livestock/herd-summary';
export * from './livestock/classes';
export * from './livestock/mob-tally';
export * from './livestock/attributes';
export * from './land/boundary';
export * from './land/ancestry';
export * from './crops/planting';
export * from './crops/fertiliser';
export * from './crops/spray';
export * from './crops/harvest';
export * from './crops/phi-guard';
export * from './rainfall';
export * from './herd-scope';
export * from './dates';
