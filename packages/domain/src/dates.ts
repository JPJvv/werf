/**
 * Calendar-date arithmetic on `YYYY-MM-DD` strings. A due date, a withdrawal clear date, an
 * unmarked-window deadline — these are DAYS on the farm, not instants, so they never touch a
 * timezone (coercing a calendar date to a Date lands it at midnight in some zone: the classic
 * off-by-one). Pure: no I/O, no clock. The base date and the offset are both supplied.
 */

import { ValidationError } from '@werf/core';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/**
 * Add a whole number of days to a `YYYY-MM-DD` date and return a `YYYY-MM-DD` date. Computed in
 * UTC purely as arithmetic (both ends are the same fictional zone, so it cancels) — leap years and
 * month lengths are honoured. `days` may be zero or negative.
 */
export function addCalendarDays(date: string, days: number): string {
  const match = DATE_RE.exec(date);
  if (!match) {
    throw new ValidationError('Expected a YYYY-MM-DD calendar date');
  }
  if (!Number.isInteger(days)) {
    throw new ValidationError('Days to add must be a whole number');
  }
  const [, y, m, d] = match;
  const result = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)) + days * MS_PER_DAY);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${result.getUTCFullYear()}-${pad(result.getUTCMonth() + 1)}-${pad(result.getUTCDate())}`;
}
