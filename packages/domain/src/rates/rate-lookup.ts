/**
 * The regulated-rate lookup seam (FR-019, ADR-0005). This is the ONLY sanctioned way to
 * obtain a minimum wage, threshold, cap, multiplier, or withdrawal period — a literal in
 * code is a defect even when it is today's correct value.
 *
 * Two invariants this seam exists to enforce:
 *   1. Look up by the date the event OCCURRED, never `new Date()`. Recalculating a February
 *      shift at March's wage is a legal problem, not a rounding one.
 *   2. Jurisdiction comes from THE FARM. A Free State farm is governed by SA law wherever
 *      its owner logs in from. The caller passes `farm.jurisdiction`; this seam never guesses.
 *
 * Pure: no I/O, no clock. The rate rows are provided (loaded from `regulatory_rates` /
 * reference sync by the caller) and the date is injected. A missing rate THROWS — never a
 * silent fallback to the newest rate, which would underpay a farm for a year.
 */

import type { Jurisdiction } from '@werf/core';
import { MissingRateError } from '@werf/core';

/**
 * A regulated-rate row. `value` is a decimal STRING — Postgres numeric(14,4) — never a JS
 * float: it may be a rand-per-hour rate, a factor (1.5), or a fraction (0.10), and the
 * jurisdiction's rules parse it per `unit`. Dates are calendar dates (`YYYY-MM-DD`), not
 * instants: a rate boundary is a day, and the day is the farm-local one.
 */
export interface RegulatedRate {
  readonly jurisdiction: Jurisdiction;
  readonly code: string;
  readonly value: string;
  readonly unit: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly gazetteReference: string;
}

/** The seam. `code` is opaque here; the ZA gazette code names live only in @werf/domain/za. */
export interface RateLookup {
  lookup(jurisdiction: Jurisdiction, code: string, occurredAt: Date): RegulatedRate;
}

/**
 * The farm-local calendar date of an instant. Rate boundaries (e.g. 1 March) fall on a
 * local day; South Africa is a fixed UTC+2 with no DST, but we resolve through the tz name
 * so the rule stays correct if that ever changes. `en-CA` yields `YYYY-MM-DD`.
 */
function localCalendarDate(occurredAt: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(occurredAt);
  const part = (type: string): string => {
    const found = parts.find((p) => p.type === type);
    if (!found) throw new RangeError(`Intl produced no ${type} part for ${timeZone}`);
    return found.value;
  };
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/**
 * Build a lookup over an in-memory set of rate rows. `timeZone` is the farm's timezone
 * (default Africa/Johannesburg, correct for every ZA farm in v1) and decides which calendar
 * day an instant falls on when it straddles midnight.
 *
 * A rate is in force on day D when `effectiveFrom <= D` and (`effectiveTo` is null, i.e.
 * still in force, or `D <= effectiveTo`, inclusive). ISO date strings sort chronologically,
 * so the comparison is a string compare. When (defensively) more than one row matches, the
 * one with the latest `effectiveFrom` wins.
 */
export function createRateLookup(
  rates: readonly RegulatedRate[],
  timeZone = 'Africa/Johannesburg',
): RateLookup {
  return {
    lookup(jurisdiction, code, occurredAt) {
      const day = localCalendarDate(occurredAt, timeZone);
      let best: RegulatedRate | undefined;
      for (const rate of rates) {
        if (rate.jurisdiction !== jurisdiction || rate.code !== code) continue;
        if (rate.effectiveFrom > day) continue;
        if (rate.effectiveTo !== null && day > rate.effectiveTo) continue;
        if (!best || rate.effectiveFrom > best.effectiveFrom) best = rate;
      }
      if (!best) throw new MissingRateError(jurisdiction, code, occurredAt);
      return best;
    },
  };
}
