/**
 * Read-only compatibility cache for treatment records created before ADR-0013.
 *
 * Current captures snapshot the farmer-owned inventory product and interval directly, so this
 * cache is never refreshed from an official or jurisdiction list. Keeping already-cached rows lets
 * an upgraded device calculate the same private reminders for legacy events without making a
 * product-register service part of the commercial product.
 */

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { createReferenceCache, type ReferenceCache } from '@werf/sync';
import { useAuth } from '../auth/AuthProvider';

/**
 * A registered product VERSION, as the device holds it — one row per registration, not one per
 * product name. `id` is the specific version a treatment's `productId` points at, and the cache
 * holds every version this farm's jurisdiction has ever had (P1.3, 2026-08-14), not only whichever
 * is in force today: a treatment captured against a since-superseded registration still needs to
 * resolve its own clear date, and the device must be able to tell "this exact version is
 * registered with no withdrawal" apart from "I have no record of this version at all".
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
  const { activeFarm } = useAuth();
  const farmId = activeFarm?.id ?? 'none';
  const store = useMemo(() => factory(`werf-vet-products:${farmId}`), [factory, farmId]);
  return <VetProductContext.Provider value={store}>{children}</VetProductContext.Provider>;
}

/** Legacy cached products for old records. Current capture screens use farm inventory items. */
export function useVetProducts(): readonly StoredVetProduct[] {
  const store = useContext(VetProductContext);
  if (!store) throw new Error('useVetProducts must be used inside a LocalVetProductsProvider');
  return useSyncExternalStore(store.subscribe, store.all);
}
