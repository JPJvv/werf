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
 * The gestation for one species, or `undefined` when the device has no figure for it — either
 * because nothing has synced yet, or because the species genuinely has none (see the header).
 *
 * ⭐ The two cases are deliberately NOT distinguished here, because the screen's answer is the same
 * for both: show no projected date. Claiming "we don't have a figure yet" when the truth is "there
 * is no such figure" would promise a farmer a date that is never coming.
 */
export function useGestationDays(species: string | undefined): number | undefined {
  const figures = useSpeciesGestation();
  if (species === undefined) return undefined;
  return figures.find((f) => f.species === species)?.gestationDays;
}
