/**
 * The sent-log — a durable, reactive record of which local captures THIS DEVICE has confirmed the
 * server stored. It is `Outbox.tsx`'s permanent upload cursor (ADR-0012), not a stand-in for a
 * PowerSync upload cursor — PowerSync carries no upload role in this product. The capture stores
 * hold the facts; this holds the small set of ids the best-effort flush has confirmed sent.
 * Pending = every captured record whose id is NOT in here.
 *
 * ⚠️ "Confirmed by the server" here means "this device sent it and got a 2xx" — it is NOT the same
 * question as "does the server hold this record at all" once down-sync hydration exists (3e): a
 * record another device sent and this device later reads back via PowerSync is never added here.
 * That second, independent source of "the server has this" is derived live from the local
 * down-synced tables, never by writing hydrated ids into this log — which would conflate "this
 * device sent it" with "the server holds it" and, on a large farm, grow this log unboundedly.
 *
 * Why a separate log rather than a flag on each record: the capture stores are append-only and
 * their snapshot identity must stay stable for `useSyncExternalStore` (mutating a record in place
 * would tear a live read). "Sent" is metadata ABOUT a record, not part of the captured fact, so it
 * lives beside the stores and is keyed by the same farm id — one farm's send-state never bleeds
 * into another's.
 *
 * The invariant that matters most: this log GROWS. An id is added only when the server has
 * confirmed the write; the flush never removes one, and a failed or offline flush leaves the id
 * absent so it is retried. The write queue is never discarded by the system (.claude/rules/db.md),
 * and neither is the record of what has already been sent — re-sending a stored capture is a
 * server-side no-op (every capture endpoint is idempotent on its id), so at-least-once is safe.
 */

import type { SessionStorageLike } from './session-store';

export interface SentLog {
  /**
   * The ids confirmed sent. The returned set's identity is STABLE until the next `add` — safe to
   * use as a `useSyncExternalStore` snapshot.
   */
  all(): ReadonlySet<string>;
  /** True iff `id` has been confirmed stored by the server. */
  has(id: string): boolean;
  /** Mark an id sent and notify subscribers. Idempotent; adding an id already present is a no-op. */
  add(id: string): void;
  /** Subscribe to changes; returns an unsubscribe. The listener fires after each new `add`. */
  subscribe(listener: () => void): () => void;
}

export interface SentLogOptions {
  readonly storage: SessionStorageLike;
  /** The storage key. The CALLER namespaces it by farm id (e.g. `werf-sent:<farmId>`). */
  readonly key: string;
}

export function createSentLog(options: SentLogOptions): SentLog {
  const { storage, key } = options;

  // A single in-memory copy, replaced (never mutated) on every add so subscribers can compare by
  // identity — exactly what `useSyncExternalStore` needs to avoid tearing and re-render loops.
  let snapshot: ReadonlySet<string> = load(storage, key);
  const listeners = new Set<() => void>();

  return {
    all(): ReadonlySet<string> {
      return snapshot;
    },

    has(id: string): boolean {
      return snapshot.has(id);
    },

    add(id: string): void {
      if (snapshot.has(id)) return; // no-op: identity stays stable, no needless notify
      snapshot = new Set(snapshot).add(id);
      persist(storage, key, snapshot);
      for (const listener of listeners) listener();
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function load(storage: SessionStorageLike, key: string): ReadonlySet<string> {
  const raw = storage.getItem(key);
  if (raw === null) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    // A corrupt value is treated as "nothing sent yet" rather than throwing — a parse error here
    // must never crash the app on boot. The malformed string is left in storage untouched; the
    // first successful add overwrites it. Reading it as empty is SAFE: the worst case is a capture
    // re-sent to an idempotent endpoint, never a lost or duplicated row.
    return Array.isArray(parsed)
      ? new Set(parsed.filter((v): v is string => typeof v === 'string'))
      : new Set();
  } catch {
    return new Set();
  }
}

function persist(storage: SessionStorageLike, key: string, ids: ReadonlySet<string>): void {
  try {
    storage.setItem(key, JSON.stringify([...ids]));
  } catch {
    // Quota exceeded or storage disabled. The set is still live in memory this session, so the
    // flush stays correct now; the only risk is re-sending on a future cold start — harmless
    // against idempotent endpoints. Failing over this would be the worse outcome.
  }
}
