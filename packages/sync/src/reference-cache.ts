/**
 * Local reference-data cache (Phase 2) — the device's copy of rows the SERVER owns: registered
 * veterinary products today, chemical products and regulatory rates in later phases.
 *
 * A sibling of `createCaptureStore`, not a widening of it, and the difference is the point. A
 * capture store is APPEND-ONLY because it holds captured facts: a weight was taken, an animal was
 * recorded, and nothing may quietly rewrite them. Reference data is the opposite — it is a
 * REPLACEABLE snapshot of something authoritative elsewhere, refreshed whole whenever there is a
 * signal. Pushing it through the append-only store would duplicate the whole product register on
 * every refresh, and adding a `replace` to that store would hand every capture path a method that
 * can erase a farmer's work.
 *
 * Why it is cached at all: the withdrawal period that decides when an animal may be sold lives in
 * this data (FR-131), and the farmer who needs it is standing in a crush with no signal. The cache
 * is what makes selecting a product possible offline. It is NOT authoritative — the withdrawal
 * actually stored is computed server-side at capture from the registration in force on the
 * treatment day (ADR-0005) — so a stale cache produces a slightly wrong PREVIEW, never a wrong
 * record.
 *
 * Reads are unconditional and never touch the network; a refresh that fails leaves the previous
 * snapshot in place, because an older list is not an error, it is an older list.
 */

import type { SessionStorageLike } from './session-store';

export interface ReferenceCache<T> {
  /**
   * The cached rows. The returned array's identity is STABLE until the next `replace` — safe to
   * use as a `useSyncExternalStore` snapshot.
   */
  all(): readonly T[];
  /** Replace the whole snapshot with a freshly fetched one, and notify subscribers. */
  replace(rows: readonly T[]): void;
  /** Subscribe to changes; returns an unsubscribe. */
  subscribe(listener: () => void): () => void;
}

export interface ReferenceCacheOptions {
  readonly storage: SessionStorageLike;
  /** The storage key. The CALLER namespaces it — by farm, since jurisdiction comes from the farm. */
  readonly key: string;
}

export function createReferenceCache<T>(options: ReferenceCacheOptions): ReferenceCache<T> {
  const { storage, key } = options;

  let snapshot: readonly T[] = load(storage, key);
  const listeners = new Set<() => void>();

  return {
    all(): readonly T[] {
      return snapshot;
    },

    replace(rows: readonly T[]): void {
      // Identity is compared by the caller's snapshot, so an unchanged refresh still swaps the
      // array. That is harmless here (a re-render of a product list) and keeps this trivial.
      snapshot = [...rows];
      persist(storage, key, snapshot);
      for (const listener of listeners) listener();
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function load<T>(storage: SessionStorageLike, key: string): readonly T[] {
  const raw = storage.getItem(key);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    // A corrupt value is treated as "nothing cached yet" rather than throwing — a parse error on
    // boot, offline, would crash the app with no way out. The next refresh replaces it.
    return [];
  }
}

function persist<T>(storage: SessionStorageLike, key: string, rows: readonly T[]): void {
  try {
    storage.setItem(key, JSON.stringify(rows));
  } catch {
    // Quota exceeded or storage disabled. The snapshot is live in memory for this session, so the
    // crush still works; it just may not survive a cold start. Unlike a capture, nothing a farmer
    // did is at risk here — this is a copy of something the server still has.
  }
}
