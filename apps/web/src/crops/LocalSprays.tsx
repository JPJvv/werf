/**
 * The local spray log (FR-204) — sprays, as the device holds them. COMPLIANCE-GATED: these are the
 * records a pre-harvest interval is computed from, and a GlobalGAP auditor reads (FR-211).
 *
 * ⭐ What is NOT stored here, mirroring `LocalHealth.tsx`'s own header exactly: a stored spray
 * carries a `productId` and NEVER a PHI figure or an active-ingredients list, because both are
 * REGULATED and resolved server-side from the registration in force on the spray day (ADR-0005,
 * FR-204, .claude/rules/domain.md). Unlike `LocalPlantings`/`LocalFertiliser`, this store does NOT
 * call the `@werf/domain` `recordSpray` builder locally — that function needs the resolved PHI as
 * an INPUT, which this device does not have and must not invent. The screen SHOWS a PHI preview
 * from the cached register so the farmer knows the earliest safe harvest day; that is a preview,
 * and it is the server's number that is stored.
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
import { mergeByIdPreferHydrated } from '../livestock/HydratedLivestock';
import { useHydratedSprays } from './HydratedSprays';

/**
 * A spray as held locally. The three REGULATED fields — `activeIngredients`, `phiDays`,
 * `earliestHarvestDate` — are never SET by a local capture (see the module note); they exist here
 * only so the identical shape can carry them once THIS device's own write round-trips back down as
 * a hydrated echo with the same id (`HydratedSprays.tsx`'s `mergeByIdPreferHydrated` merge). A row
 * with them undefined is a spray whose server-resolved facts have not reached this device yet, not
 * a spray that was recorded without them.
 */
export interface StoredSpray {
  readonly id: string;
  readonly farmId: string;
  readonly landUnitId: string;
  readonly occurredAt: string;
  readonly sprayedOn: string;
  readonly productId: string;
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
 * requirements (a real block, a selected product) before this is called.
 */
export function useRecordSpray(): (spray: StoredSpray) => Promise<void> {
  const store = useSprayStore();
  return useCallback((spray) => store.append(spray), [store]);
}

/**
 * This device's own sprays, MERGED with sprays another device sent and the server has already
 * replicated down (the land-hydration pattern, applied to this store). HYDRATED wins on a shared
 * id — `mergeByIdPreferHydrated`, the same choice `HydratedLivestock.tsx` makes for a move — because
 * the hydrated copy carries `activeIngredients`/`phiDays`/`earliestHarvestDate`, which a purely
 * local capture never can (see `StoredSpray`'s own doc). Without this, FR-211's report would show
 * every spray missing its PHI until a farmer happened to open the app after a full round trip.
 */
export function useEffectiveSprays(): readonly StoredSpray[] {
  const sprays = useSprays();
  const hydrated = useHydratedSprays();
  return useMemo(() => mergeByIdPreferHydrated(sprays, hydrated), [sprays, hydrated]);
}
