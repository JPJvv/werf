/**
 * The farm's calendar day.
 *
 * Timestamps are stored UTC and displayed in the farm's zone (CLAUDE.md). Everywhere the app turns
 * an INSTANT into a DAY — a date of birth, an age at weaning, a last-seen date — it has to use the
 * farm's zone, not the browser's and not UTC. `toISOString().slice(0, 10)` is the tempting one-liner
 * and it is wrong for two hours out of every twenty-four in South Africa: a calf born at 01:00 SAST
 * would be recorded as born the previous day, and its weaning age would be a day out forever.
 *
 * Jurisdiction comes from the FARM, never the browser (.claude/rules/domain.md). v1 is ZA-only —
 * `farms.jurisdiction` carries a CHECK constraint that permits nothing else (FR-018) — so there is
 * one entry here, and an unknown jurisdiction THROWS rather than silently falling back to the
 * browser's zone, which would be the same class of quiet wrongness this module exists to prevent.
 */

/** The IANA zone a jurisdiction keeps farm time in. Mirrors the server's own table. */
const JURISDICTION_TIMEZONE: Readonly<Record<string, string>> = { ZA: 'Africa/Johannesburg' };

/** v1 is ZA-only, enforced by a database CHECK. */
const DEFAULT_JURISDICTION = 'ZA';

/** The farm-local calendar day (YYYY-MM-DD) an instant falls on. `en-CA` renders ISO order. */
export function farmDay(instant: Date, jurisdiction: string = DEFAULT_JURISDICTION): string {
  const timeZone = JURISDICTION_TIMEZONE[jurisdiction];
  if (!timeZone) throw new Error(`No timezone configured for jurisdiction ${jurisdiction}`);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** Today, on the farm. */
export function farmToday(jurisdiction: string = DEFAULT_JURISDICTION): string {
  return farmDay(new Date(), jurisdiction);
}
