import { useEffect, useState } from 'react';

/**
 * The save/send state shown by the sync-status strip (FR-009). Offline is a first-class,
 * expected state here — not an error. The strip is how a farmer trusts that a capture made
 * with no signal survived; that trust is the whole product.
 */
export type SyncStatus = 'synced' | 'pending' | 'syncing' | 'error' | 'offline';

export interface SyncState {
  status: SyncStatus;
  /** Number of local writes not yet sent to the server. Includes `blockedCount`. */
  pendingCount: number;
  /**
   * Of those, how many the server REFUSED on their merits — a duplicate tag number, a sale inside
   * a withdrawal period. They are held, never discarded, and retried on every round, but they no
   * longer stop the captures behind them from being sent. A farmer has to change something for
   * these to move, so the strip has to say so rather than promising a retry that cannot work.
   */
  blockedCount: number;
}

/**
 * Phase 1: there is no local write queue yet, so the only real signal is connectivity —
 * online means everything is sent, offline means work is held locally and safe. Phase 3
 * replaces the body of this hook with the packages/sync adapter's real queue state
 * (pending / syncing / error). Consumers already handle every status, so that is a swap,
 * not a rewrite. Application code must never read the PowerSync SDK directly (ADR-0003).
 */
export function useSyncStatus(): SyncState {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return { status: online ? 'synced' : 'offline', pendingCount: 0, blockedCount: 0 };
}
