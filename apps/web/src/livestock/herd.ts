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
import { isMoreFinal, summariseHerd, type HerdSummary } from '@werf/domain';
import type { AnimalStatus } from '@werf/core';
import { useAnimals, type StoredAnimal } from './LocalHerd';
import { useLifecycleEvents, type StoredLifecycleEvent } from './LocalLifecycle';

/** The most-final status each animal has been moved to by a lifecycle event, keyed by animal id. */
function mostFinalByAnimal(
  events: readonly StoredLifecycleEvent[],
): ReadonlyMap<string, AnimalStatus> {
  const map = new Map<string, AnimalStatus>();
  for (const e of events) {
    const current = map.get(e.animalId);
    if (current === undefined || isMoreFinal(e.status, current)) map.set(e.animalId, e.status);
  }
  return map;
}

/** Fold the lifecycle events onto the animals, overriding status only where an event is more final. */
export function projectHerd(
  animals: readonly StoredAnimal[],
  events: readonly StoredLifecycleEvent[],
): readonly StoredAnimal[] {
  const byAnimal = mostFinalByAnimal(events);
  return animals.map((a) => {
    const evStatus = byAnimal.get(a.id);
    if (evStatus === undefined || !isMoreFinal(evStatus, a.status)) return a;
    return { ...a, status: evStatus };
  });
}

/** The herd with each animal's current status applied — the basis for every live/loss read. */
export function useEffectiveAnimals(): readonly StoredAnimal[] {
  const animals = useAnimals();
  const events = useLifecycleEvents();
  return useMemo(() => projectHerd(animals, events), [animals, events]);
}

/** The herd summary (FR-705/017) over the current herd — the source of the home tile's live count. */
export function useHerdSummary(): HerdSummary {
  const animals = useEffectiveAnimals();
  return useMemo(() => summariseHerd({ animals }), [animals]);
}
