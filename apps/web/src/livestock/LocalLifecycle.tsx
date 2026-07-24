/**
 * The local lifecycle log — the client's own copy of the status-changing events on the farm's
 * animals (a death, and later a sale, a cull, a missing report), read and written through the
 * `@werf/sync` capture-store adapter, never a storage API directly (ADR-0003). It is the third
 * store in the same family as `LocalHerd` and `LocalWeights`: append-only captured facts, reactive,
 * farm-scoped by key, and JSON-safe (`occurredAt` is an ISO string, since the event envelope's Date
 * does not round-trip localStorage across a cold start — that conversion lives at this boundary).
 *
 * These are the events the herd projection folds onto the animals to derive each one's CURRENT
 * status (see `herd.ts`): the herd store is append-only and never mutated, so an animal that dies
 * is not edited in place — a death event is appended here, and the projection applies it through the
 * domain status state machine. That is the same append-only, most-final-wins model Phase 3 sync uses.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createCaptureStore, type CaptureStore } from '@werf/sync';
import { recordDeath, recordSale } from '@werf/domain';
import type { AnimalStatus } from '@werf/core';
import { useAuth } from '../auth/AuthProvider';

/** Fields every stored lifecycle event carries. `status` is the status it moves the animal TO;
 *  `occurredAt` is an ISO string (JSON-safe across a cold start). */
interface StoredEventBase {
  readonly id: string;
  readonly farmId: string;
  readonly animalId: string;
  /** The status this event moves the animal to. */
  readonly status: AnimalStatus;
  /** ISO 8601. When it happened on the farm — read, not synced (CLAUDE.md, § 5). */
  readonly occurredAt: string;
}

/** A death (FR-105) → 'dead'. */
export interface StoredDeath extends StoredEventBase {
  readonly type: 'death';
  readonly cause: string;
}

/** A sale (FR-106) → 'sold'. `priceCents` is Money — integer cents, never a float (CLAUDE.md). */
export interface StoredSale extends StoredEventBase {
  readonly type: 'sale';
  readonly counterparty: string;
  readonly priceCents: number;
  readonly weightKg?: number;
}

/** A status-changing lifecycle event as held locally. 'cull' / 'missing' extend the union next. */
export type StoredLifecycleEvent = StoredDeath | StoredSale;

/** What a screen hands the recorder for a death (FR-105). The capture instant is a real Date. */
export interface DeathCapture {
  readonly id: string;
  readonly farmId: string;
  readonly animalId: string;
  readonly occurredAt: Date;
  /** The animal's status right now — the FROM side of the transition guard. */
  readonly currentStatus: AnimalStatus;
  readonly cause: string;
}

/** What a screen hands the recorder for a sale (FR-106). `priceCents` is Money — integer cents. */
export interface SaleCapture {
  readonly id: string;
  readonly farmId: string;
  readonly animalId: string;
  readonly occurredAt: Date;
  readonly currentStatus: AnimalStatus;
  readonly counterparty: string;
  readonly priceCents: number;
  readonly weightKg?: number;
}

export type LifecycleStore = CaptureStore<StoredLifecycleEvent>;

/** Injectable so tests can back the log with in-memory storage instead of localStorage. */
export type LifecycleStoreFactory = (key: string) => LifecycleStore;

const defaultFactory: LifecycleStoreFactory = (key) =>
  createCaptureStore<StoredLifecycleEvent>({ storage: window.localStorage, key });

const LifecycleStoreContext = createContext<LifecycleStore | null>(null);

export interface LocalLifecycleProviderProps {
  children: ReactNode;
  factory?: LifecycleStoreFactory;
}

export function LocalLifecycleProvider({
  children,
  factory = defaultFactory,
}: LocalLifecycleProviderProps) {
  const { activeFarm } = useAuth();
  const farmId = activeFarm?.id ?? 'none';
  const store = useMemo(() => factory(`werf-events:${farmId}`), [factory, farmId]);

  return <LifecycleStoreContext.Provider value={store}>{children}</LifecycleStoreContext.Provider>;
}

function useLifecycleStore(): LifecycleStore {
  const store = useContext(LifecycleStoreContext);
  if (!store) throw new Error('useLifecycleStore must be used inside a LocalLifecycleProvider');
  return store;
}

/** Every lifecycle event, reactive: this re-renders when one is appended. */
export function useLifecycleEvents(): readonly StoredLifecycleEvent[] {
  const store = useLifecycleStore();
  return useSyncExternalStore(store.subscribe, store.all);
}

/**
 * Record a death (FR-105). Synchronous; never awaits the network (NFR-007). The capture is
 * validated through the domain `recordDeath` first — a non-empty cause, and the state-machine
 * guard that an animal cannot be stepped backwards — so a bad capture throws here rather than
 * entering the append-only log; only then is the JSON-safe projection persisted.
 */
export function useRecordDeath(): (capture: DeathCapture) => void {
  const store = useLifecycleStore();
  return useCallback(
    (capture) => {
      recordDeath({
        id: capture.id,
        farmId: capture.farmId,
        animalId: capture.animalId,
        occurredAt: capture.occurredAt,
        currentStatus: capture.currentStatus,
        cause: capture.cause,
      });
      store.append({
        id: capture.id,
        farmId: capture.farmId,
        animalId: capture.animalId,
        type: 'death',
        status: 'dead',
        occurredAt: capture.occurredAt.toISOString(),
        cause: capture.cause,
      });
    },
    [store],
  );
}

/**
 * Record a sale (FR-106) → status 'sold', out of the live herd. Validated through the domain
 * `recordSale` (a buyer, non-negative integer-cents price, the state-machine transition guard)
 * before the JSON-safe projection is persisted. Synchronous; never awaits the network (NFR-007).
 */
export function useRecordSale(): (capture: SaleCapture) => void {
  const store = useLifecycleStore();
  return useCallback(
    (capture) => {
      const weight = capture.weightKg === undefined ? {} : { weightKg: capture.weightKg };
      recordSale({
        id: capture.id,
        farmId: capture.farmId,
        animalId: capture.animalId,
        occurredAt: capture.occurredAt,
        currentStatus: capture.currentStatus,
        counterparty: capture.counterparty,
        priceCents: capture.priceCents,
        ...weight,
      });
      store.append({
        id: capture.id,
        farmId: capture.farmId,
        animalId: capture.animalId,
        type: 'sale',
        status: 'sold',
        occurredAt: capture.occurredAt.toISOString(),
        counterparty: capture.counterparty,
        priceCents: capture.priceCents,
        ...weight,
      });
    },
    [store],
  );
}
