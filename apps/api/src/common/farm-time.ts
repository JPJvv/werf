/**
 * The farm's calendar day, server-side.
 *
 * Timestamps are stored UTC; every regulated question is asked in the FARM's day (CLAUDE.md).
 * `new Date().toISOString().slice(0, 10)` is the tempting one-liner and it is wrong for two hours
 * out of every twenty-four in South Africa — between 00:00 and 02:00 SAST it names yesterday. On a
 * withdrawal clear date or a registration lookup that is not a rounding error, it is the wrong
 * regulated answer.
 *
 * Jurisdiction comes from the FARM, never the user, the request or the server's own clock
 * (.claude/rules/domain.md). An unknown jurisdiction THROWS rather than falling back to UTC: a
 * silent default here is exactly the quiet compliance hole this module exists to prevent.
 *
 * Mirrors `apps/web/src/farmTime.ts`. The two are deliberately separate — the client cannot import
 * server code — and must be changed together when a second jurisdiction arrives.
 */

import { ValidationError } from '@werf/core';

/** The IANA timezone a jurisdiction keeps farm time in. v1 is ZA-only, so this is the one entry. */
const JURISDICTION_TIMEZONE: Readonly<Record<string, string>> = { ZA: 'Africa/Johannesburg' };

/** The farm-local calendar day (YYYY-MM-DD) an instant falls on. `en-CA` renders ISO order. */
export function farmLocalDay(instant: Date, jurisdiction: string): string {
  const timeZone = JURISDICTION_TIMEZONE[jurisdiction];
  if (!timeZone) {
    throw new ValidationError(`No timezone configured for jurisdiction ${jurisdiction}`);
  }
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** Today, on the farm. */
export function farmToday(jurisdiction: string): string {
  return farmLocalDay(new Date(), jurisdiction);
}
