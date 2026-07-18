import { describe, expect, it } from 'vitest';
import { SYNC_CLASSIFICATIONS, type SyncClassification } from '../src/index';

/**
 * The tenancy invariant: sync rules and RLS must grant the same set, and no `server-only`
 * table may ever appear in a sync rule. In Phase 0 there are no tables, so this suite only
 * asserts the classification vocabulary is well-formed. It grows table-by-table in Phase 3.
 */
describe('sync tenancy', () => {
  it('has no tables classified yet in Phase 0', () => {
    expect(Object.keys(SYNC_CLASSIFICATIONS)).toHaveLength(0);
  });

  it('only permits the three known classifications', () => {
    const allowed: SyncClassification[] = ['farm-scoped', 'reference', 'server-only'];
    for (const classification of Object.values(SYNC_CLASSIFICATIONS)) {
      expect(allowed).toContain(classification);
    }
  });
});
