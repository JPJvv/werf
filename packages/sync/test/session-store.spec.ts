/**
 * The offline session window (FR-006).
 *
 * These are written as the farmer's situation, not as the function's contract: "three weeks
 * in the veld and the app still opens", "five weeks and it asks me to sign in again". The
 * window is the whole reason the product claims to work offline, so the boundary matters.
 */

import { describe, expect, it } from 'vitest';
import { createSessionStore, isWithinWindow, type SessionStorageLike } from '../src/index';

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

interface Payload {
  userId: string;
  farms: string[];
}

const PAYLOAD: Payload = { userId: 'u-1', farms: ['Rietfontein'] };

const DAY_MS = 24 * 60 * 60 * 1000;

describe('the cached session', () => {
  it('renders the shell on a cold start with no signal', () => {
    // The scenario the whole feature exists for: the app opens, offline, and knows who
    // this is without asking anyone.
    const storage = memoryStorage();
    const store = createSessionStore<Payload>({ storage });

    store.write(PAYLOAD);

    const reopened = createSessionStore<Payload>({ storage });
    expect(reopened.read()?.payload).toEqual(PAYLOAD);
  });

  it('is absent before anyone has signed in', () => {
    expect(createSessionStore<Payload>({ storage: memoryStorage() }).read()).toBeNull();
  });

  it('survives three weeks in a signal dead zone', () => {
    const storage = memoryStorage();
    const write = new Date('2026-07-01T08:00:00Z');
    createSessionStore<Payload>({ storage, now: () => write }).write(PAYLOAD);

    const threeWeeksLater = new Date(write.getTime() + 21 * DAY_MS);
    const store = createSessionStore<Payload>({ storage, now: () => threeWeeksLater });

    expect(store.read()?.payload).toEqual(PAYLOAD);
  });

  it('asks for a sign-in again once the window has passed', () => {
    const storage = memoryStorage();
    const write = new Date('2026-07-01T08:00:00Z');
    createSessionStore<Payload>({ storage, now: () => write }).write(PAYLOAD);

    const fiveWeeksLater = new Date(write.getTime() + 35 * DAY_MS);
    const store = createSessionStore<Payload>({ storage, now: () => fiveWeeksLater });

    expect(store.read()).toBeNull();
  });

  it('measures silence, not account age — each contact restarts the window', () => {
    // A farmer who syncs on day 21 gets another 30 days. Without this the window would
    // count from first login and log them out mid-season for no reason.
    const storage = memoryStorage();
    const first = new Date('2026-07-01T08:00:00Z');
    createSessionStore<Payload>({ storage, now: () => first }).write(PAYLOAD);

    const day21 = new Date(first.getTime() + 21 * DAY_MS);
    createSessionStore<Payload>({ storage, now: () => day21 }).write(PAYLOAD);

    const day45 = new Date(first.getTime() + 45 * DAY_MS);
    expect(createSessionStore<Payload>({ storage, now: () => day45 }).read()).not.toBeNull();
  });

  it('forgets the session on an explicit sign-out', () => {
    const storage = memoryStorage();
    const store = createSessionStore<Payload>({ storage });
    store.write(PAYLOAD);

    store.clear();

    expect(store.read()).toBeNull();
    expect(storage.dump()).toEqual({});
  });

  it('honours a configured window shorter than the default', () => {
    const storage = memoryStorage();
    const write = new Date('2026-07-01T08:00:00Z');
    createSessionStore<Payload>({ storage, windowDays: 7, now: () => write }).write(PAYLOAD);

    const day10 = new Date(write.getTime() + 10 * DAY_MS);
    expect(
      createSessionStore<Payload>({ storage, windowDays: 7, now: () => day10 }).read(),
    ).toBeNull();
  });

  it('sanitises a legacy payload without extending its offline confirmation window', () => {
    const confirmedAt = '2026-07-01T08:00:00.000Z';
    const storage = memoryStorage({
      'werf-session': JSON.stringify({
        payload: { ...PAYLOAD, refreshToken: 'must-leave-storage' },
        confirmedAt,
      }),
    });
    const store = createSessionStore<Payload>({
      storage,
      now: () => new Date('2026-07-02T08:00:00.000Z'),
      sanitizePersisted: (payload) => {
        const { refreshToken: _refreshToken, ...safe } = payload as Payload & {
          refreshToken?: string;
        };
        return safe;
      },
    });

    // The current tab may migrate from the old value once, but persistence is clean immediately.
    expect(store.read()?.payload).toHaveProperty('refreshToken', 'must-leave-storage');
    const persisted = JSON.parse(storage.dump()['werf-session'] ?? '{}') as {
      payload: Record<string, unknown>;
      confirmedAt: string;
    };
    expect(persisted.payload).not.toHaveProperty('refreshToken');
    expect(persisted.confirmedAt).toBe(confirmedAt);
  });
});

describe('a session store that finds rubbish', () => {
  it.each(['not json at all', '{', 'null', '[]', '{"payload":null}', '{"payload":{}}'])(
    'treats %j as "no session" rather than crashing the app on boot',
    (raw) => {
      // A throw here is a farmer with a white screen, offline, and no way out of it.
      const store = createSessionStore<Payload>({
        storage: memoryStorage({ 'werf-session': raw }),
      });
      expect(() => store.read()).not.toThrow();
      expect(store.read()).toBeNull();
    },
  );

  it('keeps working when storage refuses to write', () => {
    // Private browsing, or a full quota. The session stays live in memory for this tab;
    // failing the login over it would be worse than not surviving a cold start.
    const storage: SessionStorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {},
    };

    expect(() => createSessionStore<Payload>({ storage }).write(PAYLOAD)).not.toThrow();
  });
});

describe('the window boundary', () => {
  const at = new Date('2026-08-01T00:00:00Z');
  const ago = (days: number) => new Date(at.getTime() - days * DAY_MS).toISOString();

  it('is inside up to the last moment and outside after', () => {
    expect(isWithinWindow(ago(29.9), 30, at)).toBe(true);
    expect(isWithinWindow(ago(30.1), 30, at)).toBe(false);
  });

  it('accepts a confirmation dated in the future rather than locking someone out', () => {
    // A phone with a wrong clock is common and the farmer cannot correct it offline.
    // Erring towards "still valid" costs little; erring the other way is a lockout.
    const tomorrow = new Date(at.getTime() + DAY_MS).toISOString();
    expect(isWithinWindow(tomorrow, 30, at)).toBe(true);
  });

  it('rejects an unparseable date', () => {
    expect(isWithinWindow('not-a-date', 30, at)).toBe(false);
    expect(isWithinWindow('', 30, at)).toBe(false);
  });
});
