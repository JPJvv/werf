/**
 * Herd scoping (FR-113): no event enters the append-only log unfiled.
 *
 * A mixed farm runs cattle AND sheep AND pigs. An event that is not filed under the herd it concerns
 * is not just untidy, it is unusable: "dosed the herd on Tuesday" means nothing on a farm with three
 * of them, a season's treatment history cannot be produced per species, and the per-enterprise
 * numbers the home tiles show (FR-017) silently under-report. So every event must carry a herd, and
 * there are exactly three ways to do that (database-schema.md § 5, the FR-113 note):
 *
 *   • an `animalId` — the animal is in one herd, so the event is too;
 *   • a `mobId` — likewise for a group without individual rows;
 *   • an `enterpriseId` — for a herd-wide event with no single subject (dose the whole cattle herd).
 *
 * The one class of exception is an event about the FARM rather than a herd, listed in
 * FARM_SCOPED_EVENT_TYPES in @werf/core — rainfall and boundary_walk today (a camp is GROUND: the
 * same camp carries cattle this winter and sheep next, so filing its shape under one enterprise
 * would hide it from the other side of a mixed farm). It is a closed list on purpose: a new
 * event type is herd-scoped by default and has to be named there to escape this rule, so the next
 * capture cannot quietly arrive unfiled.
 *
 * Pure: this is a rule, not a lookup. It does not resolve WHICH herd an animal belongs to — that is
 * a read against the animal's row, and it belongs to the caller at the I/O boundary. This only
 * refuses an event that names no herd at all.
 */

import { isFarmScopedEventType, ValidationError, type schemas } from '@werf/core';

/** The parts of an event that decide whether it is filed under a herd. */
export interface HerdScopable {
  readonly type: schemas.NewEvent['type'];
  readonly animalId?: string | null;
  readonly mobId?: string | null;
  readonly enterpriseId?: string | null;
}

/** Whether this event names the herd it concerns (or is a farm-level fact that has none). */
export function isHerdScoped(event: HerdScopable): boolean {
  if (isFarmScopedEventType(event.type)) return true;
  return (
    (event.animalId ?? null) !== null ||
    (event.mobId ?? null) !== null ||
    (event.enterpriseId ?? null) !== null
  );
}

/**
 * Refuse an event that names no herd (FR-113). Thrown at the capture boundary, so an unfiled event
 * never reaches the log — a correction afterwards would mean guessing which herd a farmer meant,
 * months later, which is not a guess anyone should make on their behalf.
 */
export function assertHerdScoped(event: HerdScopable): void {
  if (!isHerdScoped(event)) {
    throw new ValidationError(
      `A ${event.type} event must be recorded against a herd — an animal, a mob, or the enterprise it concerns`,
    );
  }
}
