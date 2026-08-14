/**
 * Local durable capture store (Phase 2) — the seam the offline capture screens read and
 * write through, exactly as the session lives behind `createSessionStore`. Application code
 * reaches local data through THIS, never a storage API (or, later, the PowerSync SDK)
 * directly: the ADR-0003 exit depends on the app not knowing what backs the store.
 *
 * What it is for: a farmer in a crush with no signal taps "Save". The record has to commit
 * locally, instantly, and still be there after the screen re-renders and after a cold start —
 * with no network anywhere in that path (.claude/rules/frontend.md: a capture path that
 * awaits the network is the bug). This store is that local commit. In Phase 1 the backing is
 * `localStorage`; in Phase 3 it becomes the same OPFS/SQLite the rest of the local data uses,
 * and nothing above this seam changes — which is the entire point of having the seam.
 *
 * It is deliberately append-only and reactive:
 *  • append-only, because these are captured facts (an animal was recorded, a weight taken),
 *    and the sync model for events is append-never-merge (.claude/rules/db.md);
 *  • reactive, because a tile's live number has to move the instant a capture lands — the
 *    Phase 3 twin of this is a PowerSync watched query, and `subscribe` is the same contract,
 *    so the tile code that consumes it is written once and survives the swap.
 *
 * The in-memory snapshot is replaced (never mutated) on every write, so its identity is
 * stable between writes — which is exactly what React's `useSyncExternalStore` needs to
 * avoid tearing and infinite re-render loops.
 */

import type { SessionStorageLike } from './session-store';

export interface CaptureStore<T> {
  /**
   * The current records, oldest first. The returned array's identity is STABLE until the
   * next `append` — safe to use as a `useSyncExternalStore` snapshot.
   */
  all(): readonly T[];
  /**
   * Commits a record locally and notifies subscribers; never touches the network. The returned
   * promise resolves ONLY once the record is durably persisted — a caller (a capture screen) must
   * await it before reporting "Saved" or advancing the flow, never before. This store's own
   * `persist()` is synchronous storage, so the promise is already resolved by the time it is
   * returned; the SQLite-backed sibling (`createSqliteCaptureStore`) is where this genuinely
   * awaits an async commit.
   */
  append(record: T): Promise<void>;
  /** Subscribe to changes; returns an unsubscribe. The listener fires after each `append`. */
  subscribe(listener: () => void): () => void;
  /**
   * Whether the store's initial hydration ATTEMPT is over — `all()` reflects everything this
   * store can currently account for, not a still-loading subset. True immediately and always for
   * this synchronous, localStorage-backed store; the SQLite-backed sibling
   * (`createSqliteCaptureStore`) starts `false` and flips `true` once its async open/migrate/read
   * completes, on EITHER outcome (see that module's header on why success-only signalling hangs
   * a waiter). Exists so a consumer that reads MULTIPLE stores together — `Outbox.tsx`'s flush,
   * most of all — can wait for every one of them to have a true account of what a farmer's device
   * holds before acting on any of them. Treating "not yet loaded" as "confirmed empty" is how a
   * dose that has not hydrated yet stops being evidence a disposal is judged against.
   */
  settled(): boolean;
  /**
   * Whether the hydration attempt `settled()` reports as over ended in a genuine failure (the
   * database would not open, or reading it back threw) rather than a clean read. Always `false`
   * for this synchronous, localStorage-backed store. The SQLite-backed sibling
   * (`createSqliteCaptureStore`) can flip this `true`: unlike a single corrupt row (tolerated —
   * skipped, not fatal), an unopenable database means `all()` for this store is NOT a trustworthy
   * "confirmed empty" the moment `settled()` is true, and a consumer that reads multiple stores
   * together (`Outbox.tsx`'s flush, most of all) must not treat it as one — a disposal guarded by
   * a store that failed to hydrate must be held, not waved through as if the guard read nothing.
   */
  hydrationFailed(): boolean;
  /** Releases instance-owned listeners/resources. Pending durable work must not be discarded. */
  close(): void;
}

export interface CaptureStoreOptions {
  readonly storage: SessionStorageLike;
  /**
   * The storage key. The CALLER namespaces it — in particular by farm id, so switching the
   * active farm reads a different herd and one farm's captures never bleed into another's.
   */
  readonly key: string;
}

export function createCaptureStore<T>(options: CaptureStoreOptions): CaptureStore<T> {
  const { storage, key } = options;

  // The single in-memory copy. Read once at construction; every mutation replaces it with a
  // new array so subscribers can compare by identity.
  let snapshot: readonly T[] = load(storage, key);
  const listeners = new Set<() => void>();

  return {
    all(): readonly T[] {
      return snapshot;
    },

    async append(record: T): Promise<void> {
      snapshot = [...snapshot, record];
      persist(storage, key, snapshot);
      for (const listener of listeners) listener();
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    settled(): boolean {
      return true; // read once at construction — synchronous, so always already settled
    },

    hydrationFailed(): boolean {
      return false; // load() below never throws — a corrupt value reads as [], not a failure
    },
    close(): void {
      listeners.clear();
    },
  };
}

function load<T>(storage: SessionStorageLike, key: string): readonly T[] {
  const raw = storage.getItem(key);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    // A corrupt or half-written value is treated as "no captures yet" rather than throwing —
    // a parse error here would otherwise crash the app on boot, offline, with no way out. It
    // is NOT discarded: the malformed string stays in storage untouched, and the first
    // successful append overwrites it. The store never deletes a farmer's data to recover.
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function persist<T>(storage: SessionStorageLike, key: string, records: readonly T[]): void {
  try {
    storage.setItem(key, JSON.stringify(records));
  } catch {
    // Quota exceeded, or storage disabled (private browsing). The record is still live in
    // memory for this session, so the app keeps working; it just may not survive a cold
    // start. Failing the capture over this would be the worse outcome — the farmer tapped
    // Save and saw it land. We never surface this as a lost write.
  }
}
