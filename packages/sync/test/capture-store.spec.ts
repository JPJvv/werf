/**
 * The local capture store (Phase 2) — written as the farmer's situation, not the function's
 * contract: "I tapped Save with no signal and it was there when the screen redrew", "it was
 * still there when I opened the app the next morning", "a farm's animals never showed up on
 * another farm". The store is the whole reason a capture survives an offline cold start, so
 * durability and isolation are what these prove.
 */

import { describe, expect, it, vi } from 'vitest';
import { createCaptureStore, type SessionStorageLike } from '../src/index';

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

interface Animal {
  id: string;
  species: string;
}

describe('the local capture store', () => {
  it('commits a capture and hands it straight back', () => {
    const store = createCaptureStore<Animal>({ storage: memoryStorage(), key: 'herd:farm-a' });

    store.append({ id: '1', species: 'cattle' });

    expect(store.all()).toEqual([{ id: '1', species: 'cattle' }]);
  });

  it('keeps captures in the order they were taken', () => {
    const store = createCaptureStore<Animal>({ storage: memoryStorage(), key: 'herd:farm-a' });

    store.append({ id: '1', species: 'cattle' });
    store.append({ id: '2', species: 'sheep' });

    expect(store.all().map((a) => a.id)).toEqual(['1', '2']);
  });

  it('survives a cold start — a new store on the same storage reads yesterday’s captures', () => {
    const storage = memoryStorage();
    createCaptureStore<Animal>({ storage, key: 'herd:farm-a' }).append({
      id: '1',
      species: 'cattle',
    });

    // A fresh store instance is what a page reload builds: same storage, nothing in memory.
    const afterReload = createCaptureStore<Animal>({ storage, key: 'herd:farm-a' });

    expect(afterReload.all()).toEqual([{ id: '1', species: 'cattle' }]);
  });

  it('gives each subscriber the same stable snapshot until the next capture', () => {
    // useSyncExternalStore depends on this: the snapshot identity must not change on a read,
    // or React re-renders forever.
    const store = createCaptureStore<Animal>({ storage: memoryStorage(), key: 'herd:farm-a' });

    const before = store.all();
    expect(store.all()).toBe(before); // same identity across reads

    store.append({ id: '1', species: 'cattle' });
    expect(store.all()).not.toBe(before); // a new identity once something changed
  });

  it('notifies subscribers when a capture lands, and stops after unsubscribe', () => {
    const store = createCaptureStore<Animal>({ storage: memoryStorage(), key: 'herd:farm-a' });
    const listener = vi.fn();

    const unsubscribe = store.subscribe(listener);
    store.append({ id: '1', species: 'cattle' });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.append({ id: '2', species: 'sheep' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps one farm’s captures out of another’s', () => {
    const storage = memoryStorage();
    const farmA = createCaptureStore<Animal>({ storage, key: 'herd:farm-a' });
    const farmB = createCaptureStore<Animal>({ storage, key: 'herd:farm-b' });

    farmA.append({ id: '1', species: 'cattle' });
    farmB.append({ id: '2', species: 'sheep' });

    expect(farmA.all().map((a) => a.id)).toEqual(['1']);
    expect(farmB.all().map((a) => a.id)).toEqual(['2']);
  });

  it('treats a corrupt store as empty rather than crashing the app on boot', () => {
    const storage = memoryStorage({ 'herd:farm-a': '{ not json' });

    const store = createCaptureStore<Animal>({ storage, key: 'herd:farm-a' });

    // Empty, not thrown — a farmer opening the app offline must never hit a crash here.
    expect(store.all()).toEqual([]);
    // And the corrupt value is not wiped in a panic; the first good append overwrites it.
    store.append({ id: '1', species: 'cattle' });
    expect(store.all()).toEqual([{ id: '1', species: 'cattle' }]);
  });

  it('is always settled — construction is synchronous, so hydration never needs waiting for', () => {
    const store = createCaptureStore<Animal>({ storage: memoryStorage(), key: 'herd:farm-a' });
    expect(store.settled()).toBe(true);
  });

  it('never reports a hydration failure — load() below tolerates corruption, it never throws', () => {
    const store = createCaptureStore<Animal>({ storage: memoryStorage(), key: 'herd:farm-a' });
    expect(store.hydrationFailed()).toBe(false);
  });

  it('does not lose the in-memory capture when storage refuses to persist it', () => {
    // Private browsing / quota exceeded: setItem throws. The farmer tapped Save and must see
    // it land; it simply may not survive a cold start. Failing the capture would be worse.
    const storage: SessionStorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => undefined,
    };

    const store = createCaptureStore<Animal>({ storage, key: 'herd:farm-a' });
    expect(() => store.append({ id: '1', species: 'cattle' })).not.toThrow();
    expect(store.all()).toEqual([{ id: '1', species: 'cattle' }]);
  });
});
