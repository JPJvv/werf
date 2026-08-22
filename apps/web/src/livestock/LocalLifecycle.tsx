/**
 * The local lifecycle log — the client's own copy of everything that happens to the farm's animals:
 * a birth, a weaning, a purchase, a death, a sale, a missing report. Read and written through the
 * `@werf/sync` capture-store adapter, never a storage API directly (ADR-0003). It is one family
 * with `LocalHerd` and `LocalMoves`: append-only captured facts, reactive, farm-scoped by key, and
 * JSON-safe (`occurredAt` is an ISO string, since the event envelope's Date does not round-trip
 * localStorage across a cold start — that conversion lives at this boundary).
 *
 * ⭐ `status` is nullable, and that is the distinction the log is built around. A death, a sale and
 * a missing report MOVE the animal through the status state machine; a birth, a weaning and a
 * purchase are things that happened to an animal that stays exactly as alive as it was. Both are
 * lifecycle facts and both belong in this log — but only the first kind is folded onto the herd by
 * the projection. Modelling the second kind as "status: alive" would work by accident today and
 * break the moment a weaning is recorded on an animal that was already sold: the state machine
 * would refuse a transition nobody asked for.
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
import { createSqliteCaptureStore, type CaptureStore } from '@werf/sync';
import {
  recordBirth,
  recordDeath,
  recordMissing,
  recordPurchase,
  recordSale,
  recordWeaning,
} from '@werf/domain';
import type { AnimalStatus } from '@werf/core';
import { useAuth } from '../auth/AuthProvider';
import { getLocalDatabase } from '../sync/local-db';
import { useCloseCaptureStore } from '../sync/useCloseCaptureStore';

/** Fields every stored lifecycle event carries. `occurredAt` is an ISO string (JSON-safe). */
interface StoredEventBase {
  readonly id: string;
  readonly farmId: string;
  /** The SUBJECT. For a birth this is the dam — the calving belongs on her timeline. */
  readonly animalId: string;
  /** The status this event moves the animal to, or null when it moves nothing. */
  readonly status: AnimalStatus | null;
  /** ISO 8601. When it happened on the farm — read, not synced (CLAUDE.md, § 5). */
  readonly occurredAt: string;
}

/** A death (FR-105) → 'dead'. */
export interface StoredDeath extends StoredEventBase {
  readonly type: 'death';
  readonly status: 'dead';
  readonly cause: string;
  /**
   * Slaughtered for consumption rather than found dead — COMPLIANCE-GATED (FR-131). A flag and not
   * a word inside `cause`, because the withdrawal guard has to be able to read it.
   */
  readonly slaughtered?: boolean;
}

/** A sale (FR-106) → 'sold'. `priceCents` is Money — integer cents, never a float (CLAUDE.md). */
export interface StoredSale extends StoredEventBase {
  readonly type: 'sale';
  readonly status: 'sold';
  readonly counterparty: string;
  readonly priceCents: number;
  readonly weightKg?: number;
}

/** A missing record (FR-605) → 'missing'. The optional point remains farmer-controlled. */
export interface StoredMissing extends StoredEventBase {
  readonly type: 'missing';
  readonly status: 'missing';
  readonly lastSeenGeojson?: string;
  readonly cause?: string;
}

/** A purchase (FR-106) — money in, no status change: the animal arrived alive and stays alive. */
export interface StoredPurchase extends StoredEventBase {
  readonly type: 'purchase';
  readonly status: null;
  readonly counterparty: string;
  readonly priceCents: number;
  readonly weightKg?: number;
}

/** A birth (FR-104), against the DAM. The calf is a separate herd row, named here by id. */
export interface StoredBirth extends StoredEventBase {
  readonly type: 'birth';
  readonly status: null;
  readonly calfId: string;
  readonly easeScore: 1 | 2 | 3 | 4 | 5;
  readonly multiples: number;
  readonly batchId?: string;
  readonly birthWeightKg?: number;
}

