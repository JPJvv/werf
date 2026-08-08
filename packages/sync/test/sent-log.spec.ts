/**
 * The sent-log (Phase 2) — written as the situation it exists for: "the flush confirmed these
 * captures reached the server, so stop counting them as pending", "it remembered that across a
 * cold start so it didn't re-send yesterday's work needlessly", "one farm's send-state never
 * touched another's". The invariant these pin down is that the log only ever GROWS and is never
 * discarded — the mirror of the write queue never being cleared by the system.
 */

import { describe, expect, it, vi } from 'vitest';
import { createSentLog, type SessionStorageLike } from '../src/index';

/** An in-memory stand-in for localStorage. Not a mock of our code — a stand-in for theirs. */
function memoryStorage(initial: Record<string, string> = {}): SessionStorageLike & {
  dump: () => Record<string, string>;
} {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    dump: () => Object.fromEntries(map),
  };
}

describe('the sent-log', () => {
  it('records an id as sent and answers has() for it', () => {
    const log = createSentLog({ storage: memoryStorage(), key: 'werf-sent:farm-a' });

    expect(log.has('1')).toBe(false);
    log.add('1');
    expect(log.has('1')).toBe(true);
    expect([...log.all()]).toEqual(['1']);
  });

  it('remembers what was sent across a cold start, so it is not re-sent', () => {
    const storage = memoryStorage();
    createSentLog({ storage, key: 'werf-sent:farm-a' }).add('1');

    // A fresh log instance is what a page reload builds: same storage, nothing in memory.
    const afterReload = createSentLog({ storage, key: 'werf-sent:farm-a' });

    expect(afterReload.has('1')).toBe(true);
  });

  it('keeps a stable snapshot identity until something new is marked sent', () => {
    // useSyncExternalStore depends on this: the snapshot must not change on a read.
    const log = createSentLog({ storage: memoryStorage(), key: 'werf-sent:farm-a' });

    const before = log.all();
    expect(log.all()).toBe(before); // same identity across reads

    log.add('1');
    expect(log.all()).not.toBe(before); // a new identity once something changed
  });

  it('treats re-adding an already-sent id as a no-op — no needless notify or new identity', () => {
    const log = createSentLog({ storage: memoryStorage(), key: 'werf-sent:farm-a' });
    const listener = vi.fn();
    log.subscribe(listener);

    log.add('1');
    const afterFirst = log.all();
    log.add('1'); // the same id again — an at-least-once flush re-confirming a send

    expect(listener).toHaveBeenCalledTimes(1);
    expect(log.all()).toBe(afterFirst); // identity unchanged
  });

  it('notifies subscribers when an id is marked sent, and stops after unsubscribe', () => {
    const log = createSentLog({ storage: memoryStorage(), key: 'werf-sent:farm-a' });
    const listener = vi.fn();

    const unsubscribe = log.subscribe(listener);
    log.add('1');
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    log.add('2');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps one farm’s send-state out of another’s', () => {
    const storage = memoryStorage();
    const farmA = createSentLog({ storage, key: 'werf-sent:farm-a' });
    const farmB = createSentLog({ storage, key: 'werf-sent:farm-b' });

    farmA.add('1');
    farmB.add('2');

    expect(farmA.has('2')).toBe(false);
    expect(farmB.has('1')).toBe(false);
  });

  it('treats a corrupt log as nothing-sent rather than crashing the app on boot', () => {
    const storage = memoryStorage({ 'werf-sent:farm-a': '{ not json' });

    const log = createSentLog({ storage, key: 'werf-sent:farm-a' });

    // Empty, not thrown. Reading it empty is safe: the worst case is a capture re-sent to an
    // idempotent endpoint, never a lost row.
    expect([...log.all()]).toEqual([]);
    log.add('1');
    expect(log.has('1')).toBe(true);
  });

  it('does not lose the in-memory send-state when storage refuses to persist it', () => {
    // Private browsing / quota exceeded: setItem throws. The send is still recorded this session.
    const storage: SessionStorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => undefined,
    };

    const log = createSentLog({ storage, key: 'werf-sent:farm-a' });
    expect(() => log.add('1')).not.toThrow();
    expect(log.has('1')).toBe(true);
  });
});
