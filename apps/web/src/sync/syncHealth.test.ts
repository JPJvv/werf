/**
 * `deriveSyncHealth` as a pure fold (phase-checklists.md 3h) — no React, no provider tree, no
 * fake local database. `Outbox.test.tsx` already proves `queue`/`blocked`/`waiting` themselves are
 * correct; this only has to prove the fold over them is, and that the result carries nothing a
 * support/diagnostics consumer must never see.
 */

import { describe, expect, it } from 'vitest';
import { deriveSyncHealth, type SyncHealth, type SyncHealthQueueItem } from './syncHealth';

const FARM_ID = '0190f3a0-0000-7000-8000-0000000000f1';

const queueOf = (
  ...items: readonly [string, SyncHealthQueueItem['kind']][]
): SyncHealthQueueItem[] => items.map(([id, kind]) => ({ id, kind }));

describe('deriveSyncHealth (3h)', () => {
  it('reports zero counts and an empty breakdown for an empty queue', () => {
    const health = deriveSyncHealth(FARM_ID, [], new Set(), new Set());
    expect(health).toEqual<SyncHealth>({
      farmId: FARM_ID,
      pendingCount: 0,
      blockedCount: 0,
      waitingCount: 0,
      byKind: [],
    });
  });

  it('counts pending/blocked/waiting per kind, and totals match the input sets exactly', () => {
    const queue = queueOf(
      ['mob-1', 'mob'],
      ['mob-2', 'mob'],
      ['tally-1', 'tally'],
      ['tally-2', 'tally'],
      ['tally-3', 'tally'],
      ['animal-1', 'animal'],
    );
    const blocked = new Set(['tally-1']); // the server refused this one on its merits
    const waiting = new Set(['tally-2']); // held behind the refusal above

    const health = deriveSyncHealth(FARM_ID, queue, blocked, waiting);

    expect(health.pendingCount).toBe(6);
    expect(health.blockedCount).toBe(1);
    expect(health.waitingCount).toBe(1);
    expect(health.byKind).toEqual<SyncHealth['byKind']>([
      { kind: 'animal', pending: 1, blocked: 0, waiting: 0 },
      { kind: 'mob', pending: 2, blocked: 0, waiting: 0 },
      { kind: 'tally', pending: 3, blocked: 1, waiting: 1 },
    ]);
  });

  it('is farm-scoped by construction: two farms folded separately never share a count', () => {
    const farmA = deriveSyncHealth('farm-a', queueOf(['x', 'mob']), new Set(), new Set());
    const farmB = deriveSyncHealth(
      'farm-b',
      queueOf(['y', 'mob'], ['z', 'mob']),
      new Set(),
      new Set(),
    );

    expect(farmA.pendingCount).toBe(1);
    expect(farmB.pendingCount).toBe(2);
    expect(farmA.farmId).toBe('farm-a');
    expect(farmB.farmId).toBe('farm-b');
  });

  it('byKind is sorted by kind, so two reports of the same state diff cleanly', () => {
    const queue = queueOf(['a', 'weight'], ['b', 'animal'], ['c', 'tally']);
    const health = deriveSyncHealth(FARM_ID, queue, new Set(), new Set());
    expect(health.byKind.map((entry) => entry.kind)).toEqual(['animal', 'tally', 'weight']);
  });

  // ⭐ The property 3h actually asks for: this surface CANNOT carry PII, because the shape has
  // structurally nowhere to put it — not because a filter happened to strip it this time.
  it('⭐ carries no free-text field anywhere in the result — only counts, a farm id and a closed kind', () => {
    const queue = queueOf(['a', 'tally'], ['b', 'mob']);
    const health = deriveSyncHealth(FARM_ID, queue, new Set(['a']), new Set());

    expect(Object.keys(health).sort()).toEqual(
      ['farmId', 'pendingCount', 'blockedCount', 'waitingCount', 'byKind'].sort(),
    );
    for (const entry of health.byKind) {
      expect(Object.keys(entry).sort()).toEqual(['kind', 'pending', 'blocked', 'waiting'].sort());
      // Every value is a number except the closed `kind` enum — nowhere for a tag number, an
      // animal label, or any other farm fact to ride along.
      expect(typeof entry.kind).toBe('string');
      expect(typeof entry.pending).toBe('number');
      expect(typeof entry.blocked).toBe('number');
      expect(typeof entry.waiting).toBe('number');
    }
  });

  it('an id present in neither set counts as pending only — the ordinary case', () => {
    const health = deriveSyncHealth(FARM_ID, queueOf(['a', 'rainfall']), new Set(), new Set());
    expect(health.byKind).toEqual([{ kind: 'rainfall', pending: 1, blocked: 0, waiting: 0 }]);
  });
});
