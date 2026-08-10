/**
 * The down-sync read store (phase-checklists.md 3e), exercised against `createFakeLocalDatabase`'s
 * `watch()`/`hydrateRow()` surface — the same "fake, not a mock" philosophy `sqlite-capture-store.
 * spec.ts` uses for the upload side. This proves the STORE LOGIC: farm-scoping happens in the
 * query, `settled()` flips on the first local read (never a live-sync wait), a hydration failure is
 * sticky and distinguishable from a genuinely empty table, and a later `hydrateRow` delivery is
 * observed reactively without re-constructing the store.
 */

import { describe, expect, it } from 'vitest';
import { createHydratedTableStore } from '../src/hydrated-table-store';
import { createFakeLocalDatabase } from '../src/testing';
import type { LocalDatabase } from '../src/local-database';

interface Row {
  readonly id: string;
  readonly mobId: string;
}

function mapRow(row: Record<string, unknown>): Row | null {
  const id = row['id'];
  const mobId = row['mob_id'];
  return typeof id === 'string' && typeof mobId === 'string' ? { id, mobId } : null;
}

/** Resolves once the store's `subscribe` notifies for the first time. */
function waitForNotify(store: { subscribe(listener: () => void): () => void }): Promise<void> {
  return new Promise((resolve) => {
    const unsubscribe = store.subscribe(() => {
      unsubscribe();
      resolve();
    });
  });
}

describe('the hydrated table store', () => {
  it('settles with the rows already in the canonical table, farm-scoped', async () => {
    const fake = createFakeLocalDatabase();
    fake.hydrateRow('events', {
      id: 'tally-1',
      farm_id: 'farm-a',
      mob_id: 'mob-1',
      type: 'tally',
      occurred_at: '2026-08-01T12:00:00.000Z',
      payload: JSON.stringify({ reason: 'death', delta: -3 }),
    });
    fake.hydrateRow('events', {
      id: 'tally-cross-farm',
      farm_id: 'farm-b',
      mob_id: 'mob-9',
      type: 'tally',
      occurred_at: '2026-08-01T12:00:00.000Z',
      payload: JSON.stringify({ reason: 'death', delta: -1 }),
    });

    const store = createHydratedTableStore({
      database: Promise.resolve(fake as unknown as LocalDatabase),
      sql: "SELECT id, mob_id FROM events WHERE farm_id = ? AND type = 'tally' AND deleted_at IS NULL",
      params: ['farm-a'],
      mapRow,
    });
    await waitForNotify(store);

    expect(store.settled()).toBe(true);
    expect(store.hydrationFailed()).toBe(false);
    // ⭐ Test 8 of the required matrix: cross-farm hydrated rows never appear.
    expect(store.all()).toEqual([{ id: 'tally-1', mobId: 'mob-1' }]);
  });

  it('settles immediately, empty, when nothing has hydrated yet — never a live-sync wait', async () => {
    const fake = createFakeLocalDatabase();
    const store = createHydratedTableStore({
      database: Promise.resolve(fake as unknown as LocalDatabase),
      sql: "SELECT id, mob_id FROM events WHERE farm_id = ? AND type = 'tally' AND deleted_at IS NULL",
      params: ['farm-a'],
      mapRow,
    });
    await waitForNotify(store);

    expect(store.settled()).toBe(true);
    expect(store.all()).toEqual([]);
  });

  it('observes a later delivery reactively, without a new store', async () => {
    const fake = createFakeLocalDatabase();
    const store = createHydratedTableStore({
      database: Promise.resolve(fake as unknown as LocalDatabase),
      sql: "SELECT id, mob_id FROM events WHERE farm_id = ? AND type = 'tally' AND deleted_at IS NULL",
      params: ['farm-a'],
      mapRow,
    });
    await waitForNotify(store);
    expect(store.all()).toEqual([]);

    const secondFire = waitForNotify(store);
    fake.hydrateRow('events', {
      id: 'tally-2',
      farm_id: 'farm-a',
      mob_id: 'mob-1',
      type: 'tally',
      occurred_at: '2026-08-02T12:00:00.000Z',
      payload: JSON.stringify({ reason: 'birth', delta: 5 }),
    });
    await secondFire;

    expect(store.all()).toEqual([{ id: 'tally-2', mobId: 'mob-1' }]);
  });

  it('⭐ close() stops watching — no notification for a delivery arriving after (sync-auditor LOW, 2026-08-10)', async () => {
    // `HydratedLivestockProvider` builds a fresh store pair per farm switch and, before this fix,
    // never tore down the previous farm's `db.watch()` — a resource leak across farm switches
    // within one session (never a cross-farm DATA leak: `all()` was always farm-scoped correctly).
    const fake = createFakeLocalDatabase();
    const store = createHydratedTableStore({
      database: Promise.resolve(fake as unknown as LocalDatabase),
      sql: "SELECT id, mob_id FROM events WHERE farm_id = ? AND type = 'tally' AND deleted_at IS NULL",
      params: ['farm-a'],
      mapRow,
    });
    await waitForNotify(store);

    let notifiedAfterClose = false;
    store.subscribe(() => {
      notifiedAfterClose = true;
    });
    store.close();
    fake.hydrateRow('events', {
      id: 'tally-after-close',
      farm_id: 'farm-a',
      mob_id: 'mob-1',
      type: 'tally',
      occurred_at: '2026-08-02T12:00:00.000Z',
      payload: JSON.stringify({ reason: 'birth', delta: 5 }),
    });

    expect(notifiedAfterClose).toBe(false);
    // The stale snapshot from before close() is what a caller still holding this store would
    // read — proof the watcher, not just the notification, is gone.
    expect(store.all()).toEqual([]);
  });

  it('is sticky-failed, and distinguishable from a confirmed-empty table', async () => {
    const fake = createFakeLocalDatabase();
    fake.failWatch('events');
    const store = createHydratedTableStore({
      database: Promise.resolve(fake as unknown as LocalDatabase),
      sql: "SELECT id, mob_id FROM events WHERE farm_id = ? AND type = 'tally' AND deleted_at IS NULL",
      params: ['farm-a'],
      mapRow,
    });
    await waitForNotify(store);

    expect(store.settled()).toBe(true);
    expect(store.hydrationFailed()).toBe(true);
    expect(store.all()).toEqual([]);
  });

  it('skips a single malformed row rather than failing the whole read', async () => {
    const fake = createFakeLocalDatabase();
    fake.hydrateRows('events', [
      { id: 'good', farm_id: 'farm-a', mob_id: 'mob-1', type: 'tally' },
      { id: 'bad-no-mob', farm_id: 'farm-a', type: 'tally' },
    ]);
    const store = createHydratedTableStore({
      database: Promise.resolve(fake as unknown as LocalDatabase),
      sql: "SELECT id, mob_id FROM events WHERE farm_id = ? AND type = 'tally' AND deleted_at IS NULL",
      params: ['farm-a'],
      mapRow,
    });
    await waitForNotify(store);

    expect(store.hydrationFailed()).toBe(false);
    expect(store.all()).toEqual([{ id: 'good', mobId: 'mob-1' }]);
  });
});
