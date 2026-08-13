/**
 * `mergeById` — the pure function `Outbox.tsx`'s `needsHead` and `herd.ts`'s `useEffectiveMobs`
 * both use to combine a device's own captures with what down-sync has hydrated. Tested in
 * isolation because it is the one piece of the tripwire-3e fix with no React, no fake database,
 * and no farm scoping to thread through — the property it has to hold (test 7 of the required
 * matrix: a pending local capture and its own hydrated copy never double-count) is a fact about
 * this function alone.
 */

import { describe, expect, it } from 'vitest';
import { mergeById, mergeByIdPreferHydrated } from './HydratedLivestock';

interface Row {
  readonly id: string;
  readonly tag: string;
}

describe('mergeById', () => {
  it('returns the local array untouched when nothing has hydrated', () => {
    const local: readonly Row[] = [{ id: '1', tag: 'local' }];
    expect(mergeById(local, [])).toBe(local); // same reference — no needless copy
  });

  it('appends a hydrated row this device never captured', () => {
    const local: readonly Row[] = [{ id: '1', tag: 'local' }];
    const hydrated: readonly Row[] = [{ id: '2', tag: 'hydrated' }];
    expect(mergeById(local, hydrated)).toEqual([
      { id: '1', tag: 'local' },
      { id: '2', tag: 'hydrated' },
    ]);
  });

  it('⭐ test 7 of the required matrix: a shared id never appears twice, and local wins', () => {
    // The exact shape a hydration event produces once this device's OWN capture has been sent and
    // later replicated back down to it: the same row, now present in BOTH `local` and `hydrated`.
    const local: readonly Row[] = [{ id: 'shared', tag: 'local' }];
    const hydrated: readonly Row[] = [{ id: 'shared', tag: 'hydrated' }];
    const merged = mergeById(local, hydrated);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual({ id: 'shared', tag: 'local' });
  });

  it('does not lose a local row that also happens to be hydrated, alongside one that is not', () => {
    const local: readonly Row[] = [{ id: 'shared', tag: 'local' }];
    const hydrated: readonly Row[] = [
      { id: 'shared', tag: 'hydrated' },
      { id: 'only-hydrated', tag: 'hydrated' },
    ];
    const merged = mergeById(local, hydrated);
    expect(merged).toEqual([
      { id: 'shared', tag: 'local' },
      { id: 'only-hydrated', tag: 'hydrated' },
    ]);
  });
});

/**
 * `mergeByIdPreferHydrated` — the second compliance-checker finding on the same 3e diff.
 * `mergeById`'s local-wins is right for most tables, but `StoredMove`/`WithholdDose` are NOT most
 * tables: the hydrated echo of a move/dose carries server-derived fields (`fromMobId`, `
 * meatWithholdUntil`) a local capture structurally cannot. Local-wins on a shared id permanently
 * shadowed that enrichment the moment a device's OWN capture round-tripped back down as its
 * hydrated twin — the ordinary two-device workflow, not an edge case.
 */
describe('mergeByIdPreferHydrated', () => {
  it('⭐ the shadow-copy trace: on a shared id, hydrated wins — the enrichment a local capture never carries survives the fold', () => {
    // Exactly the trace the compliance-checker re-pass described: THIS device captured the move
    // locally (no `fromMobId` — the app never sends it), and it has since round-tripped through the
    // server and back down as a hydrated row carrying `fromMobId`.
    const local: readonly Row[] = [{ id: 'shared', tag: 'local' }];
    const hydrated: readonly Row[] = [{ id: 'shared', tag: 'hydrated' }];
    const merged = mergeByIdPreferHydrated(local, hydrated);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual({ id: 'shared', tag: 'hydrated' });
  });

  it('still appends a hydrated row this device never captured', () => {
    const local: readonly Row[] = [{ id: '1', tag: 'local' }];
    const hydrated: readonly Row[] = [{ id: '2', tag: 'hydrated' }];
    expect(mergeByIdPreferHydrated(local, hydrated)).toEqual([
      { id: '2', tag: 'hydrated' },
      { id: '1', tag: 'local' },
    ]);
  });

  it('⭐ a pending local-only capture (not yet synced, so no hydrated twin) survives untouched', () => {
    // The regression risk in swapping the winner: a move this device captured but has not yet
    // flushed — or flushed but the server has not yet echoed back — must not vanish from the fold.
    // It has no id collision, so neither `mergeById` nor `mergeByIdPreferHydrated` can drop it.
    const local: readonly Row[] = [
      { id: 'synced', tag: 'local-synced' },
      { id: 'pending', tag: 'local-pending' },
    ];
    const hydrated: readonly Row[] = [{ id: 'synced', tag: 'hydrated' }];
    const merged = mergeByIdPreferHydrated(local, hydrated);
    expect(merged).toHaveLength(2);
    expect(merged).toContainEqual({ id: 'pending', tag: 'local-pending' });
    expect(merged).toContainEqual({ id: 'synced', tag: 'hydrated' });
  });
});
