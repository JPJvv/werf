/**
 * FR-151's remainder (4e·1, phase-checklists.md): grazing days / rest days per camp, the read
 * projection over the mob-move + individual-move logs the capture already built. Client-only,
 * derived, never stored — 4e·3's precedent (`stock.ts`'s own module note): no server consumer needs
 * this the way the FR-603 evidence pack needs `possessionTrail`, so there is nothing to hydrate.
 *
 * ⭐ Occupancy comes from `useEffectiveAnimals`/`useEffectiveMobs` — the SAME live/active filter the
 * herd summary already trusts (`herd-summary.ts`'s `byLandUnit`) — never from `foldCampActivity`
 * alone, which only knows what the move log says and has no idea an occupant died or was sold out
 * without ever being moved off the camp (`grazing.ts`'s own module note, `@werf/domain`).
 */

import { useMemo } from 'react';
import { calendarDaysBetween, foldCampActivity, type CampMoveEvent } from '@werf/domain';
import { useEffectiveAnimals, useEffectiveMobs } from './herd';
import { useMoves, type StoredMove } from './LocalMoves';
import { useMobMoves, type StoredMobMove } from './LocalMobMoves';
import {
  useHydratedMoves,
  useHydratedMobMoves,
  mergeByIdPreferHydrated,
} from './HydratedLivestock';
import { farmDay } from '../farmTime';

export type CampGrazingStatus =
  | { readonly kind: 'grazing'; readonly days: number }
  | { readonly kind: 'grazingUnknown' }
  | { readonly kind: 'resting'; readonly days: number }
  | { readonly kind: 'restUnknown' };

/** The fold's own minimal shapes — a `StoredAnimal`/`StoredMob` each satisfy these structurally. */
export interface GrazingAnimal {
  readonly id: string;
  readonly status: string;
  readonly landUnitId: string | null;
}
export interface GrazingMob {
  readonly id: string;
  readonly headCount: number | null;
  readonly landUnitId: string | null;
}

function toCampMoveEvents(
  moves: readonly StoredMove[],
  mobMoves: readonly StoredMobMove[],
): readonly CampMoveEvent[] {
  return [
    ...moves.map((m) => ({
      id: m.id,
      occurredAt: m.occurredAt,
      entityId: `animal:${m.animalId}`,
      toLandUnitId: m.toLandUnitId,
    })),
    ...mobMoves.map((m) => ({
      id: m.id,
      occurredAt: m.occurredAt,
      entityId: `mob:${m.mobId}`,
      toLandUnitId: m.toLandUnitId,
    })),
  ];
}

/** The earliest of a non-empty list of ISO instants, by plain `<` — see `foldCampActivity`'s own
 *  note on why this codebase never reaches for a bare `.sort()`/`localeCompare` on these. */
function earliest(instants: readonly string[]): string {
  return instants.reduce((min, v) => (v < min ? v : min));
}

/**
 * Grazing/rest status for every camp with live occupants OR a known departure — occupied
 * (`grazing`, days since the LONGEST-present current occupant arrived, i.e. the worst-case grazing
 * pressure) or empty (`resting`, days since it was last vacated). The `*Unknown` variants are the
 * honest "two absences are two facts" case `LandScreen.tsx`'s `BoundaryRow` already draws: a camp
 * can be occupied by an animal/mob placed there at creation and never moved (no arrival on record),
 * or empty with no departure ever captured (nothing has ever left it, as far as this log goes).
 *
 * Pure — `today` (a `YYYY-MM-DD` farm-local day) and the merged move logs are supplied by the
 * caller, mirroring `herd.ts`'s `projectHerd`/`positionByMob`. `moves`/`mobMoves` are assumed
 * ALREADY merged local+hydrated (`mergeByIdPreferHydrated`) — the hydrated echo carries a
 * server-resolved `toLandUnitId` a local capture never can, same reasoning as `useEffectiveAnimals`.
 */
export function campGrazingStatuses(
  animals: readonly GrazingAnimal[],
  mobs: readonly GrazingMob[],
  moves: readonly StoredMove[],
  mobMoves: readonly StoredMobMove[],
  today: string,
): ReadonlyMap<string, CampGrazingStatus> {
  const activity = foldCampActivity(toCampMoveEvents(moves, mobMoves));

  // Currently-occupied camps, and which of this fold's entity keys are standing in each — the
  // authoritative list, not `activity.entityArrivedAt`'s keys (see the module note).
  const occupants = new Map<string, string[]>();
  for (const a of animals) {
    if (a.status !== 'alive' || a.landUnitId === null) continue;
    const list = occupants.get(a.landUnitId) ?? [];
    list.push(`animal:${a.id}`);
    occupants.set(a.landUnitId, list);
  }
  for (const m of mobs) {
    if ((m.headCount ?? 0) <= 0 || m.landUnitId === null) continue;
    const list = occupants.get(m.landUnitId) ?? [];
    list.push(`mob:${m.id}`);
    occupants.set(m.landUnitId, list);
  }

  const result = new Map<string, CampGrazingStatus>();
  const landUnitIds = new Set([...occupants.keys(), ...activity.landUnitLastDeparture.keys()]);
  for (const landUnitId of landUnitIds) {
    const entityIds = occupants.get(landUnitId);
    if (entityIds && entityIds.length > 0) {
      const arrivals = entityIds
        .map((id) => activity.entityArrivedAt.get(id)?.arrivedAt)
        .filter((v): v is string => v !== undefined);
      if (arrivals.length === 0) {
        result.set(landUnitId, { kind: 'grazingUnknown' });
        continue;
      }
      const days = Math.max(0, calendarDaysBetween(farmDay(new Date(earliest(arrivals))), today));
      result.set(landUnitId, { kind: 'grazing', days });
      continue;
    }
    const departedAt = activity.landUnitLastDeparture.get(landUnitId);
    if (departedAt === undefined) {
      result.set(landUnitId, { kind: 'restUnknown' });
      continue;
    }
    const days = Math.max(0, calendarDaysBetween(farmDay(new Date(departedAt)), today));
    result.set(landUnitId, { kind: 'resting', days });
  }
  return result;
}

export function useCampGrazing(): ReadonlyMap<string, CampGrazingStatus> {
  const animals = useEffectiveAnimals();
  const mobs = useEffectiveMobs();
  const moves = useMoves();
  const hydratedMoves = useHydratedMoves();
  const mobMoves = useMobMoves();
  const hydratedMobMoves = useHydratedMobMoves();

  return useMemo(() => {
    const foldMoves = mergeByIdPreferHydrated(moves, hydratedMoves);
    const foldMobMoves = mergeByIdPreferHydrated(mobMoves, hydratedMobMoves);
    return campGrazingStatuses(animals, mobs, foldMoves, foldMobMoves, farmDay(new Date()));
  }, [animals, mobs, moves, hydratedMoves, mobMoves, hydratedMobMoves]);
}
