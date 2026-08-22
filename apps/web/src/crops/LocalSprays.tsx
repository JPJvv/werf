/** Farmer-owned local spray log. Product facts are snapshots of what the farmer entered. */

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
import { mergeByIdPreferHydrated } from '../livestock/HydratedLivestock';
import { useHydratedSprays } from './HydratedSprays';

/** A spray as held locally. Product details are captured with the event so history stays stable. */
export interface StoredSpray {
  readonly id: string;
  readonly farmId: string;
  readonly landUnitId: string;
  readonly occurredAt: string;
  readonly sprayedOn: string;
  readonly productId: string;
  readonly productName: string;
  readonly registrationNumber?: string;
  readonly rateLPerHa?: number;
  readonly waterLPerHa?: number;
  readonly operator?: string;
  readonly equipment?: string;
  readonly windKph?: number;
  readonly tempC?: number;
  readonly targetPest?: string;
  readonly activeIngredients?: readonly string[];
  readonly phiDays?: number;
  readonly earliestHarvestDate?: string;
  /** Historical compatibility only; new captures never create regulatory overrides. */
  readonly phiOverride?: { readonly reason: string; readonly by?: string };
  /** The stock lot this spray drew from (Phase 4e, FR-502) — OPTIONAL. See `@werf/domain`'s
   *  `SprayInput` field of the same name: the quantity consumed is a separate `inventory_movement`
   *  capture, never a field here. */
  readonly inventoryLotId?: string;
}

export type SprayStore = CaptureStore<StoredSpray>;
export type SprayStoreFactory = (key: string) => SprayStore;

const defaultFactory: SprayStoreFactory = (key) =>
  createSqliteCaptureStore<StoredSpray>({
    database: getLocalDatabase,
    key,
    legacyStorage: window.localStorage,
  });

const SprayStoreContext = createContext<SprayStore | null>(null);

export interface LocalSpraysProviderProps {
  children: ReactNode;
  factory?: SprayStoreFactory;
}

export function LocalSpraysProvider({
  children,
  factory = defaultFactory,
}: LocalSpraysProviderProps) {
  const { activeFarm } = useAuth();
  const farmId = activeFarm?.id ?? 'none';
  const store = useMemo(() => factory(`werf-sprays:${farmId}`), [factory, farmId]);
  useCloseCaptureStore(store);

  return <SprayStoreContext.Provider value={store}>{children}</SprayStoreContext.Provider>;
}

function useSprayStore(): SprayStore {
  const store = useContext(SprayStoreContext);
  if (!store) throw new Error('useSprays must be used inside a LocalSpraysProvider');
  return store;
}

/** This device's own sprays, reactive. */
export function useSprays(): readonly StoredSpray[] {
  const store = useSprayStore();
  return useSyncExternalStore(store.subscribe, store.all);
}

/** Whether this store's initial hydration attempt is over — the Outbox flush must not act on
 *  `useSprays()` until this is true. */
export function useSpraysSettled(): boolean {
  const store = useSprayStore();
  return useSyncExternalStore(store.subscribe, store.settled);
}

/** Whether this store's hydration ATTEMPT ended in a genuine failure — the Outbox flush must
 *  hold, not treat `useSprays()` as confirmed empty, when this is true. This is the FR-204
 *  analogue of `useHealthEventsHydrationFailed`'s own sharp case: a future harvest guard (4d) will
 *  read a block's own spray history to decide whether a harvest falls inside an active PHI. */
export function useSpraysHydrationFailed(): boolean {
  const store = useSprayStore();
  return useSyncExternalStore(store.subscribe, store.hydrationFailed);
}

/**
 * Record a spray. Synchronous; never awaits the network (NFR-007). No domain validation runs here
 * — see the module note for why — so the capture screen is responsible for the two hard
 * structural requirements (a real block and a named farm product) before this is called.
 */
export function useRecordSpray(): (spray: StoredSpray) => Promise<void> {
  const store = useSprayStore();
  return useCallback((spray) => store.append(spray), [store]);
}

/**
 * This device's own sprays, MERGED with sprays another device sent and the server has already
 * replicated down (the land-hydration pattern, applied to this store). HYDRATED wins on a shared
 * id — `mergeByIdPreferHydrated`, the same choice `HydratedLivestock.tsx` makes for a move — because
 * the hydrated copy is the server-accepted echo. Product facts remain farmer-entered snapshots;
 * hydration does not turn them into an approval or regulatory determination.
 */
export function useEffectiveSprays(): readonly StoredSpray[] {
  const sprays = useSprays();
  const hydrated = useHydratedSprays();
  return useMemo(() => mergeByIdPreferHydrated(sprays, hydrated), [sprays, hydrated]);
}
