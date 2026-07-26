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

/**
 * A stored instant as a farm-local day and time, for the handful of places that show WHEN something
 * happened rather than on which day — "this passkey was last used at". Same zone rule as everything
 * else here, and it takes the ISO string the wire actually delivers as readily as a Date, because a
 * JSON response has no Dates in it however the schema types the field.
 *
 * An unparseable value returns null rather than "Invalid Date": a row written by an older client is
 * a thing this product has to expect, and a read model that renders garbage into a security screen
 * is worse than one that renders nothing.
 */
export function farmDateTime(
  instant: Date | string,
  jurisdiction: string = DEFAULT_JURISDICTION,
): string | null {
  const timeZone = JURISDICTION_TIMEZONE[jurisdiction];
  if (!timeZone) throw new Error(`No timezone configured for jurisdiction ${jurisdiction}`);
  const at = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(at.getTime())) return null;
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
}
