/**
 * Walking a land unit's `parent_id` chain (FR-202, splitting) — the shared graph-walk both the
 * "current planting" projection (4a·3, extended here) and the future PHI guard (4d·4) fold over.
 *
 * A split (`land/split`, 4a·2) never closes the parent — "without losing history" is the FR's own
 * words — so a child's ground carries everything true of its parent up to the moment it became its
 * own unit: the same soil, and (per the 4a·3 module note) whatever was last planted there. This
 * function answers ONE question, structurally: which land units is X's ground made of, counting X
 * itself. It does NOT decide which of an ancestor's EVENTS still apply — that is a per-caller
 * decision with a per-caller temporal bound, and the two callers this exists for disagree about it:
 *
 *  - The planting projection (`apps/web/src/crops/LocalPlantings.tsx`) takes every ancestor
 *    planting, UNBOUNDED, because the total order `(occurred_at, id)` already makes a later event
 *    win — a fresh planting captured on the child after the split naturally supersedes an inherited
 *    one, so there is nothing an expiry could buy that the ordering does not already give for free.
 *  - The PHI guard (4d·4, not yet built) MUST bound an ancestor's spray to `occurred_at` strictly
 *    BEFORE the child's own `createdAt` — a spray filed against the parent AFTER the split is not a
 *    fact about a child that by then existed as its own capturable unit, and attributing it anyway
 *    would let a farmer file a spray against "the old block" to dodge a guard the child's own
 *    history would otherwise trigger.
 *
 * Pure (.claude/rules/domain.md): no I/O. Takes the farm's land units as an in-memory list — both
 * the client (from `useEffectiveLandUnits`) and a future server read already hold this shape.
 */

/** The minimum a land unit needs to be walked: its own id and what it was split from, if anything. */
export interface LandUnitAncestryRow {
  readonly id: string;
  readonly parentId: string | null;
}

/**
 * `landUnitId` and every ancestor reached by following `parentId` to the root, closest first.
 *
 * Cycle-safe by construction (a `visited` set), even though a genuine cycle would be a data defect
 * — `parent_id` is a self-referencing FK with no cycle constraint at the database level, and a
 * defensive walk costs nothing here. A land unit whose id is not in `units` at all (deleted,
 * un-hydrated, or simply unknown to this device yet) returns just itself; an ancestor this device
 * has not synced down is silently absent from the chain rather than thrown on, because a stale or
 * partially-hydrated device must still answer SOMETHING for its own ground.
 */
export function ancestorChainOf(
  landUnitId: string,
  units: readonly LandUnitAncestryRow[],
): readonly string[] {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const chain: string[] = [];
  const visited = new Set<string>();

  let current: string | undefined = landUnitId;
  while (current !== undefined && !visited.has(current)) {
    visited.add(current);
    chain.push(current);
    current = byId.get(current)?.parentId ?? undefined;
  }
  return chain;
}
