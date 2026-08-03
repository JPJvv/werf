/**
 * The herd projection — the read model that folds the append-only lifecycle log onto the herd to
 * derive each animal's CURRENT status. The herd store holds animals as first captured and is never
 * mutated; a death (or later a sale, cull, missing) is an event in `LocalLifecycle`, and here the
 * domain status state machine (`isMoreFinal`, dead > sold > culled > missing > alive) decides the
 * animal's effective status. This is the client twin of what Phase 3 sync does server-side: the
 * same order, consumed — never re-encoded — so the two cannot drift.
 *
 * `summariseHerd` (FR-705) counts only live head, so once this projection reports an animal 'dead'
 * it drops out of the home tile and the animals count — the first time those numbers can go DOWN.
 */

import { useMemo } from 'react';
import {
  calendarDaysBetween,
  isMoreFinal,
  projectHeadCount,
  summariseByClass,
  summariseHerd,
  type AnimalClass,
  type HerdSummary,
} from '@werf/domain';
import type { AnimalStatus } from '@werf/core';
import { useAnimals, type StoredAnimal } from './LocalHerd';
import { useLifecycleEvents, type StoredLifecycleEvent } from './LocalLifecycle';
import { useMobs, type StoredMob } from './LocalMobs';
import { useTallies, type StoredTally } from './LocalTallies';
import { useMoves, type StoredMove } from './LocalMoves';
import { useHealthEvents } from './LocalHealth';
import { useVetProducts } from './LocalVetProducts';
import { meatWithdrawalFor } from './withdrawal';
import { farmDay } from '../farmTime';

/** The most-final status each animal has been moved to by a lifecycle event, keyed by animal id. */
function mostFinalByAnimal(
  events: readonly StoredLifecycleEvent[],
): ReadonlyMap<string, AnimalStatus> {
  const map = new Map<string, AnimalStatus>();
  for (const e of events) {
    // A birth, weaning or purchase moves no status — it is a fact about an animal that stays
    // exactly as alive as it was. Only the events that carry one take part in the fold.
    if (e.status === null) continue;
    const current = map.get(e.animalId);
    if (current === undefined || isMoreFinal(e.status, current)) map.set(e.animalId, e.status);
  }
  return map;
}

/**
 * Where each animal is NOW, after every walk the device holds (FR-103).
 *
 * Status and position are folded by different rules, and the difference is the point. A status
 * moves through a state machine and only ever gets MORE final — a sold animal cannot become alive
 * again. A position is last-write-wins by `occurredAt`: an animal walked to Camp 4 and then to Camp
 * 7 is in Camp 7, and there is nothing "more final" about either camp. Using the status rule for
 * position would freeze an animal in whichever camp sorted highest.
 *
 * A destination that is ABSENT leaves that dimension where it was, which is why this folds forward
 * through the moves in time order rather than reading only the latest one: "walked to Camp 4", then
 * "taken out of its mob" must end with both applied.
 *
 * ⭐ The order is TOTAL — `(occurredAt, id)`, byte-compared, never `occurredAt` alone and never
 * `localeCompare`. Same rule as `projectHeadCount` and `mobMembership`, and for the same reason: a
 * capture screen asks for the DAY and stamps every move on that day with one instant, so ties are
 * ordinary BY CONSTRUCTION rather than rare. A sort with ties resolves to input order, which here is
 * the capture-store append order and on the server is whatever the query plan returned — so two
 * devices holding the same log could put the same animal in different camps. The id is a client
 * UUIDv7: identical on both sides, and time-ordered, so it also breaks the tie in capture order.
 * `localeCompare` is locale-sensitive by contract; it happens to agree for ISO timestamps and
 * lowercase hex, but "happens to agree" is not what an invariant is made of.
 */
function positionByAnimal(
  moves: readonly StoredMove[],
): ReadonlyMap<string, { landUnitId: string | null; mobId: string | null }> {
  const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  const ordered = [...moves].sort((a, b) => cmp(a.occurredAt, b.occurredAt) || cmp(a.id, b.id));
  const map = new Map<string, { landUnitId: string | null; mobId: string | null }>();
  for (const move of ordered) {
    const held = map.get(move.animalId);
    map.set(move.animalId, {
      landUnitId: move.toLandUnitId === undefined ? (held?.landUnitId ?? null) : move.toLandUnitId,
      mobId: move.toMobId === undefined ? (held?.mobId ?? null) : move.toMobId,
    });
  }
  return map;
}

