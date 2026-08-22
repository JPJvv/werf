/**
 * The device's private health log: treatments, vaccinations and dips. Each event keeps the farm
 * product identity and farmer-entered facts as a snapshot, so a later edit does not rewrite history.
 * Health events live separately because they do not change herd status and contain sensitive data.
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
import { useCloseCaptureStore } from '../sync/useCloseCaptureStore';

/** Which of the three health captures this is. Each posts to its own endpoint. */
export type HealthKind = 'treatment' | 'vaccination' | 'dip';

/**
 * How a dip was applied (FR-133), taken FROM the event payload schema rather than written out here.
 *
 * It used to be a hand-written union, and it had drifted: it offered `'injectable'`, which the dip
 * payload does not accept and the server would have refused on the wire. Nothing ever hit it only
 * because the field was not on any screen yet — the moment it appeared, a plausible-looking choice
 * would have queued a capture that could never be sent. Deriving the type is the rule in CLAUDE.md
 * for exactly this reason: a schema and a duplicate of it drift silently and in one direction.
 */
export type DipMethod = NonNullable<schemas.DipPayload['method']>;

/** A health event as held locally, including the farmer-entered product snapshot used for reminders. */
export interface StoredHealthEvent {
  readonly id: string;
  readonly farmId: string;
  /**
   * ⭐ The subject is an animal XOR a mob, exactly as the wire contract has always been. A plunge
   * dip is the canonical whole-flock operation and a group-only flock has no `animals` rows at all,
   * so an animal-only local log could not record the dose the smallholder path is built around —
   * and the group reminder on `AdjustMobScreen` had nothing to read.
   *
   * `mobId` is optional rather than required so records already in a device's register stay
   * readable: they are animal-subject, which is what an absent `mobId` means.
   */
  readonly animalId: string | null;
  readonly mobId?: string | null;
  readonly kind: HealthKind;
  /** ISO 8601 instant it was captured on the farm. */
  readonly occurredAt: string;
  /** The farm-local treatment DAY (YYYY-MM-DD) the withdrawal arithmetic is based on. */
  readonly administeredOn: string;
  /** The farm-owned medicine item and the label facts the farmer entered. */
  readonly productId: string;
  readonly productName?: string;
  readonly registrationNumber?: string | null;
  readonly meatWithdrawalDays?: number | null;
  readonly milkWithdrawalHours?: number | null;
  /** Ties one dosing run across many animals together as the single action it was (FR-112). */
  readonly batchId: string | null;
  /** How much was given, and in what — 20, "ml". A treatment only (FR-130). */
  readonly doseValue?: number;
  readonly doseUnit?: string;
  /** How it went in (FR-130). Derived from the treatment payload so the vocabulary cannot drift. */
  readonly route?: schemas.TreatmentRoute;
  readonly administeredBy?: string;
  readonly reason?: string;
  readonly programme?: string;
  /** How the dip was applied (FR-133). A dip only. */
  readonly method?: DipMethod;
}

export type HealthStore = CaptureStore<StoredHealthEvent>;
export type HealthStoreFactory = (key: string) => HealthStore;

const defaultFactory: HealthStoreFactory = (key) =>
  createSqliteCaptureStore<StoredHealthEvent>({
    database: getLocalDatabase,
    key,
    legacyStorage: window.localStorage,
  });

const HealthStoreContext = createContext<HealthStore | null>(null);

export interface LocalHealthProviderProps {
  children: ReactNode;
  factory?: HealthStoreFactory;
}

export function LocalHealthProvider({
  children,
  factory = defaultFactory,
}: LocalHealthProviderProps) {
  const { activeFarm } = useAuth();
  const farmId = activeFarm?.id ?? 'none';
  const store = useMemo(() => factory(`werf-health:${farmId}`), [factory, farmId]);
  useCloseCaptureStore(store);

  return <HealthStoreContext.Provider value={store}>{children}</HealthStoreContext.Provider>;
}

function useHealthStore(): HealthStore {
  const store = useContext(HealthStoreContext);
  if (!store) throw new Error('useHealthEvents must be used inside a LocalHealthProvider');
  return store;
}

/** Every health event on the farm, reactive. */
export function useHealthEvents(): readonly StoredHealthEvent[] {
  const store = useHealthStore();
  return useSyncExternalStore(store.subscribe, store.all);
}

/** Whether this store's initial hydration attempt is over (`CaptureStore.settled()`) — the
 *  Outbox flush must not act on `useHealthEvents()` until this is true. */
export function useHealthEventsSettled(): boolean {
  const store = useHealthStore();
  return useSyncExternalStore(store.subscribe, store.settled);
}

/** Whether this store's hydration ATTEMPT ended in a genuine failure
 *  (`CaptureStore.hydrationFailed()`) — the Outbox flush must hold, not treat
 *  `useHealthEvents()` as confirmed empty, when this is true. A failed health-events hydration
 *  is the sharpest case there is: it is what the FR-131 disposal guard reads to decide whether a
 *  slaughter/sale must be held behind a dose this device cannot currently verify. */
export function useHealthEventsHydrationFailed(): boolean {
  const store = useHealthStore();
  return useSyncExternalStore(store.subscribe, store.hydrationFailed);
}

/**
 * Record one health event per animal in a dosing run, under ONE batch id (FR-112). Synchronous;
 * never awaits the network (NFR-007). A dosing run is a batch by nature — nobody doses one animal
 * and walks away — so the group is the unit here and a single animal is a group of one.
 */
export function useRecordHealth(): (events: readonly StoredHealthEvent[]) => Promise<void> {
  const store = useHealthStore();
  return useCallback(
    async (events) => {
      await Promise.all(events.map((event) => store.append(event)));
    },
    [store],
  );
}