/** A weaning (FR-111) — a weight and, if known, an age. No status change. */
export interface StoredWeaning extends StoredEventBase {
  readonly type: 'weaning';
  readonly status: null;
  readonly weightKg: number;
  readonly ageDays?: number;
}

/** A lifecycle event as held locally. */
export type StoredLifecycleEvent =
  StoredDeath | StoredSale | StoredMissing | StoredPurchase | StoredBirth | StoredWeaning;

/** Fields every capture hands the recorder. The capture instant is a real Date at this boundary. */
interface CaptureBase {
  readonly id: string;
  readonly farmId: string;
  readonly animalId: string;
  readonly occurredAt: Date;
  /** The animal's status right now — the FROM side of the transition guard. */
  readonly currentStatus: AnimalStatus;
}

export interface DeathCapture extends CaptureBase {
  readonly cause: string;
  readonly slaughtered?: boolean;
}

export interface SaleCapture extends CaptureBase {
  readonly counterparty: string;
  readonly priceCents: number;
  readonly weightKg?: number;
}

export interface MissingCapture extends CaptureBase {
  readonly lastSeenGeojson?: string;
  readonly cause?: string;
}

export interface PurchaseCapture extends CaptureBase {
  readonly counterparty: string;
  readonly priceCents: number;
  readonly weightKg?: number;
}

export interface BirthCapture extends CaptureBase {
  readonly calfId: string;
  readonly easeScore: 1 | 2 | 3 | 4 | 5;
  readonly multiples: number;
  readonly batchId?: string;
  readonly birthWeightKg?: number;
}

export interface WeaningCapture extends CaptureBase {
  readonly weightKg: number;
  readonly ageDays?: number;
}

export type LifecycleStore = CaptureStore<StoredLifecycleEvent>;

/** Injectable so tests can back the log with in-memory storage instead of localStorage. */
export type LifecycleStoreFactory = (key: string) => LifecycleStore;

const defaultFactory: LifecycleStoreFactory = (key) =>
  createSqliteCaptureStore<StoredLifecycleEvent>({
    database: getLocalDatabase,
    key,
    legacyStorage: window.localStorage,
  });

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
  useCloseCaptureStore(store);

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

/** Whether this store's initial hydration attempt is over (`CaptureStore.settled()`) — the
 *  Outbox flush must not act on `useLifecycleEvents()` until this is true. */
export function useLifecycleEventsSettled(): boolean {
  const store = useLifecycleStore();
  return useSyncExternalStore(store.subscribe, store.settled);
}

/** Whether this store's hydration ATTEMPT ended in a genuine failure
 *  (`CaptureStore.hydrationFailed()`) — the Outbox flush must hold, not treat
 *  `useLifecycleEvents()` as confirmed empty, when this is true. */
export function useLifecycleEventsHydrationFailed(): boolean {
  const store = useLifecycleStore();
  return useSyncExternalStore(store.subscribe, store.hydrationFailed);
}

/** The shared shape every recorder below hands the domain. */
function domainBase(capture: CaptureBase) {
  return {
    id: capture.id,
    farmId: capture.farmId,
    animalId: capture.animalId,
    occurredAt: capture.occurredAt,
    currentStatus: capture.currentStatus,
  };
}

/** The JSON-safe fields every stored event shares. `occurredAt` becomes a string here. */
function storedBase(capture: CaptureBase) {
  return {
    id: capture.id,
    farmId: capture.farmId,
    animalId: capture.animalId,
    occurredAt: capture.occurredAt.toISOString(),
  };
}

/*
 * Each recorder below is written out rather than generated from a shared helper. A generic
 * "validate then project" wrapper was tried and needed a cast to `StoredLifecycleEvent` to compile —
 * which is the cast that would let a projection omit a required field (a weaning with no weight)
 * and have the compiler agree. Six explicit functions are longer and cannot do that.
 *
 * Every one is synchronous and never awaits the network (NFR-007), and every one validates through
 * its pure domain function FIRST — the payload rules and the state-machine guard that an animal
 * cannot be stepped backwards — so a bad capture throws before it can enter the append-only log.
 */

