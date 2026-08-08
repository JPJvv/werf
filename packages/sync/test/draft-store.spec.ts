/**
 * The draft store, tested on the behaviour that justifies it existing at all: an unfinished walk
 * survives a cold start, and a finished or abandoned one leaves nothing behind for the next one to
 * inherit.
 */

import { describe, expect, it, vi } from 'vitest';
import { createDraftStore, type SessionStorageLike } from '../src';

/** An in-memory storage, so nothing here depends on a browser. */
function memoryStorage(seed: Record<string, string> = {}): SessionStorageLike & {
  readonly data: Record<string, string>;
} {
  const data: Record<string, string> = { ...seed };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

const KEY = 'werf-walk:farm-1:camp-3';

describe('createDraftStore', () => {
  it('starts empty when nothing has been drafted', () => {
    const store = createDraftStore<number>({ storage: memoryStorage(), key: KEY });

    expect(store.read()).toEqual([]);
  });

  it('⭐ reads back a draft written before a cold start — an hour of walking is not a screen timeout', () => {
    const storage = memoryStorage();
    createDraftStore<string>({ storage, key: KEY }).write(['corner-1', 'corner-2']);

    // A brand new store over the same storage: the app was killed and re-opened.
    const afterRestart = createDraftStore<string>({ storage, key: KEY });

    expect(afterRestart.read()).toEqual(['corner-1', 'corner-2']);
  });

  it('replaces the draft rather than appending, so the last corner can be dropped', () => {
    const store = createDraftStore<string>({ storage: memoryStorage(), key: KEY });
    store.write(['a', 'b', 'c']);

    store.write(['a', 'b']);

    expect(store.read()).toEqual(['a', 'b']);
  });

  it('leaves nothing behind when a walk is finished or abandoned', () => {
    const storage = memoryStorage();
    const store = createDraftStore<string>({ storage, key: KEY });
    store.write(['a', 'b']);

    store.clear();

    expect(store.read()).toEqual([]);
    // And the key itself is gone, so the next camp walked does not inherit these corners.
    expect(storage.getItem(KEY)).toBeNull();
  });

  it('notifies subscribers on every change, and stops when unsubscribed', () => {
    const store = createDraftStore<string>({ storage: memoryStorage(), key: KEY });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.write(['a']);
    store.clear();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    store.write(['b']);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('keeps a stable snapshot identity between writes, for useSyncExternalStore', () => {
    const store = createDraftStore<string>({ storage: memoryStorage(), key: KEY });
    store.write(['a']);

    // Tearing and infinite re-render loops both come from an identity that changes on every read.
    expect(store.read()).toBe(store.read());
  });

  it('treats a corrupt value as "no draft" instead of crashing a cold boot, and keeps it', () => {
    const storage = memoryStorage({ [KEY]: 'not json at all' });

    const store = createDraftStore<string>({ storage, key: KEY });

    expect(store.read()).toEqual([]);
    // Never deleted to recover: the store does not destroy something it failed to understand.
    expect(storage.getItem(KEY)).toBe('not json at all');
  });

  it('keeps the walk going when storage refuses the write (quota, private browsing)', () => {
    const storage: SessionStorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => undefined,
    };
    const store = createDraftStore<string>({ storage, key: KEY });

    // The corner the farmer just marked must not be lost to a storage failure they cannot see.
    expect(() => store.write(['a'])).not.toThrow();
    expect(store.read()).toEqual(['a']);
  });
});
