/**
 * The local identifier register — the tags, EIDs and tattoos the farm's animals carry, read and
 * written through the `@werf/sync` capture-store adapter, never a storage API directly (ADR-0003).
 *
 * Same family as `LocalHerd` and `LocalLifecycle`. What it adds is a LOOKUP: an animal is called by
 * its tag, not by its UUID, so every screen that shows an animal wants to show the number a farmer
 * would read off its ear. That lookup is here rather than in each screen, so "which of an animal's
 * identifiers do we show?" is decided once.
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
import type { schemas } from '@werf/core';
import { useAuth } from '../auth/AuthProvider';
import { getLocalDatabase } from '../sync/local-db';

/** What the register holds: identifiers composed offline with a client UUIDv7 (the `new` shape). */
export type StoredIdentifier = schemas.NewAnimalIdentifier;
export type IdentifierStore = CaptureStore<StoredIdentifier>;

/** Injectable so tests can back the register with in-memory storage instead of localStorage. */
export type IdentifierStoreFactory = (key: string) => IdentifierStore;

const defaultFactory: IdentifierStoreFactory = (key) =>
  createSqliteCaptureStore<StoredIdentifier>({
    database: getLocalDatabase(),
    key,
    legacyStorage: window.localStorage,
  });

const IdentifierStoreContext = createContext<IdentifierStore | null>(null);

export interface LocalIdentifiersProviderProps {
  children: ReactNode;
  factory?: IdentifierStoreFactory;
}

export function LocalIdentifiersProvider({
  children,
  factory = defaultFactory,
}: LocalIdentifiersProviderProps) {
  const { activeFarm } = useAuth();
  const farmId = activeFarm?.id ?? 'none';
  const store = useMemo(() => factory(`werf-identifiers:${farmId}`), [factory, farmId]);

  return (
    <IdentifierStoreContext.Provider value={store}>{children}</IdentifierStoreContext.Provider>
  );
}

function useIdentifierStore(): IdentifierStore {
  const store = useContext(IdentifierStoreContext);
  if (!store) throw new Error('useIdentifierStore must be used inside a LocalIdentifiersProvider');
  return store;
}

/** Every identifier on the farm, reactive: this re-renders when one is captured. */
export function useIdentifiers(): readonly StoredIdentifier[] {
  const store = useIdentifierStore();
  return useSyncExternalStore(store.subscribe, store.all);
}

/** Whether this store's initial hydration attempt is over (`CaptureStore.settled()`) — the
 *  Outbox flush must not act on `useIdentifiers()` until this is true. */
export function useIdentifiersSettled(): boolean {
  const store = useIdentifierStore();
  return useSyncExternalStore(store.subscribe, store.settled);
}

/**
 * The number to CALL each animal by, keyed by animal id.
 *
 * The primary identifier when there is one, else the first captured. Deciding this once, here, is
 * the point: a screen that picked its own rule would show a different number from the next screen,
 * and an animal that answers to two different numbers in one app is worse than one with none.
 */
export function useAnimalLabels(): ReadonlyMap<string, string> {
  const identifiers = useIdentifiers();
  return useMemo(() => {
    const labels = new Map<string, StoredIdentifier>();
    for (const identifier of identifiers) {
      const held = labels.get(identifier.animalId);
      // Primary wins; otherwise first captured stays, so the label does not shuffle as tags are added.
      if (held === undefined || (identifier.isPrimary && !held.isPrimary)) {
        labels.set(identifier.animalId, identifier);
      }
    }
    return new Map([...labels].map(([animalId, identifier]) => [animalId, identifier.value]));
  }, [identifiers]);
}

/** Every identifier value currently on the farm — what a capture screen checks a new tag against. */
export function useTakenValues(): ReadonlySet<string> {
  const identifiers = useIdentifiers();
  return useMemo(
    () => new Set(identifiers.map((identifier) => identifier.value.trim().toLowerCase())),
    [identifiers],
  );
}

/** Commit an identifier to the local register. Synchronous; never awaits the network (NFR-007). */
export function useRecordIdentifier(): (identifier: StoredIdentifier) => void {
  const store = useIdentifierStore();
  return useCallback((identifier) => store.append(identifier), [store]);
}
