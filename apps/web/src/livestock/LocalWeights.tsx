/**
 * The local weight log — the client's own copy of the farm's weight readings, read and written
 * through the `@werf/sync` capture-store adapter, never a storage API directly (ADR-0003). It is
 * the events twin of `LocalHerd`: append-only captured facts, reactive so a read moves the instant
 * a weigh lands, and farm-scoped by key so one farm's readings never surface on another's.
 *
 * A reading is stored JSON-safe on purpose. The domain `weight` event carries a `Date`
 * `occurredAt`, which does NOT round-trip `localStorage` cleanly (JSON writes it as a string and a
 * cold start reads it back as a string, not a Date). So the persisted `StoredWeight` holds an ISO
 * string, and the Date⇄string conversion lives at this boundary — the same conversion the Phase 3
 * sync-ingestion path will own for the real event envelope. `recordWeight` (@werf/domain) is still
 * the single rule that validates a capture; this seam only decides how the validated fact is held.
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
import { recordWeight, type WeightMethod } from '@werf/domain';
import { useAuth } from '../auth/AuthProvider';
import { getLocalDatabase } from '../sync/local-db';

/** A weight reading as held locally. `occurredAt` is an ISO string (JSON-safe across a cold start). */
export interface StoredWeight {
  readonly id: string;
  readonly farmId: string;
  /** This slice weighs individual animals from the herd; a mob weigh (FR-140) is a later screen. */
  readonly animalId: string;
  readonly kg: number;
  readonly method: WeightMethod;
  /** ISO 8601. When the animal stepped on the scale — read, not synced (CLAUDE.md, § 5). */
  readonly occurredAt: string;
}

/** What a screen hands the recorder: the capture instant is a real Date, read at this I/O boundary. */
export interface WeightCapture {
  readonly id: string;
  readonly farmId: string;
  readonly animalId: string;
  readonly occurredAt: Date;
  readonly kg: number;
  readonly method: WeightMethod;
}

export type WeightStore = CaptureStore<StoredWeight>;

/** Injectable so tests can back the log with in-memory storage instead of localStorage. */
export type WeightStoreFactory = (key: string) => WeightStore;

const defaultFactory: WeightStoreFactory = (key) =>
  createSqliteCaptureStore<StoredWeight>({
    database: getLocalDatabase(),
    key,
    legacyStorage: window.localStorage,
  });

const WeightStoreContext = createContext<WeightStore | null>(null);

export interface LocalWeightsProviderProps {
  children: ReactNode;
  factory?: WeightStoreFactory;
}

export function LocalWeightsProvider({
  children,
  factory = defaultFactory,
}: LocalWeightsProviderProps) {
  const { activeFarm } = useAuth();
  const farmId = activeFarm?.id ?? 'none';
  const store = useMemo(() => factory(`werf-weights:${farmId}`), [factory, farmId]);

  return <WeightStoreContext.Provider value={store}>{children}</WeightStoreContext.Provider>;
}

function useWeightStore(): WeightStore {
  const store = useContext(WeightStoreContext);
  if (!store) throw new Error('useWeightStore must be used inside a LocalWeightsProvider');
  return store;
}

/** Every reading, reactive: this re-renders when a weigh is appended. */
export function useWeights(): readonly StoredWeight[] {
  const store = useWeightStore();
  return useSyncExternalStore(store.subscribe, store.all);
}

/** Whether this store's initial hydration attempt is over (`CaptureStore.settled()`) — the
 *  Outbox flush must not act on `useWeights()` until this is true. */
export function useWeightsSettled(): boolean {
  const store = useWeightStore();
  return useSyncExternalStore(store.subscribe, store.settled);
}

/** The readings for one animal, in capture order. */
export function useAnimalWeights(animalId: string): readonly StoredWeight[] {
  const all = useWeights();
  return useMemo(() => all.filter((w) => w.animalId === animalId), [all, animalId]);
}

/**
 * Commit a weight to the local log. Synchronous; never awaits the network (NFR-007). The capture
 * is validated through the domain rule first — exactly-one subject, a positive kg, a known method —
 * so a bad reading throws here rather than entering the append-only log; only then is the JSON-safe
 * projection persisted.
 */
export function useRecordWeight(): (capture: WeightCapture) => void {
  const store = useWeightStore();
  return useCallback(
    (capture) => {
      recordWeight({
        id: capture.id,
        farmId: capture.farmId,
        animalId: capture.animalId,
        occurredAt: capture.occurredAt,
        kg: capture.kg,
        method: capture.method,
      });
      store.append({
        id: capture.id,
        farmId: capture.farmId,
        animalId: capture.animalId,
        kg: capture.kg,
        method: capture.method,
        occurredAt: capture.occurredAt.toISOString(),
      });
    },
    [store],
  );
}
