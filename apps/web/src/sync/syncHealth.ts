/**
 * Sync health (phase-checklists.md 3h): per-farm queue depth and failure counts, for a future
 * support/diagnostics surface — never for a farmer's own screen, which already has the honest
 * words FR-009 asks for (`useSyncState`/`SyncStatusStrip`). This is the OTHER audience: someone
 * debugging a farm's sync from outside it, who must never be handed a tag number, an animal
 * label, or any other farm fact through this path.
 *
 * "Without PII" is enforced by the TYPE, not by a runtime filter that could miss a field someone
 * adds later: `SyncHealthByKind` has no string free-text slot at all, only a closed `CaptureKind`
 * enum and counts. `deriveSyncHealth` is a pure fold over the SAME `queue`/`blocked`/`waiting`
 * `Outbox.tsx` already computes and has already proven correct — this never re-reads a capture
 * store or a refusal's `detail`/`code`, so there is nothing free-text for it to leak.
 *
 * `SyncHealthKind` is `Outbox.tsx`'s own `CaptureKind`, imported as a TYPE ONLY (erased at
 * compile time, so this does not create a real circular import despite `Outbox.tsx` importing
 * FROM this file too) — a second, hand-written copy of that union is exactly the drift CLAUDE.md
 * warns about: a kind added to one and not the other would compile cleanly and silently stop
 * being reported here.
 */
import type { CaptureKind } from './Outbox';

export type SyncHealthKind = CaptureKind;

export interface SyncHealthByKind {
  readonly kind: SyncHealthKind;
  readonly pending: number;
  readonly blocked: number;
  readonly waiting: number;
}

export interface SyncHealth {
  readonly farmId: string;
  readonly pendingCount: number;
  readonly blockedCount: number;
  readonly waitingCount: number;
  /** Sorted by `kind` so a report taken twice in a row diffs cleanly. */
  readonly byKind: readonly SyncHealthByKind[];
}

/** The minimal shape this module needs from a queued item — not `FlushItem` itself, so this file
 *  never has to import `Outbox.tsx`'s send closures, guards or detail strings. */
export interface SyncHealthQueueItem {
  readonly id: string;
  readonly kind: SyncHealthKind;
}

/**
 * Folds the outbox's queue plus its blocked/waiting id sets into a per-kind health breakdown for
 * one farm. `farmId` is taken as a parameter rather than read from context, so this stays a pure
 * function callable from a plain unit test with no React, no provider tree, and no fake stores.
 */
export function deriveSyncHealth(
  farmId: string,
  queue: readonly SyncHealthQueueItem[],
  blockedIds: ReadonlySet<string>,
  waitingIds: ReadonlySet<string>,
): SyncHealth {
  const byKindMap = new Map<
    SyncHealthKind,
    { pending: number; blocked: number; waiting: number }
  >();
  for (const item of queue) {
    const entry = byKindMap.get(item.kind) ?? { pending: 0, blocked: 0, waiting: 0 };
    entry.pending += 1;
    if (blockedIds.has(item.id)) entry.blocked += 1;
    if (waitingIds.has(item.id)) entry.waiting += 1;
    byKindMap.set(item.kind, entry);
  }
  const byKind = [...byKindMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, counts]) => ({ kind, ...counts }));

  return {
    farmId,
    pendingCount: queue.length,
    blockedCount: blockedIds.size,
    waitingCount: waitingIds.size,
    byKind,
  };
}
