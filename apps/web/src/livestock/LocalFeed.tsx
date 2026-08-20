/**
 * The local feed-out log (Phase 4e, FR-153) — feed put out for a mob or a camp, as the device
 * holds it.
 *
 * A sibling of `LocalMobMoves.tsx`, the identical shape: `landUnitId`/`enterpriseId` are OPTIONAL,
 * not `| null`, because when a mob is named the server DERIVES both from the mob's own current row
 * (`livestock.service.ts`'s `recordFeed`) and never trusts a client guess — the same asymmetry
 * `LocalMobMoves.tsx`'s `fromLandUnitId` documents. A local capture genuinely does not know the
 * authoritative answer, so it does not invent one; the fields arrive only once this device's own
 * write round-trips back down as a hydrated echo. This store therefore does NOT call the
 * `@werf/domain` `recordFeedOut` builder — that function requires the caller to have already
 * resolved which of `landUnitId`/`mobId` applies, which is exactly the thing a mob-mode capture
 * cannot yet know locally.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createSqliteCaptureStore, type CaptureStore } from '@werf/sync';
import { useAuth } from '../auth/AuthProvider';
import { getLocalDatabase } from '../sync/local-db';
import { useCloseCaptureStore } from '../sync/useCloseCaptureStore';

/** A feed-out, as held locally. */
export interface StoredFeedEvent {
  readonly id: string;
  readonly farmId: string;
  /** ISO 8601. When the feed was put out, on the farm. */
  readonly occurredAt: string;
  readonly mobId: string | null;
  /** Present directly on a camp-only feed-out (this device picked it); server-derived and ABSENT
   *  on a mob feed-out until this device's own write round-trips down — see the module note. */
  readonly landUnitId?: string | null;
  /** Required on a camp-only feed-out (no mob to derive it from); server-derived and absent
   *  locally when a mob was named — same asymmetry as `landUnitId` above. */
  readonly enterpriseId?: string | null;
  readonly inventoryLotId: string;
  readonly quantity: number;
}

export type FeedStore = CaptureStore<StoredFeedEvent>;
export type FeedStoreFactory = (key: string) => FeedStore;

const defaultFactory: FeedStoreFactory = (key) =>
  createSqliteCaptureStore<StoredFeedEvent>({
    database: getLocalDatabase,
    key,
    legacyStorage: window.localStorage,
  });

const FeedStoreContext = createContext<FeedStore | null>(null);

export interface LocalFeedProviderProps {
  children: ReactNode;
  factory?: FeedStoreFactory;
}

export function LocalFeedProvider({ children, factory = defaultFactory }: LocalFeedProviderProps) {
  const { activeFarm } = useAuth();
  const farmId = activeFarm?.id ?? 'none';
  const store = useMemo(() => factory(`werf-feed:${farmId}`), [factory, farmId]);
  useCloseCaptureStore(store);

  return <FeedStoreContext.Provider value={store}>{children}</FeedStoreContext.Provider>;
}

function useFeedStore(): FeedStore {
  const store = useContext(FeedStoreContext);
  if (!store) throw new Error('useFeedEvents must be used inside a LocalFeedProvider');
  return store;
}

/** This device's own feed-outs, reactive. */
export function useFeedEvents(): readonly StoredFeedEvent[] {
  const store = useFeedStore();
  return useSyncExternalStore(store.subscribe, store.all);
}

/** Whether this store's initial hydration attempt is over — the Outbox flush must not act on
 *  `useFeedEvents()` until this is true. */
export function useFeedEventsSettled(): boolean {
  const store = useFeedStore();
  return useSyncExternalStore(store.subscribe, store.settled);
}

/** Whether this store's hydration ATTEMPT ended in a genuine failure — the Outbox flush must
 *  hold, not treat `useFeedEvents()` as confirmed empty, when this is true. */
export function useFeedEventsHydrationFailed(): boolean {
  const store = useFeedStore();
  return useSyncExternalStore(store.subscribe, store.hydrationFailed);
}

/** Record a feed-out. Synchronous; never awaits the network (NFR-007). No domain validation runs
 *  here — see the module note for why — so the capture screen is responsible for the one hard
 *  requirement (a camp or a mob, and a lot with a quantity) before this is called. */
export function useRecordFeed(): (feed: StoredFeedEvent) => Promise<void> {
  const store = useFeedStore();
  return useCallback((feed) => store.append(feed), [store]);
}