/** Record a death (FR-105) → 'dead', out of the live herd. */
export function useRecordDeath(): (capture: DeathCapture) => Promise<void> {
  const store = useLifecycleStore();
  return useCallback(
    (c) => {
      const slaughtered = c.slaughtered === true ? { slaughtered: true as const } : {};
      recordDeath({ ...domainBase(c), cause: c.cause, ...slaughtered });
      return store.append({
        ...storedBase(c),
        type: 'death',
        status: 'dead',
        cause: c.cause,
        ...slaughtered,
      });
    },
    [store],
  );
}

/** Record a sale (FR-106) → 'sold', out of the live herd. `priceCents` is Money — integer cents. */
export function useRecordSale(): (capture: SaleCapture) => Promise<void> {
  const store = useLifecycleStore();
  return useCallback(
    (c) => {
      const weight = c.weightKg === undefined ? {} : { weightKg: c.weightKg };
      recordSale({
        ...domainBase(c),
        counterparty: c.counterparty,
        priceCents: c.priceCents,
        ...weight,
      });
      return store.append({
        ...storedBase(c),
        type: 'sale',
        status: 'sold',
        counterparty: c.counterparty,
        priceCents: c.priceCents,
        ...weight,
      });
    },
    [store],
  );
}

/** Mark an animal missing (FR-605) → 'missing', with a point when the farmer has one. */
export function useRecordMissing(): (capture: MissingCapture) => Promise<void> {
  const store = useLifecycleStore();
  return useCallback(
    (c) => {
      const cause = c.cause === undefined ? {} : { cause: c.cause };
      const location =
        c.lastSeenGeojson === undefined ? {} : { lastSeenGeojson: c.lastSeenGeojson };
      recordMissing({ ...domainBase(c), ...location, ...cause });
      return store.append({
        ...storedBase(c),
        type: 'missing',
        status: 'missing',
        ...location,
        ...cause,
      });
    },
    [store],
  );
}

/** Record a purchase (FR-106) — money in, no status change. */
export function useRecordPurchase(): (capture: PurchaseCapture) => Promise<void> {
  const store = useLifecycleStore();
  return useCallback(
    (c) => {
      const weight = c.weightKg === undefined ? {} : { weightKg: c.weightKg };
      recordPurchase({
        ...domainBase(c),
        counterparty: c.counterparty,
        priceCents: c.priceCents,
        ...weight,
      });
      return store.append({
        ...storedBase(c),
        type: 'purchase',
        status: null,
        counterparty: c.counterparty,
        priceCents: c.priceCents,
        ...weight,
      });
    },
    [store],
  );
}

/** Record a birth (FR-104) against the dam. The calf's herd row is written separately. */
export function useRecordBirth(): (capture: BirthCapture) => Promise<void> {
  const store = useLifecycleStore();
  return useCallback(
    (c) => {
      const weight = c.birthWeightKg === undefined ? {} : { birthWeightKg: c.birthWeightKg };
      recordBirth({
        ...domainBase(c),
        ...(c.batchId === undefined ? {} : { batchId: c.batchId }),
        calfId: c.calfId,
        easeScore: c.easeScore,
        multiples: c.multiples,
        ...weight,
      });
      return store.append({
        ...storedBase(c),
        type: 'birth',
        status: null,
        calfId: c.calfId,
        easeScore: c.easeScore,
        multiples: c.multiples,
        ...(c.batchId === undefined ? {} : { batchId: c.batchId }),
        ...weight,
      });
    },
    [store],
  );
}

/** Record a weaning (FR-111) — a weight and, if known, an age. No status change. */
export function useRecordWeaning(): (capture: WeaningCapture) => Promise<void> {
  const store = useLifecycleStore();
  return useCallback(
    (c) => {
      const age = c.ageDays === undefined ? {} : { ageDays: c.ageDays };
      recordWeaning({ ...domainBase(c), weightKg: c.weightKg, ...age });
      return store.append({
        ...storedBase(c),
        type: 'weaning',
        status: null,
        weightKg: c.weightKg,
        ...age,
      });
    },
    [store],
  );
}
