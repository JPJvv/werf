import { describe, expect, it } from 'vitest';
import { MissingRateError } from '@werf/core';
import { createRateLookup, type RegulatedRate } from './rate-lookup';

/**
 * These tests exercise the SEAM (date/jurisdiction selection), not any regulated value —
 * the codes and figures below are synthetic on purpose so the test asserts the mechanism,
 * never a gazette number. The real ZA rate tables and their sourced expectations arrive
 * with payroll in Phase 5. Invariant under test: FR-019 / .claude/rules/domain.md — look up
 * by the date it OCCURRED, jurisdiction from the farm, a miss THROWS.
 */

// A synthetic rate that changes on 1 March (as SA farm wages do every year), plus one
// open-ended factor with no end date.
const rates: readonly RegulatedRate[] = [
  {
    jurisdiction: 'ZA',
    code: 'SEAM_HOURLY',
    value: '10.0000',
    unit: 'UNIT_PER_HOUR',
    effectiveFrom: '2025-03-01',
    effectiveTo: '2026-02-28',
    gazetteReference: 'SYNTHETIC-2025',
  },
  {
    jurisdiction: 'ZA',
    code: 'SEAM_HOURLY',
    value: '11.0000',
    unit: 'UNIT_PER_HOUR',
    effectiveFrom: '2026-03-01',
    effectiveTo: null,
    gazetteReference: 'SYNTHETIC-2026',
  },
  {
    jurisdiction: 'ZA',
    code: 'SEAM_FACTOR',
    value: '1.5000',
    unit: 'FACTOR',
    effectiveFrom: '2000-01-01',
    effectiveTo: null,
    gazetteReference: 'SYNTHETIC-FACTOR',
  },
];

describe('createRateLookup', () => {
  const lookup = createRateLookup(rates);

  it('returns the rate in force on the occurred date (mid-range)', () => {
    const r = lookup.lookup('ZA', 'SEAM_HOURLY', new Date('2025-06-15T09:00:00Z'));
    expect(r.value).toBe('10.0000');
    expect(r.gazetteReference).toBe('SYNTHETIC-2025');
  });

  it('treats a null effectiveTo as still in force, far into the future', () => {
    const r = lookup.lookup('ZA', 'SEAM_FACTOR', new Date('2030-12-31T00:00:00Z'));
    expect(r.value).toBe('1.5000');
  });

  it('picks the correct rate across the 1-March boundary in the FARM-LOCAL day', () => {
    // 2026-02-28T21:00Z is 23:00 SAST on the 28th -> old rate.
    expect(lookup.lookup('ZA', 'SEAM_HOURLY', new Date('2026-02-28T21:00:00Z')).value).toBe(
      '10.0000',
    );
    // 2026-02-28T22:00Z is 00:00 SAST on 1 March -> new rate. The instant is in February
    // UTC but the farm is already in March, and the farm's day is what the law uses.
    expect(lookup.lookup('ZA', 'SEAM_HOURLY', new Date('2026-02-28T22:00:00Z')).value).toBe(
      '11.0000',
    );
  });

  it('resolves the day in the given timezone, not UTC', () => {
    const utcLookup = createRateLookup(rates, 'UTC');
    // Same instant that was already 1 March in SAST is still 28 Feb in UTC -> old rate.
    expect(utcLookup.lookup('ZA', 'SEAM_HOURLY', new Date('2026-02-28T22:00:00Z')).value).toBe(
      '10.0000',
    );
  });

  it('THROWS MissingRateError before any rate takes effect — never falls back', () => {
    try {
      lookup.lookup('ZA', 'SEAM_HOURLY', new Date('2020-01-01T09:00:00Z'));
      expect.unreachable('a missing rate must throw');
    } catch (err) {
      expect(err).toBeInstanceOf(MissingRateError);
      expect((err as MissingRateError).rateCode).toBe('SEAM_HOURLY');
      expect((err as MissingRateError).jurisdiction).toBe('ZA');
    }
  });

  it('THROWS for an unknown code rather than returning a neighbour', () => {
    expect(() => lookup.lookup('ZA', 'NOT_A_CODE', new Date('2025-06-15T09:00:00Z'))).toThrow(
      MissingRateError,
    );
  });
});
