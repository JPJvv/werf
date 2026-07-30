/**
 * The device's copy of the species gestation figures (FR-121) — the reference data a projected
 * calving date is computed from, cached so that the projection appears in a race with no signal.
 *
 * It is the second INBOUND cache in the app and follows `LocalVetProducts`'s three rules exactly:
 * refreshed opportunistically and read unconditionally, farm-keyed like every other store, and NOT
 * authoritative — the date a screen shows from these rows is a preview for the farmer standing at
 * the gate; the date that is STORED is projected server-side at capture (ADR-0005, FR-121). Which
 * is why the gestation period never crosses the wire on a capture, only the service date does.
 *
 * ⭐ It differs from the product register in one way that matters. There is no jurisdiction and no
 * effective date, because this is biology rather than law: a gestation period neither stops at a
 * border nor changes on a day a Gazette names. `source` travels with the figure because a farmer
 * shown a projected calving date is entitled to the "says who?", and a provenance that stays on
 * the server is one nobody can check.
 *
 * ⛔ A SPECIES WITH NO ROW IS THE FEATURE, not a gap. A hen does not gestate — 21 days is
 * incubation, a different event this product does not model — and `game` is a category, not a
 * species: a springbok and a kudu are a hundred days apart, so any single figure would be wrong
 * for most of the animals it was read for. The screens read that absence and stop offering a
 * projection rather than inventing one, which is the same discipline as a missing regulated rate.
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

/** A species gestation figure, as the device holds it. */
export interface StoredSpeciesGestation {
  /** Matches `SPECIES` in @werf/core. One row per species — never a version history. */
  readonly species: string;
  /** The species mean, in whole days. A projection, not a promise: breeds vary by ~10 days. */
  readonly gestationDays: number;
  /** Where the figure comes from, so a later reader can check it rather than trust it. */
  readonly source: string;
}

export type SpeciesGestationStore = ReferenceCache<StoredSpeciesGestation>;
export type SpeciesGestationStoreFactory = (key: string) => SpeciesGestationStore;

const defaultFactory: SpeciesGestationStoreFactory = (key) =>
  createReferenceCache<StoredSpeciesGestation>({ storage: window.localStorage, key });

const SpeciesGestationContext = createContext<SpeciesGestationStore | null>(null);

export interface LocalSpeciesGestationProviderProps {
  children: ReactNode;
  factory?: SpeciesGestationStoreFactory;
}

export function LocalSpeciesGestationProvider({
  children,
  factory = defaultFactory,
}: LocalSpeciesGestationProviderProps) {
  const { session, activeFarm } = useAuth();
  const farmId = activeFarm?.id ?? 'none';
  const store = useMemo(() => factory(`werf-species-gestation:${farmId}`), [factory, farmId]);
  const online = useSyncStatus().status !== 'offline';
  const token = session?.accessToken;

  // Refresh when there is a signal and a farm. A failure is silently tolerated: the device keeps
  // the figures it already has, which is the entire point of caching reference data.
  useEffect(() => {
    if (!online || !token || activeFarm === undefined || activeFarm === null) return;
    let cancelled = false;
    void referenceApi
      .listSpeciesGestation(activeFarm.id, token)
      .then((figures) => {
        if (!cancelled) store.replace(figures);
      })
      .catch(() => {
        /* An older list is not an error. */
      });
    return () => {
      cancelled = true;
    };
  }, [online, token, activeFarm, store]);

  return (
    <SpeciesGestationContext.Provider value={store}>{children}</SpeciesGestationContext.Provider>
  );
}

/** The gestation figures this device holds, reactive. Empty until the first refresh lands. */
export function useSpeciesGestation(): readonly StoredSpeciesGestation[] {
  const store = useContext(SpeciesGestationContext);
  if (!store) {
    throw new Error('useSpeciesGestation must be used inside a LocalSpeciesGestationProvider');
  }
  return useSyncExternalStore(store.subscribe, store.all);
}

/**
 * The gestation lookup for one species. The two ABSENCES are different facts and the screen owes the
 * farmer different answers:
 *
 *  - `known`       — a figure is on the device; a date can be projected.
 *  - `noSuchFigure`— the cache is populated but has no row for this species. Biology, not a gap:
 *                    poultry does not gestate, `game` is a category (see the header). No date, ever.
 *  - `notSynced`   — the cache is EMPTY. The figure exists on the server and has simply not reached
 *                    this phone. Telling a cattle farmer "cattle have no carrying period" here is a
 *                    lie the cold start would tell on every first run.
 *
 * The migration seeds several species, so an empty cache is only ever the cold-start case — the same
 * distinction `health.noProducts` already draws for the veterinary product register. Merging the two
 * (the old behaviour) claimed "there is no such figure" whenever nothing had synced yet.
 */
export type GestationLookup =
  | { readonly status: 'known'; readonly gestationDays: number }
  | { readonly status: 'noSuchFigure' }
  | { readonly status: 'notSynced' };

export function useGestationDays(species: string | undefined): GestationLookup {
  const figures = useSpeciesGestation();
  const found = species === undefined ? undefined : figures.find((f) => f.species === species);
  if (found !== undefined) return { status: 'known', gestationDays: found.gestationDays };
  return figures.length === 0 ? { status: 'notSynced' } : { status: 'noSuchFigure' };
}
