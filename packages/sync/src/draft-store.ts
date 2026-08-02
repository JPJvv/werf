/**
 * Local durable DRAFT store (Phase 2) — work in progress that is not yet a captured fact.
 *
 * The third sibling of `createCaptureStore` and `createReferenceCache`, not a widening of either,
 * and the three-way distinction is the whole reason it exists:
 *
 *  • a CAPTURE store is append-only, because it holds facts a farmer committed — a weight was taken,
 *    an animal was recorded — and nothing may quietly rewrite them;
 *  • a REFERENCE cache is replaceable, because it is a copy of something the server owns;
 *  • a DRAFT is neither. It is one unfinished thing the farmer is still building, it changes as they
 *    build it, and it stops existing the moment they finish or abandon it.
 *
 * ⭐ Why it must be durable at all, which is the case that forced it: walking the fence of a 200 ha
 * camp takes the better part of an hour. Phones lock, browsers discard backgrounded tabs, and a
 * farmer who climbs back into the bakkie to drive to the far corner has done nothing wrong. Holding
 * the corners in component state means an hour of walking is lost to a screen timeout, and the
 * farmer discovers it at the last corner. So the draft is written through the sync adapter on every
 * change, exactly as a capture is — application code never reaches a storage API directly (ADR-0003).
 *
 * What it is NOT: a queue. Nothing here is ever sent. A draft becomes a capture by being APPENDED to
 * a capture store — one deliberate act, at which point the draft is discarded and the fact is
 * append-only forever. Keeping the two apart is what stops a half-walked boundary reaching a server
 * as though the farmer had finished it.
 */

import type { SessionStorageLike } from './session-store';

export interface DraftStore<T> {
  /**
   * The draft as it stands, oldest item first. The returned array's identity is STABLE until the
   * next `write` or `clear` — safe to use as a `useSyncExternalStore` snapshot.
   */
  read(): readonly T[];
  /** Replace the draft and notify subscribers. Synchronous; never touches the network. */
  write(items: readonly T[]): void;
  /** Discard the draft entirely — finished, or abandoned. */
  clear(): void;
  /** Subscribe to changes; returns an unsubscribe. */
  subscribe(listener: () => void): () => void;
}

export interface DraftStoreOptions {
  readonly storage: SessionStorageLike;
  /**
   * The storage key. The CALLER namespaces it — by farm AND by what is being drafted, so two camps
   * walked in one afternoon are two drafts and neither inherits the other's corners.
   */
  readonly key: string;
}

/** A shared empty snapshot, so an untouched draft keeps a stable identity across reads. */
const EMPTY: readonly never[] = [];

export function createDraftStore<T>(options: DraftStoreOptions): DraftStore<T> {
  const { storage, key } = options;

  let snapshot: readonly T[] = load(storage, key);
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  return {
    read(): readonly T[] {
      return snapshot;
    },

    write(items: readonly T[]): void {
      snapshot = [...items];
      persist(storage, key, snapshot);
      notify();
    },

    clear(): void {
      snapshot = EMPTY as readonly T[];
      try {
        storage.removeItem(key);
      } catch {
        // Storage disabled or unavailable. The draft is gone in memory, which is what the farmer
        // asked for; a stale key left behind is read back as a draft only if the app cold-starts
        // before the next write, and the screen shows it rather than losing anything.
      }
      notify();
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function load<T>(storage: SessionStorageLike, key: string): readonly T[] {
  const raw = storage.getItem(key);
  if (raw === null) return EMPTY as readonly T[];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : (EMPTY as readonly T[]);
  } catch {
    // A corrupt value reads as "no draft" rather than throwing — a parse error on a cold boot,
    // offline, would crash the app with no way out. The malformed string is left alone; the next
    // write replaces it. Nothing is deleted to recover.
    return EMPTY as readonly T[];
  }
}

function persist<T>(storage: SessionStorageLike, key: string, items: readonly T[]): void {
  try {
    storage.setItem(key, JSON.stringify(items));
  } catch {
    // Quota exceeded, or private browsing. The draft is live in memory for this session, so the
    // walk keeps working; it just may not survive a cold start. Failing the corner the farmer just
    // marked would be the worse outcome by far.
  }
}