/**
 * Fold the captured events onto the herd: the lifecycle log decides each animal's STATUS (state
 * machine, most-final wins) and the move log decides its POSITION (last write by `occurredAt`).
 * The herd store itself is never mutated — it holds animals as first captured.
 */
export function projectHerd(
  animals: readonly StoredAnimal[],
  events: readonly StoredLifecycleEvent[],
  moves: readonly StoredMove[] = [],
): readonly StoredAnimal[] {
  const byAnimal = mostFinalByAnimal(events);
  const positions = positionByAnimal(moves);
  return animals.map((a) => {
    const evStatus = byAnimal.get(a.id);
    const position = positions.get(a.id);
    const status = evStatus !== undefined && isMoreFinal(evStatus, a.status) ? evStatus : a.status;
    if (status === a.status && position === undefined) return a;
    return position === undefined
      ? { ...a, status }
      : { ...a, status, landUnitId: position.landUnitId, mobId: position.mobId };
  });
}

/**
 * The herd with each animal's current status applied — the basis for every live/loss read.
 *
 * `herdId` narrows it to ONE enterprise (FR-113): a mixed farm's cattle screen must not count its
 * sheep. Omit it for the whole farm, which is what the home tile wants. Animals with no enterprise
 * (captured before the farm's herds were known to the device) belong to no herd and so appear only
 * in the unfiltered view — hiding them would be worse than the alternative, which is why the farm
 * total never filters.
 */
export function useEffectiveAnimals(herdId?: string): readonly StoredAnimal[] {
  const animals = useAnimals();
  const events = useLifecycleEvents();
  const moves = useMoves();
  return useMemo(() => {
    const projected = projectHerd(animals, events, moves);
    return herdId === undefined ? projected : projected.filter((a) => a.enterpriseId === herdId);
  }, [animals, events, moves, herdId]);
}

/**
 * Fold the tally log onto the mobs (FR-102), so each one carries the head standing in it today.
 *
 * The third fold in this file, and it needs its own rule for the same reason status and position
 * needed theirs. A count is not a state machine and it is not last-write-wins: three ewes dying and
 * forty lambs being born are both true and both apply, so the deltas ACCUMULATE — which is also
 * what makes two phones capturing in a dead zone come out right instead of losing one another's
 * work. A recount is the one absolute in the log and resets the running total, because "I walked
 * the camp and counted 297" is a stronger fact than arithmetic on a number just shown to be wrong.
 *
 * ⭐ The fold starts from `initialHeadCount` — the count the mob was created with — and NOT from
 * `headCount`, which is the running total this function produces. Folding a log over its own output
 * counts every tally twice. That this file used to fold over `headCount` and still gave the right
 * answer was an accident of one fact: nothing writes back into the local mob register, so the count
 * it holds happens to still be the created one. The accident ends the moment `mobs` is hydrated from
 * the server, and it ends silently, on every counted mob at once — which is why this is a named
 * field now rather than a comment saying "do not write here".
 *
 * The server derives the same number from the same events with the same function, from the same
 * immutable baseline (`mobs.initial_head_count`, migration 0018) AND the same total order —
 * `(occurredAt, id)`, never `occurredAt` alone, because the capture screen gives every tally on a
 * day the same instant and a fold containing a recount does not commute. Ordering on the instant
 * alone left this at the mercy of the capture-store append order here and the query plan there,
 * which is how the same log could produce two different counts.
 */
export function projectMobs(
  mobs: readonly StoredMob[],
  tallies: readonly StoredTally[],
): readonly StoredMob[] {
  if (tallies.length === 0) return mobs;
  const byMob = new Map<string, StoredTally[]>();
  for (const tally of tallies) {
    const held = byMob.get(tally.mobId);
    if (held) held.push(tally);
    else byMob.set(tally.mobId, [tally]);
  }
  return mobs.map((mob) => {
    const applied = byMob.get(mob.id);
    if (applied === undefined) return mob;
    // ⭐ `undefined`, NOT `?? `. The two mean opposite things and only one of them is safe:
    //   • undefined — a mob written before the baseline was a field. Its `headCount` IS the created
    //     count, because nothing has ever written back into this register. Fall back to it.
    //   • null — an EXPLICIT "no baseline", which is what a hydrated row would carry. Folding the
    //     log over `headCount` there is exactly the double-count this field exists to prevent, and
    //     `projectHeadCount` already returns null for a null baseline, which is the honest answer.
    // A `??` cannot tell them apart, so it would reintroduce the defect as a fallback the moment
    // PowerSync hydrates `mobs` — silently, on every counted mob at once.
    const baseline = mob.initialHeadCount === undefined ? mob.headCount : mob.initialHeadCount;
    const headCount = projectHeadCount(baseline, applied);
    return headCount === mob.headCount ? mob : { ...mob, headCount };
  });
}

