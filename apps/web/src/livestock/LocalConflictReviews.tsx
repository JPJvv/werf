/** Cached server review queue: readable offline, refreshed opportunistically when signal returns. */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createReferenceCache, type ReferenceCache } from '@werf/sync';
import type { schemas } from '@werf/core';
import { useAuth } from '../auth/AuthProvider';
import { useSyncStatus } from '../sync/useSyncStatus';
import { conflictsApi } from './conflictsApi';

type Store = ReferenceCache<schemas.ConflictReviewJson>;
type ContextValue = { readonly store: Store };
const Context = createContext<ContextValue | null>(null);

export function LocalConflictReviewsProvider({ children }: { children: ReactNode }) {
  const { session, activeFarm } = useAuth();
  const online = useSyncStatus().status !== 'offline';
  const farmId = activeFarm?.id ?? 'none';
  const token = session?.accessToken;
  const store = useMemo(
    () =>
      createReferenceCache<schemas.ConflictReviewJson>({
        storage: window.localStorage,
        key: `werf-conflict-reviews:${farmId}`,
      }),
    [farmId],
  );

  useEffect(() => {
    if (!online || !token || !activeFarm) return;
    let cancelled = false;
    void conflictsApi
      .listOpen(activeFarm.id, token)
      .then((rows) => {
        if (!cancelled) store.replace(rows);
      })
      .catch(() => {
        /* Cached evidence stays useful when refresh cannot reach the server. */
      });
    return () => {
      cancelled = true;
    };
  }, [activeFarm, online, store, token]);

  const value = useMemo(() => ({ store }), [store]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

function useValue(): ContextValue {
  const value = useContext(Context);
  if (!value) throw new Error('Conflict review hooks require LocalConflictReviewsProvider');
  return value;
}

export function useConflictReviews(): readonly schemas.ConflictReviewJson[] {
  const { store } = useValue();
  return useSyncExternalStore(store.subscribe, store.all);
}

export function useMarkConflictReviewed(): (id: string) => Promise<void> {
  const { store } = useValue();
  const { session, activeFarm } = useAuth();
  return useCallback(
    async (id: string) => {
      if (!session?.accessToken || !activeFarm) throw new Error('Sign in before reviewing');
      await conflictsApi.markReviewed(id, activeFarm.id, session.accessToken);
      store.replace(store.all().filter((row) => row.id !== id));
    },
    [activeFarm, session?.accessToken, store],
  );
}
