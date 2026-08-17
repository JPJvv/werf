/**
 * The device's copy of the chemical-product register (FR-204/FR-508) — regulated REFERENCE data,
 * cached so that selecting a product, and previewing the earliest safe harvest date, both work at
 * the spray tank with no signal. Mirrors `LocalVetProducts.tsx` exactly, one reference table over —
 * see that file's header for the three rules this store follows (opportunistic refresh, farm-scoped
 * by jurisdiction, and NOT authoritative: the PHI actually STORED is resolved server-side at
 * capture from the registration in force on the spray day, ADR-0005).
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
import { referenceApi } from '../livestock/referenceApi';

/** A registered product VERSION, as the device holds it — one row per registration, the same
 *  "every version this farm's jurisdiction has ever had" discipline (P1.3) `StoredVetProduct`
 *  documents, for the identical reason: a spray captured against a since-superseded registration
 *  must still resolve the PHI that applied on the day it happened. */
export interface StoredChemicalProduct {
  readonly id: string;
  readonly jurisdiction: string;
  readonly name: string;
  readonly registrationNumber: string;
  readonly crop: string | null;
  /** Pre-harvest interval in whole DAYS; null = none on record. */
  readonly phiDays: number | null;
  readonly reentryHours: number | null;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}

/** The version of `products` that was in force on `day` (a spray's `sprayedOn`, or a capture
 *  screen's own "today"), if this device's cache holds it. Same inclusive/exclusive boundary
 *  `inForceOn` (`LocalVetProducts.tsx`) uses. */
export function chemicalProductsInForceOn(
  products: readonly StoredChemicalProduct[],
  day: string,
): readonly StoredChemicalProduct[] {
  return products.filter(
    (p) => p.effectiveFrom <= day && (p.effectiveTo === null || p.effectiveTo > day),
  );
}

export type ChemicalProductStore = ReferenceCache<StoredChemicalProduct>;
export type ChemicalProductStoreFactory = (key: string) => ChemicalProductStore;

const defaultFactory: ChemicalProductStoreFactory = (key) =>
  createReferenceCache<StoredChemicalProduct>({ storage: window.localStorage, key });

const ChemicalProductContext = createContext<ChemicalProductStore | null>(null);

export interface LocalChemicalProductsProviderProps {
  children: ReactNode;
  factory?: ChemicalProductStoreFactory;
}

export function LocalChemicalProductsProvider({
  children,
  factory = defaultFactory,
}: LocalChemicalProductsProviderProps) {
  const { session, activeFarm } = useAuth();
  const farmId = activeFarm?.id ?? 'none';
  const store = useMemo(() => factory(`werf-chemical-products:${farmId}`), [factory, farmId]);
  const online = useSyncStatus().status !== 'offline';
  const token = session?.accessToken;

  useEffect(() => {
    if (!online || !token || activeFarm === undefined || activeFarm === null) return;
    let cancelled = false;
    void referenceApi
      .listChemicalProducts(activeFarm.id, token)
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

  return (
    <ChemicalProductContext.Provider value={store}>{children}</ChemicalProductContext.Provider>
  );
}

/** The products this farm may spray against, reactive. Empty until the first refresh lands. */
export function useChemicalProducts(): readonly StoredChemicalProduct[] {
  const store = useContext(ChemicalProductContext);
  if (!store) {
    throw new Error('useChemicalProducts must be used inside a LocalChemicalProductsProvider');
  }
  return useSyncExternalStore(store.subscribe, store.all);
}
