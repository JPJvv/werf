/**
 * The local rainfall log — the farm's gauge readings, read and written through the `@werf/sync`
 * capture-store adapter, never a storage API directly (ADR-0003). Same family as LocalHerd /
 * LocalWeights / LocalLifecycle: append-only captured facts, reactive so a read moves the instant a
 * reading lands, and farm-scoped by key so one farm's rain never surfaces on another's.
 *
 * It sits in its own folder rather than under `livestock/` because rain is a FARM fact — grazing
 * rest/rotation and cropping both read it (FR-213). A reading is stored JSON-safe for the same
 * reason weights are: a `Date` does not round-trip `localStorage`, so `occurredAt` is held as an ISO
 * string and the Date⇄string conversion lives at this boundary.
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
import { recordRainfall } from '@werf/domain';
import { useAuth } from '../auth/AuthProvider';
import { getLocalDatabase } from '../sync/local-db';
import { useCloseCaptureStore } from '../sync/useCloseCaptureStore';

/** A gauge reading as held locally. `occurredAt` is an ISO string (JSON-safe across a cold start). */
export interface StoredRainfall {
  readonly id: string;
  readonly farmId: string;
  /** Millimetres in the gauge. Zero is a real reading (FR-213) — a dry gauge is data. */
  readonly mm: number;
  /** Which gauge, on a farm that reads more than one. */
  readonly gauge?: string;
  /** ISO 8601. When the gauge was READ on the farm — what a report uses, not when it was sent. */
  readonly occurredAt: string;
}

/** What the screen hands the recorder: the reading instant is a real Date at this I/O boundary. */
export interface RainfallCapture {
  readonly id: string;
  readonly farmId: string;
  readonly occurredAt: Date;
  readonly mm: number;
  readonly gauge?: string;
}

export type RainfallStore = CaptureStore<StoredRainfall>;

/** Injectable so tests can back the log with in-memory storage instead of localStorage. */
export type RainfallStoreFactory = (key: string) => RainfallStore;

const defaultFactory: RainfallStoreFactory = (key) =>
  createSqliteCaptureStore<StoredRainfall>({
    database: getLocalDatabase(),
    key,
    legacyStorage: window.localStorage,
  });

const RainfallStoreContext = createContext<RainfallStore | null>(null);

export interface LocalRainfallProviderProps {
  children: ReactNode;
  factory?: RainfallStoreFactory;
}

export function LocalRainfallProvider({
  children,
  factory = defaultFactory,
}: LocalRainfallProviderProps) {
  const { activeFarm } = useAuth();
  const farmId = activeFarm?.id ?? 'none';
  const store = useMemo(() => factory(`werf-rainfall:${farmId}`), [factory, farmId]);
  useCloseCaptureStore(store);

  return <RainfallStoreContext.Provider value={store}>{children}</RainfallStoreContext.Provider>;
}

function useRainfallStore(): RainfallStore {
  const store = useContext(RainfallStoreContext);
  if (!store) throw new Error('useRainfallStore must be used inside a LocalRainfallProvider');
  return store;
}

/** Every reading, reactive: this re-renders when a reading is appended. */
export function useRainfall(): readonly StoredRainfall[] {
  const store = useRainfallStore();
  return useSyncExternalStore(store.subscribe, store.all);
}

/** Whether this store's initial hydration attempt is over (`CaptureStore.settled()`) — the
 *  Outbox flush must not act on `useRainfall()` until this is true. */
export function useRainfallSettled(): boolean {
  const store = useRainfallStore();
  return useSyncExternalStore(store.subscribe, store.settled);
}

/** Whether this store's hydration ATTEMPT ended in a genuine failure
 *  (`CaptureStore.hydrationFailed()`) — the Outbox flush must hold, not treat `useRainfall()` as
 *  confirmed empty, when this is true. */
export function useRainfallHydrationFailed(): boolean {
  const store = useRainfallStore();
  return useSyncExternalStore(store.subscribe, store.hydrationFailed);
}

/**
 * Commit a gauge reading to the local log. Synchronous; never awaits the network (NFR-007). The
 * capture is validated through the domain rule first — a millimetre reading of zero or more — so a
 * bad reading throws here rather than entering the append-only log; only then is the JSON-safe
 * projection persisted.
 */
export function useRecordRainfall(): (capture: RainfallCapture) => void {
  const store = useRainfallStore();
  return useCallback(
    (capture) => {
      recordRainfall({
        id: capture.id,
        farmId: capture.farmId,
        occurredAt: capture.occurredAt,
        mm: capture.mm,
        ...(capture.gauge === undefined ? {} : { gauge: capture.gauge }),
      });
      store.append({
        id: capture.id,
        farmId: capture.farmId,
        mm: capture.mm,
        occurredAt: capture.occurredAt.toISOString(),
        ...(capture.gauge === undefined ? {} : { gauge: capture.gauge }),
      });
    },
    [store],
  );
}

/**
 * The season's rainfall so far, in millimetres (FR-213, read side).
 *
 * The SEASON, not the calendar year. A South African summer-rainfall season runs from July: rain
 * that fell in December and rain that fell in February belong to the same season, and splitting
 * them at 1 January would cut every season in half exactly where the comparison matters. The
 * boundary is a farming fact, not a regulated one, so it lives here rather than in reference data.
 *
 * Summed on `occurredAt` — the day the gauge was READ — never on when the row was captured. A
 * fortnight of readings entered on one evening after a trip to town must land in the days they
 * happened, which is the entire reason the capture screen asks for the day.
 */
const SEASON_START_MONTH = 7; // July

export function seasonStart(on: Date): string {
  const year = on.getUTCFullYear();
  const month = on.getUTCMonth() + 1;
  return `${month >= SEASON_START_MONTH ? year : year - 1}-07-01`;
}

export function useSeasonRainfall(on: Date = new Date()): number {
  const readings = useRainfall();
  return useMemo(() => {
    const from = seasonStart(on);
    return readings
      .filter((r) => r.occurredAt.slice(0, 10) >= from)
      .reduce((total, r) => total + r.mm, 0);
  }, [readings, on]);
}
