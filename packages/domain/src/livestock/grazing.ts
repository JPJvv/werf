/**
 * The primitive FR-151's grazing-days/rest-days/stocking-rate projection folds (4e·1's remainder,
 * phase-checklists.md): where and since when each entity — an individual animal or a mob — is on
 * this device's move log, and when a camp was last vacated. Pure, no I/O, no clock: `today` never
 * appears here, only `occurredAt` strings from events the caller already holds. The caller turns an
 * `arrivedAt`/`departedAt` into a day count with `calendarDaysBetween`, after converting it through
 * the farm's zone (`farmDay` — apps/web only, per `dates.ts`'s own module note on why this package
 * never touches a timezone).
 *
 * ⭐ Occupancy is NOT decided here. This fold only knows what the move log says; it has no idea an
 * animal died three years after its last move, or a mob was later sold out from under it —
 * `summariseHerd` already excludes those (`byLandUnit`, `herd-summary.ts`). The caller cross-checks
 * `entityArrivedAt` against its OWN authoritative "who is alive/active now" list (`byLandUnit` again)
 * before trusting an arrival date as a camp's current occupancy — inverting that (trusting this fold
 * to say who is there) would report a camp "grazing 700 days" off an occupant that died there long
 * ago and was never moved out.
 *
 * ⭐ The order is TOTAL — `(occurredAt, id)`, the same reason every other fold in this codebase needs
 * it (`mob-tally.ts`'s `cmp`, `herd.ts`'s `positionByAnimal`): a capture screen stamps every move on
 * a day with one instant, so ties are the normal case, not the exception.
 *
 * ⭐ A move's `toLandUnitId` can be `undefined` — an individual move that only changed the animal's
 * MOB, not its camp (`recordMove`'s own omit-to-leave-unchanged convention; a mob move never omits
 * it — `recordMobMove` always resolves both sides). The camp only actually changes when the RESOLVED
 * destination differs from what THIS FOLD is already holding for that entity — never the event's own
 * `fromLandUnitId`, because a local capture's is whatever the device last knew, which can be stale
 * next to a co-worker's not-yet-synced move (`herd.ts`'s `positionByAnimal` carries the identical
 * caution, and `HydratedLivestock.tsx`'s `mergeByIdPreferHydrated` is why the caller merges hydrated
 * moves in ahead of calling this).
 */

/** The minimal shape this fold reads. A `StoredMove`/`StoredMobMove` each map onto it structurally —
 *  the caller prefixes `entityId` (`animal:<id>` / `mob:<id>`) so the two id spaces cannot collide. */
export interface CampMoveEvent {
  readonly id: string;
  readonly occurredAt: string;
  readonly entityId: string;
  /** Destination camp. `undefined` means "unchanged" — see the module note. */
  readonly toLandUnitId?: string | null | undefined;
}

export interface CampActivity {
  /** Where each entity's move log currently puts it, and when it last actually changed. Absent for
   *  an entity that has never had a move change its camp, or whose last change was to `null`. */
  readonly entityArrivedAt: ReadonlyMap<
    string,
    { readonly landUnitId: string; readonly arrivedAt: string }
  >;
  /** The most recent time ANY entity left a given camp — overwritten forward, so it always reflects
   *  the LATEST departure even across a reoccupy-then-vacate cycle. Absent for a camp nothing has
   *  ever left (no move log reaches it, or it has only ever been arrived at, never departed). */
  readonly landUnitLastDeparture: ReadonlyMap<string, string>;
}

/** Byte order, the same order Postgres gives a timestamptz or a uuid. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function foldCampActivity(moves: readonly CampMoveEvent[]): CampActivity {
  const ordered = [...moves].sort((a, b) => cmp(a.occurredAt, b.occurredAt) || cmp(a.id, b.id));
  const held = new Map<string, string | null>();
  const entityArrivedAt = new Map<string, { landUnitId: string; arrivedAt: string }>();
  const landUnitLastDeparture = new Map<string, string>();

  for (const move of ordered) {
    const previous = held.get(move.entityId) ?? null;
    const resolved = move.toLandUnitId === undefined ? previous : move.toLandUnitId;
    if (resolved === previous) continue; // no real change to the camp dimension

    if (previous !== null) landUnitLastDeparture.set(previous, move.occurredAt);
    held.set(move.entityId, resolved);
    if (resolved === null) entityArrivedAt.delete(move.entityId);
    else entityArrivedAt.set(move.entityId, { landUnitId: resolved, arrivedAt: move.occurredAt });
  }

  return { entityArrivedAt, landUnitLastDeparture };
}
