/**
 * The local stock-theft log (FR-603/605) — the incidents a farmer files at a cut fence, offline,
 * read and written through the `@werf/sync` capture-store adapter and never a storage API directly
 * (ADR-0003). Same family as LocalHerd / LocalLifecycle / LocalRainfall: append-only captured facts,
 * reactive, farm-scoped by key, JSON-safe (timestamps are ISO strings, since a `Date` does not
 * round-trip `localStorage` across a cold start).
 *
 * ⛔ FACTS ONLY, and this is not a style note. There is no `suspect` field here and there never will
 * be — a farmer naming a neighbour is a defamation exposure for them and a POPIA s26
 * criminal-behaviour processing exposure for us (legal-compliance.md § 3.2). The store validates
 * every capture through `newTheftIncidentSchema`, which has no such field, so anything of the sort
 * is STRIPPED at this boundary rather than merely discouraged in the UI above it.
 *
 * ⭐ Why a theft incident is a CAPTURE and not an API call, when the evidence pack it feeds is
 * unambiguously server-side: the incident is composed in the exact place and the exact moment the
 * app is least likely to have signal — standing at the fence, at the last-seen point, hours from
 * town. Filing it must commit locally and instantly (NFR-007); only the PDF needs the server, and
 * that is a separate action a farmer takes later, deliberately (see `theftApi.ts`).
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
import { schemas } from '@werf/core';
import { useAuth } from '../auth/AuthProvider';
import { getLocalDatabase } from '../sync/local-db';

/**
 * An incident as held locally. Every timestamp is an ISO string; every optional fact is `null`
 * rather than absent, because that is the shape the wire contract takes and a stored record that
 * matches the contract cannot drift from it.
 */
export interface StoredTheftIncident {
  readonly id: string;
  readonly farmId: string;
  /** ISO 8601. When the loss was DISCOVERED. */
  readonly discoveredAt: string;
  /** ISO 8601. When the stock was LAST SEEN — the anchor of the possession timeline. */
  readonly lastSeenAt: string | null;
  /** The last-seen GPS as GeoJSON. Never PostGIS on the wire, and never on the client at all. */
  readonly lastSeenLocationGeojson: string | null;
  readonly landUnitId: string | null;
  readonly headCount: number;
  /** ZA copy: "SAPS case number". Neutral name (ADR-0006) — often unknown when filing. */
  readonly caseNumber: string | null;
  readonly reportingStation: string | null;
  /** What was FOUND. Facts only. */
  readonly observations: string | null;
  /** The identified animals this incident concerns — the ownership chain the pack proves. */
  readonly animalIds: readonly string[];
}

/** What the screen hands the recorder. The instants are real Dates at this I/O boundary. */
export interface TheftIncidentCapture {
  readonly id: string;
  readonly farmId: string;
  readonly discoveredAt: Date;
  readonly lastSeenAt: Date | null;
  readonly lastSeenLocationGeojson: string | null;
  readonly landUnitId: string | null;
  readonly headCount: number;
  readonly caseNumber: string | null;
  readonly reportingStation: string | null;
  readonly observations: string | null;
  readonly animalIds: readonly string[];
}

export type TheftStore = CaptureStore<StoredTheftIncident>;

/** Injectable so tests can back the log with in-memory storage instead of localStorage. */
export type TheftStoreFactory = (key: string) => TheftStore;

const defaultFactory: TheftStoreFactory = (key) =>
  createSqliteCaptureStore<StoredTheftIncident>({
    database: getLocalDatabase(),
    key,
    legacyStorage: window.localStorage,
  });

const TheftStoreContext = createContext<TheftStore | null>(null);

export interface LocalTheftProviderProps {
  children: ReactNode;
  factory?: TheftStoreFactory;
}

export function LocalTheftProvider({
  children,
  factory = defaultFactory,
}: LocalTheftProviderProps) {
  const { activeFarm } = useAuth();
  const farmId = activeFarm?.id ?? 'none';
  const store = useMemo(() => factory(`werf-theft:${farmId}`), [factory, farmId]);

  return <TheftStoreContext.Provider value={store}>{children}</TheftStoreContext.Provider>;
}

function useTheftStore(): TheftStore {
  const store = useContext(TheftStoreContext);
  if (!store) throw new Error('useTheftStore must be used inside a LocalTheftProvider');
  return store;
}

/** Every filed incident, reactive: this re-renders when one is appended. */
export function useTheftIncidents(): readonly StoredTheftIncident[] {
  const store = useTheftStore();
  return useSyncExternalStore(store.subscribe, store.all);
}

/** Whether this store's initial hydration attempt is over (`CaptureStore.settled()`) — the
 *  Outbox flush must not act on `useTheftIncidents()` until this is true. */
export function useTheftIncidentsSettled(): boolean {
  const store = useTheftStore();
  return useSyncExternalStore(store.subscribe, store.settled);
}

/**
 * File a stock-theft incident locally. Synchronous; never awaits the network (NFR-007).
 *
 * The capture is validated through `newTheftIncidentSchema` — the same schema the server's
 * validation pipe uses — BEFORE it enters the append-only log. That is the point: a record that
 * would be refused on arrival is refused here, where the farmer is still standing in front of the
 * evidence and can fix it, rather than days later in a flush nobody is watching. It is also what
 * structurally enforces the no-suspect contract on the way in.
 */
export function useReportTheft(): (capture: TheftIncidentCapture) => void {
  const store = useTheftStore();
  return useCallback(
    (capture) => {
      const record: StoredTheftIncident = {
        id: capture.id,
        farmId: capture.farmId,
        discoveredAt: capture.discoveredAt.toISOString(),
        lastSeenAt: capture.lastSeenAt === null ? null : capture.lastSeenAt.toISOString(),
        lastSeenLocationGeojson: capture.lastSeenLocationGeojson,
        landUnitId: capture.landUnitId,
        headCount: capture.headCount,
        caseNumber: capture.caseNumber,
        reportingStation: capture.reportingStation,
        observations: capture.observations,
        animalIds: [...capture.animalIds],
      };
      // Throws on a record the server would refuse. Parsed, not just checked — but the PARSED
      // value is deliberately discarded: it carries Dates where the log needs ISO strings, and
      // `record` is already the JSON-safe projection of exactly the fields that passed.
      schemas.newTheftIncidentSchema.parse(record);
      store.append(record);
    },
    [store],
  );
}
