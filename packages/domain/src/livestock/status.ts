/**
 * The animal-status state machine (.claude/rules/db.md, database-schema.md § 4). Status is not a
 * free label: it is ordered by FINALITY — dead > sold > culled > missing > alive. Two places
 * depend on that order:
 *
 *   1. Conflict resolution (Phase 3): when two offline devices disagree on an animal's status,
 *      the MORE-FINAL one wins, so an offline "sold" never overwrites a later, more-final "dead".
 *   2. Capture (this phase): a lifecycle event may not move an animal to a LESS-final status —
 *      you cannot sell an animal that is already dead, nor wean one that has left the herd.
 *
 * Pure: no I/O, no clock (.claude/rules/domain.md). One order, used by both, so they cannot drift.
 */

import type { AnimalStatus } from '@werf/core';

/** Finality rank. Higher is more final. Order is dead > sold > culled > missing > alive (db.md). */
const STATUS_PRECEDENCE: Record<AnimalStatus, number> = {
  alive: 0,
  missing: 1,
  culled: 2,
  sold: 3,
  dead: 4,
};

/** The finality rank of a status — the number the state machine orders by. */
export function statusPrecedence(status: AnimalStatus): number {
  return STATUS_PRECEDENCE[status];
}

/** True when `a` is strictly more final than `b` (the conflict-resolution winner). */
export function isMoreFinal(a: AnimalStatus, b: AnimalStatus): boolean {
  return STATUS_PRECEDENCE[a] > STATUS_PRECEDENCE[b];
}

/** True when moving `from` → `to` does not step an animal BACKWARDS to a less-final status. */
export function canTransition(from: AnimalStatus, to: AnimalStatus): boolean {
  return STATUS_PRECEDENCE[to] >= STATUS_PRECEDENCE[from];
}
