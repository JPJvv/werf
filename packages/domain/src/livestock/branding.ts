/**
 * Animal identification compliance (FR-602, legal-compliance.md § 3.1). An animal acquired must be
 * marked within a prescribed period; one still unmarked past that window raises a compliance flag.
 *
 * Pure (.claude/rules/domain.md): no I/O, no clock. The prescribed window is INJECTED reference
 * data resolved by date — the Animal Identification Act's period is not a number to hardcode here —
 * and `asOf` (the date the check is run for) is injected too, never `new Date()`.
 */

import { ValidationError } from '@werf/core';
import { addCalendarDays } from '../dates';

export interface UnmarkedCheck {
  /** When the animal was acquired (YYYY-MM-DD). No acquisition date → nothing to measure against. */
  readonly acquiredOn: string | null;
  /** True when the animal already carries a registered mark (has a brand_id / brand_applied_at). */
  readonly marked: boolean;
  /** The prescribed marking window in days, injected reference data resolved by date. */
  readonly windowDays: number;
  /** The date the check is run for (injected — never the wall clock). */
  readonly asOf: string;
}

/**
 * True when an animal is unmarked AND past its prescribed marking window — the compliance flag.
 * A marked animal is never flagged; an animal with no acquisition date cannot be measured, so it is
 * not flagged (absence of a date is not evidence of a breach). The deadline is
 * `acquiredOn + windowDays`; the flag raises strictly AFTER it (`asOf > deadline`).
 */
export function isUnmarkedPastWindow(check: UnmarkedCheck): boolean {
  if (check.marked) return false;
  if (check.acquiredOn === null) return false;
  if (!Number.isInteger(check.windowDays) || check.windowDays < 0) {
    throw new ValidationError('A marking window must be a non-negative whole number of days');
  }
  const deadline = addCalendarDays(check.acquiredOn, check.windowDays);
  return check.asOf > deadline;
}