/**
 * The mobs counted in a summary (FR-102), narrowed to one herd the same way the animals are, and
 * each carrying its CURRENT head after every adjustment the device holds.
 *
 * A mob is head a farmer has, so it belongs in the total: leaving it out would make the home tile
 * say 0 on a farm running 300 sheep as a flock, which is the exact farm FR-102 exists for.
 */
export function useEffectiveMobs(herdId?: string): readonly StoredMob[] {
  const mobs = useMobs();
  const tallies = useTallies();
  return useMemo(() => {
    const projected = projectMobs(mobs, tallies);
    return herdId === undefined ? projected : projected.filter((m) => m.enterpriseId === herdId);
  }, [mobs, tallies, herdId]);
}

/** The herd summary (FR-705/017), for one herd or (unfiltered) the whole farm. */
export function useHerdSummary(herdId?: string): HerdSummary {
  const animals = useEffectiveAnimals(herdId);
  const mobs = useEffectiveMobs(herdId);
  return useMemo(() => summariseHerd({ animals, mobs }), [animals, mobs]);
}

/**
 * Live head by CLASS, per species (FR-705) — cows, heifers, weaners, and the ones with no recorded
 * birth date. This is the breakdown a farmer thinks in; a flat head count answers "how many" and
 * nothing else.
 *
 * Age is computed here rather than in the domain, because the domain may not read a clock — it
 * takes the age in days and the caller supplies it (.claude/rules/domain.md).
 */
export function useHerdClasses(
  herdId?: string,
): Readonly<Record<string, Readonly<Record<AnimalClass, number>>>> {
  const animals = useEffectiveAnimals(herdId);
  return useMemo(() => {
    const today = farmDay(new Date());
    return summariseByClass(
      animals
        .filter((a) => a.status === 'alive')
        .map((a) => ({
          species: a.species,
          sex: a.sex,
          ageDays: ageInDays(a.dob, today),
        })),
    );
  }, [animals]);
}

/**
 * Age in whole days, or undefined when there is no usable date of birth.
 *
 * Defensive on purpose, and not merely for tidiness. This reads rows the DEVICE persisted, possibly
 * composed by an earlier version of the app that did not write `dob` at all — an offline-first app
 * has to expect exactly that, because a farmer can be six weeks behind an update. A read model that
 * threw on one malformed row would take the whole Animals screen down, offline, with no way out;
 * 'no age recorded' is already a class this summary reports honestly, so an unreadable date lands
 * in the group that exists for it.
 */
function ageInDays(dob: unknown, today: string): number | undefined {
  if (typeof dob !== 'string') return undefined;
  try {
    return Math.max(0, calendarDaysBetween(dob, today));
  } catch {
    return undefined;
  }
}

/**
 * How many live animals are currently inside a meat withholding (FR-131).
 *
 * This is the number the Health tile carries, and it was chosen over the "N due" the design sketch
 * suggested for one reason: it is TRUE. A due/overdue count needs a vaccination programme schedule
 * that does not exist yet, and a tile carrying a number the app cannot actually compute is worse
 * than a tile carrying none — the whole point of FR-017 is that a tile is an instrument rather than
 * a menu item. "3 withholding" is a fact the device can derive today, and it is the one that stops
 * a farmer loading the wrong animal onto a truck.
 */
export function useWithholdingCount(herdId?: string): number {
  const animals = useEffectiveAnimals(herdId);
  // The RAW herd and the move log, because the guard reconstructs mob membership from them — a
  // projected animal carries where it is NOW, which is the value that reconstruction exists to
  // stop trusting. The projected list decides only WHICH animals are still alive.
  const raw = useAnimals();
  const moves = useMoves();
  const healthEvents = useHealthEvents();
  const products = useVetProducts();
  return useMemo(() => {
    const today = farmDay(new Date());
    const byId = new Map(raw.map((a) => [a.id, a]));
    return animals.filter((a) => {
      const stored = byId.get(a.id);
      return (
        a.status === 'alive' &&
        stored !== undefined &&
        meatWithdrawalFor(stored, today, healthEvents, products, moves).blocked
      );
    }).length;
  }, [animals, raw, moves, healthEvents, products]);
}
