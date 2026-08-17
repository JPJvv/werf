/**
 * The device's copy of the veterinary-product register (FR-131) — regulated REFERENCE data, cached
 * so that selecting a product, and knowing when the animal clears its withdrawal, both work in a
 * crush with no signal.
 *
 * This is the first INBOUND cache in the app: every other local store holds things the farmer
 * captured, and this holds something the server owns. Three rules follow from that:
 *
 *  1. It is refreshed opportunistically and read unconditionally. A screen never awaits the
 *     network to show the list — it renders whatever the device holds, and a refresh that fails is
 *     not an error, it is simply an older list.
 *  2. It is farm-scoped by key, like every other store, because the products a farm may use are
 *     resolved by the FARM's jurisdiction (.claude/rules/domain.md).
 *  3. It is NOT authoritative. The clear date a screen shows from these rows is a preview for the
 *     farmer standing in the crush; the date that is STORED is computed server-side at capture
 *     from the registration in force on the treatment day (ADR-0005, FR-131). If a device's cache
 *     is stale the two can differ, and the server's is the one that counts — which is why the
 *     withdrawal period never crosses the wire on a capture, only the product id does.
 *
 * In Phase 3 the same rows arrive as a reference-classified sync table and this file's consumers do
 * not change; only where the rows come from does.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createReferenceCache, type ReferenceCache } from '@werf/sync';
import { useAuth } from '../auth/AuthProvider';
import { useSyncStatus } from '../sync/useSyncStatus';
import { referenceApi } from './referenceApi';

/**
 * A registered product VERSION, as the device holds it — one row per registration, not one per
 * product name. `id` is the specific version a treatment's `productId` points at, and the cache
 * holds every version this farm's jurisdiction has ever had (P1.3, 2026-08-14), not only whichever
 * is in force today: a treatment captured against a since-superseded registration still needs to
 * resolve its own clear date, and the device must be able to tell "this exact version is
 * registered with no withdrawal" apart from "I have no record of this version at all" — the two
 * mean opposite things for FR-131's fail-closed guard (`withdrawal.ts`).
 */
export interface StoredVetProduct {
  readonly id: string;
  readonly jurisdiction: string;
  readonly name: string;
  readonly registrationNumber: string | null;
  readonly species: readonly string[];
  /** Meat withdrawal in whole DAYS; null = none. */
  readonly meatWithdrawalDays: number | null;
  /** Milk withdrawal in HOURS — that is how registrations are published; null = none. */
  readonly milkWithdrawalHours: number | null;
  readonly route: string | null;
  /** The day this VERSION's registration took effect. */
  readonly effectiveFrom: string;
  /** The day this VERSION was superseded, or null while it is still current. */
  readonly effectiveTo: string | null;
}

/** The version of `product` that was in force on `day` (a treatment's `administeredOn`, or a
 *  capture screen's own "today"), if this device's cache holds it. Inclusive of `effectiveFrom`,
 *  exclusive of `effectiveTo` — the same boundary the server's own registration query uses. */
export function inForceOn(
  products: readonly StoredVetProduct[],
  day: string,
): readonly StoredVetProduct[] {
  return products.filter(
    (p) => p.effectiveFrom <= day && (p.effectiveTo === null || p.effectiveTo > day),
  );
}

export type VetProductStore = ReferenceCache<StoredVetProduct>;
export type VetProductStoreFactory = (key: string) => VetProductStore;

const defaultFactory: VetProductStoreFactory = (key) =>
  createReferenceCache<StoredVetProduct>({ storage: window.localStorage, key });

const VetProductContext = createContext<VetProductStore | null>(null);

export interface LocalVetProductsProviderProps {
  children: ReactNode;
  factory?: VetProductStoreFactory;
}

export function LocalVetProductsProvider({
  children,
  factory = defaultFactory,
}: LocalVetProductsProviderProps) {
  const { session, activeFarm } = useAuth();
  const farmId = activeFarm?.id ?? 'none';
  const store = useMemo(() => factory(`werf-vet-products:${farmId}`), [factory, farmId]);
  const online = useSyncStatus().status !== 'offline';
  const token = session?.accessToken;

  // Refresh when there is a signal and a farm. A failure is silently tolerated: the device keeps
  // the list it already has, which is the whole point of caching regulated reference data.
  useEffect(() => {
    if (!online || !token || activeFarm === undefined || activeFarm === null) return;
    let cancelled = false;
    void referenceApi
      .listVeterinaryProducts(activeFarm.id, token)
      .then((products) => {
        if (!cancelled) store.replace(products);
      })
      .catch(() => {
        /* An older list is not an error. */
      });
    return () => {
      cancelled = true;
    };
  }, [online, token, activeFarm, store]);

  return <VetProductContext.Provider value={store}>{children}</VetProductContext.Provider>;
}

/** The products this farm may record against, reactive. Empty until the first refresh lands. */
export function useVetProducts(): readonly StoredVetProduct[] {
  const store = useContext(VetProductContext);
  if (!store) throw new Error('useVetProducts must be used inside a LocalVetProductsProvider');
  return useSyncExternalStore(store.subscribe, store.all);
}
