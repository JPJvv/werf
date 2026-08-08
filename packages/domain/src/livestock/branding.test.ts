/**
 * Animal identification compliance (FR-602), tested as a pure function on observable output: does
 * the unmarked-past-window flag raise only for an unmarked animal past an INJECTED prescribed
 * window measured from acquisition, and stay silent for a marked animal, one with no acquisition
 * date, or one still inside the window? No statutory period is hardcoded in the test.
 */

import { describe, expect, it } from 'vitest';
import { ValidationError } from '@werf/core';
import { isUnmarkedPastWindow, type UnmarkedCheck } from './branding';

function check(overrides: Partial<UnmarkedCheck> = {}): UnmarkedCheck {
  return {
    acquiredOn: '2026-06-01',
    marked: false,
    windowDays: 30, // injected reference data — not the statute typed in
    asOf: '2026-07-15',
    ...overrides,
  };
}

describe('isUnmarkedPastWindow (FR-602)', () => {
  it('flags an unmarked animal once past the window (asOf strictly after the deadline)', () => {
    // acquired 2026-06-01 + 30 days = 2026-07-01 deadline.
    expect(isUnmarkedPastWindow(check({ asOf: '2026-07-02' }))).toBe(true);
    expect(isUnmarkedPastWindow(check({ asOf: '2026-07-01' }))).toBe(false); // on the deadline, not past
    expect(isUnmarkedPastWindow(check({ asOf: '2026-06-15' }))).toBe(false); // still inside the window
  });

  it('never flags a marked animal', () => {
    expect(isUnmarkedPastWindow(check({ marked: true, asOf: '2027-01-01' }))).toBe(false);
  });

  it('does not flag an animal with no acquisition date — absence is not a breach', () => {
    expect(isUnmarkedPastWindow(check({ acquiredOn: null, asOf: '2030-01-01' }))).toBe(false);
  });

  it('rejects a negative window', () => {
    expect(() => isUnmarkedPastWindow(check({ windowDays: -1 }))).toThrow(ValidationError);
  });
});
