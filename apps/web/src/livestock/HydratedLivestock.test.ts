/**
 * `mergeById` — the pure function `Outbox.tsx`'s `needsHead` and `herd.ts`'s `useEffectiveMobs`
 * both use to combine a device's own captures with what down-sync has hydrated. Tested in
 * isolation because it is the one piece of the tripwire-3e fix with no React, no fake database,
 * and no farm scoping to thread through — the property it has to hold (test 7 of the required
 * matrix: a pending local capture and its own hydrated copy never double-count) is a fact about
 * this function alone.
 */

import { describe, expect, it } from 'vitest';
import { mergeById } from './HydratedLivestock';

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
