/**
 * The local breeding log (FR-120/121) — matings/services and pregnancy diagnoses, as the device
 * holds them. Both are filed against the DAM and neither changes her status, so like health events
 * they live in their own store rather than being folded onto the herd.
 *
 * ⭐ What is NOT stored here is the same shape as `LocalHealth`, and for the same reason. A stored
 * pregnancy diagnosis carries the SERVICE DATE and never the due date, because the due date is
 * projected from `species_gestation` — reference data the server owns — and written onto the event
 * there (FR-121, ADR-0005). A client that sent a due date could assert a calving date nothing on
 * the server can check, into the field a calving report is planned from; a client that STORED one
 * would freeze today's cached gestation figure into a record that outlives it. The screen SHOWS a
 * projected date from the cached figures so the farmer sees it standing in the race — that is a
 * preview, and it is the server's number that is kept.
 *
 * The two captures share a store rather than having one each because they share a subject, a farm
 * key and a lifetime, and because `kind` routes them to their endpoints the same way `HealthKind`
 * does — a new kind added here without an endpoint fails the typecheck rather than being posted to
 * the wrong path.
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
import type { schemas } from '@werf/core';
import { useAuth } from '../auth/AuthProvider';

/**
 * The vocabularies come FROM the payload schemas rather than being written out again here. A
 * hand-written duplicate of a schema drifts silently and in one direction: the client offers a
 * value the server refuses, and the capture it queues can never be sent — which reads as a sync
 * bug rather than as the typo it is (CLAUDE.md; it has already happened once, to the dip method).
 */
export type MatingMethod = schemas.MatingPayload['method'];
export type PregnancyMethod = schemas.PregnancyTestPayload['method'];
export type PregnancyResult = schemas.PregnancyTestPayload['result'];

/** Fields both breeding captures carry. `animalId` is the DAM whose timeline the event sits on. */
interface StoredBreedingBase {
  readonly id: string;
  readonly farmId: string;
  /** The dam. */
  readonly animalId: string;
  /** ISO 8601 instant it was captured on the farm. */
  readonly occurredAt: string;
}

/**
 * A mating / service (FR-120).
 *
 * The sire is either an animal on this farm (`sireId`) or an external bull / AI straw named by
 * code (`sireCode`), and BOTH are optional. An extensive herd running a bull with the cows often
 * cannot say which cow he served on which day — that is what `bullInAt`/`bullOutAt` are for. The
 * service is then a WINDOW, and recording it as a guessed day would fabricate a precision the
 * farmer never had.
 */
export interface StoredMating extends StoredBreedingBase {
  readonly kind: 'mating';
  readonly method: MatingMethod;
  readonly sireId?: string;
  readonly sireCode?: string;
  /** A running-bull period (YYYY-MM-DD), farm-local days — a window, never an instant. */
  readonly bullInAt?: string;
  readonly bullOutAt?: string;
}

/**
 * A pregnancy diagnosis (FR-121). No due date — see the module header.
 *
 * `matingDate` is optional because a diagnosis is a fact whether or not the service date is known.
 * Without it there is no due date, which is honest: a positive test on a cow of unknown service
 * date tells you she is in calf and genuinely does not tell you when.
 */
export interface StoredPregnancyTest extends StoredBreedingBase {
  readonly kind: 'pregnancyTest';
  readonly method: PregnancyMethod;
  readonly result: PregnancyResult;
  /** The farm-local service day (YYYY-MM-DD) the server projects the due date from. */
  readonly matingDate?: string;
}

export type StoredBreedingEvent = StoredMating | StoredPregnancyTest;

export type BreedingStore = CaptureStore<StoredBreedingEvent>;
export type BreedingStoreFactory = (key: string) => BreedingStore;

const defaultFactory: BreedingStoreFactory = (key) =>
  createCaptureStore<StoredBreedingEvent>({ storage: window.localStorage, key });

const BreedingStoreContext = createContext<BreedingStore | null>(null);

export interface LocalBreedingProviderProps {
  children: ReactNode;
  factory?: BreedingStoreFactory;
}

export function LocalBreedingProvider({
  children,
  factory = defaultFactory,
}: LocalBreedingProviderProps) {
  const { activeFarm } = useAuth();
  const farmId = activeFarm?.id ?? 'none';
  const store = useMemo(() => factory(`werf-breeding:${farmId}`), [factory, farmId]);

  return <BreedingStoreContext.Provider value={store}>{children}</BreedingStoreContext.Provider>;
}

function useBreedingStore(): BreedingStore {
  const store = useContext(BreedingStoreContext);
  if (!store) throw new Error('useBreedingEvents must be used inside a LocalBreedingProvider');
  return store;
}

/** Every breeding event on the farm, reactive. */
export function useBreedingEvents(): readonly StoredBreedingEvent[] {
  const store = useBreedingStore();
  return useSyncExternalStore(store.subscribe, store.all);
}

/**
 * Record one breeding capture. Synchronous; never awaits the network (NFR-007).
 *
 * Unlike a dosing run this is one animal at a time by nature — a cow is served, or a cow is
 * tested — so there is no batch here and adding one would be inventing a grouping the work does
 * not have.
 */
export function useRecordBreeding(): (event: StoredBreedingEvent) => void {
  const store = useBreedingStore();
  return useCallback(
    (event) => {
      store.append(event);
    },
    [store],
  );
}
