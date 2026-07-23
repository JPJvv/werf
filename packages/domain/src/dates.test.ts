/**
 * Calendar-date arithmetic (dates.ts), tested directly for the cases its callers (withdrawal,
 * gestation, unmarked-window) rely on: month/leap boundaries, zero and negative offsets, and a
 * malformed input throwing rather than silently producing a wrong day.
 */

import { describe, expect, it } from 'vitest';
import { ValidationError } from '@werf/core';
import { addCalendarDays } from './dates';

describe('addCalendarDays', () => {
  it('adds across month and leap-year boundaries', () => {
    expect(addCalendarDays('2026-07-15', 28)).toBe('2026-08-12');
    expect(addCalendarDays('2024-02-20', 10)).toBe('2024-03-01'); // 2024 is a leap year
    expect(addCalendarDays('2025-02-20', 10)).toBe('2025-03-02'); // 2025 is not
    expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('handles a zero offset and a negative offset (walking a deadline backwards)', () => {
    expect(addCalendarDays('2026-07-15', 0)).toBe('2026-07-15');
    expect(addCalendarDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('throws on a malformed date or a fractional offset', () => {
    expect(() => addCalendarDays('2026-7-5', 1)).toThrow(ValidationError);
    expect(() => addCalendarDays('15 July', 1)).toThrow(ValidationError);
    expect(() => addCalendarDays('2026-07-15', 1.5)).toThrow(ValidationError);
  });
});
