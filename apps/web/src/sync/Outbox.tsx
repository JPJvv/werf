/**
 * The outbox — the best-effort flush that carries offline captures up to the server (Phase 2).
 *
 * This is the seam that finally runs the two halves of the product together: the capture screens
 * write to the local stores with no network in the path, and THIS sends what they hold once there
 * is a signal. It is the Phase-2 stand-in for the PowerSync uploader; when the real replication
 * engine lands in Phase 3 the stores and screens above this do not change — the flush is simply
 * done by PowerSync instead of by hand against the `apps/api` capture endpoints.
 *
 * Three rules shape it, all from .claude/rules/db.md and the offline-first promise:
 *
 *  1. The queue is NEVER discarded. A record leaves "pending" only when the server has CONFIRMED
 *     it (its id joins the sent-log). A failed, refused, or interrupted flush leaves everything
 *     else pending and untouched; nothing is dropped to make an error go away.
 *  2. The queue is ordered by the FOREIGN KEY graph, not by when things were captured. Land units
 *     first (an animal can carry `land_unit_id`), then animals, then the events that reference
 *     them; sending a child before its parent fails against a row the server has never seen.
 *  3. Sending is idempotent and at-least-once. A 201 lost on the way home is retried on the next
 *     reconnect; every endpoint is a no-op on a re-send, so a retry never duplicates a row.
 *
 * The status it publishes is the honest one a farmer needs (FR-009): offline / N to send / sending
 * / not sent. "Not sent — will retry" is shown only when the server actually refused; a dropped
 * signal mid-flush is not an error, it is simply back to pending.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createSentLog, type SentLog } from '@werf/sync';
import { useAuth } from '../auth/AuthProvider';
import { AuthApiError, NetworkUnavailableError } from '../auth/api';
import { useLandUnits } from '../land/LocalLand';
import { landApi } from '../land/landApi';
import { useAnimals } from '../livestock/LocalHerd';
import { useIdentifiers } from '../livestock/LocalIdentifiers';
import { useWeights } from '../livestock/LocalWeights';
import { useLifecycleEvents } from '../livestock/LocalLifecycle';
import { livestockApi } from '../livestock/livestockApi';
import { useRainfall } from '../rainfall/LocalRainfall';
import { rainfallApi } from '../rainfall/rainfallApi';
import { useSyncStatus, type SyncState } from './useSyncStatus';

/** One queued capture: its id (for the sent-log) and how to send it with a given access token. */
interface FlushItem {
  readonly id: string;
  readonly send: (token: string) => Promise<void>;
}

/** Injectable so tests can back the sent-log with in-memory storage instead of localStorage. */
export type SentLogFactory = (key: string) => SentLog;

const defaultSentLogFactory: SentLogFactory = (key) =>
  createSentLog({ storage: window.localStorage, key });

/** The published save/send state. Null outside a provider, so consumers fall back to connectivity. */
const OutboxContext = createContext<SyncState | null>(null);

export interface OutboxProviderProps {
  children: ReactNode;
  factory?: SentLogFactory;
}

export function OutboxProvider({ children, factory = defaultSentLogFactory }: OutboxProviderProps) {
  const { session, activeFarm, refreshSession } = useAuth();
  const landUnits = useLandUnits();
  const animals = useAnimals();
  const identifiers = useIdentifiers();
  const weights = useWeights();
  const events = useLifecycleEvents();
  const rainfall = useRainfall();

  // Connectivity is the same signal the strip has always used; the outbox layers send-state on top.
  const online = useSyncStatus().status !== 'offline';

  // The sent-log is farm-scoped by key, exactly like the stores it shadows: one farm's send-state
  // never counts against another's pending total.
  const farmId = activeFarm?.id ?? 'none';
  const sentLog = useMemo(() => factory(`werf-sent:${farmId}`), [factory, farmId]);
  const sent = useSyncExternalStore(sentLog.subscribe, sentLog.all);

  // The pending queue, in send order: animals first (the FK root), then the events that point at
  // them. A record is pending until its id is confirmed in the sent-log.
  const queue = useMemo<readonly FlushItem[]>(() => {
    const items: FlushItem[] = [];
    // Land goes before animals: a herd row can carry `land_unit_id`, so an animal that arrived
    // ahead of its camp would fail the foreign key against ground the server has never seen. Same
    // rule as animals-before-events, one level further up the graph.
    for (const unit of landUnits) {
      if (!sent.has(unit.id)) {
        items.push({ id: unit.id, send: (token) => landApi.createLandUnit(unit, token) });
      }
    }
    for (const animal of animals) {
      if (!sent.has(animal.id)) {
        items.push({ id: animal.id, send: (token) => livestockApi.createAnimal(animal, token) });
      }
    }
    // Identifiers reference `animals(id)`, so they follow the animals and precede nothing.
    for (const identifier of identifiers) {
      if (!sent.has(identifier.id)) {
        items.push({
          id: identifier.id,
          send: (token) => livestockApi.createIdentifier(identifier, token),
        });
      }
    }
    for (const weight of weights) {
      if (!sent.has(weight.id)) {
        items.push({ id: weight.id, send: (token) => livestockApi.recordWeight(weight, token) });
      }
    }
    for (const event of events) {
      if (sent.has(event.id)) continue;
      items.push(
        event.type === 'sale'
          ? { id: event.id, send: (token) => livestockApi.recordSale(event, token) }
          : { id: event.id, send: (token) => livestockApi.recordDeath(event, token) },
      );
    }
    // Rainfall references no animal, so it has no place in the FK ordering above — it can go last.
    for (const reading of rainfall) {
      if (!sent.has(reading.id)) {
        items.push({
          id: reading.id,
          send: (token) => rainfallApi.recordRainfall(reading, token),
        });
      }
    }
    return items;
  }, [landUnits, animals, identifiers, weights, events, rainfall, sent]);
  const pendingCount = queue.length;

  const [flushing, setFlushing] = useState(false);
  const [errored, setErrored] = useState(false);

  // Refs the async flush reads for its latest view, without being re-created on every render.
  const tokenRef = useRef<string | undefined>(session?.accessToken);
  tokenRef.current = session?.accessToken;
  const queueRef = useRef<readonly FlushItem[]>(queue);
  queueRef.current = queue;
  const flushingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const flush = useCallback(async () => {
    if (flushingRef.current || !online) return;
    let token = tokenRef.current;
    if (!token) return;
    const items = queueRef.current;
    if (items.length === 0) return;

    flushingRef.current = true;
    setFlushing(true);
    setErrored(false);
    try {
      for (const item of items) {
        if (!mountedRef.current) return;
        if (sentLog.has(item.id)) continue; // sent earlier this round
        try {
          await item.send(token);
          sentLog.add(item.id);
        } catch (err) {
          if (err instanceof AuthApiError && err.status === 401) {
            // The access token expired while we were offline. Spend the refresh token once and
            // retry THIS item; a genuine auth failure gives up the round, leaving it pending.
            const fresh = await refreshSession().catch(() => null);
            if (!fresh) {
              if (mountedRef.current) setErrored(true);
              return;
            }
            token = fresh;
            tokenRef.current = fresh;
            try {
              await item.send(fresh);
              sentLog.add(item.id);
            } catch {
              if (mountedRef.current) setErrored(true);
              return;
            }
          } else if (err instanceof NetworkUnavailableError) {
            // The signal dropped mid-flush. Not an error to show — everything unsent stays
            // pending and the next reconnect picks up where we left off.
            return;
          } else {
            // The server refused the capture (validation, tenancy, a 500). Surface it; the
            // record is NOT marked sent, so it will be retried.
            if (mountedRef.current) setErrored(true);
            return;
          }
        }
      }
    } finally {
      flushingRef.current = false;
      if (mountedRef.current) setFlushing(false);
    }
  }, [online, sentLog, refreshSession]);

  // Flush whenever there is something to send and a way to send it. `pendingCount` in the deps
  // makes a new capture (or a reconnect) trigger a fresh attempt; a server error does not change
  // the deps, so a stuck queue does not spin — it waits for the next capture or reconnect.
  useEffect(() => {
    if (online && pendingCount > 0) void flush();
  }, [online, pendingCount, flush]);

  const state = useMemo<SyncState>(() => {
    const status: SyncState['status'] = !online
      ? 'offline'
      : flushing
        ? 'syncing'
        : errored && pendingCount > 0
          ? 'error'
          : pendingCount > 0
            ? 'pending'
            : 'synced';
    return { status, pendingCount };
  }, [online, flushing, errored, pendingCount]);

  return <OutboxContext.Provider value={state}>{children}</OutboxContext.Provider>;
}

/**
 * The save/send state for the sync-status strip. Inside an `OutboxProvider` this is the real
 * outbox state (pending count, sending, not-sent); rendered on its own — as the strip's unit test
 * does — it falls back to plain connectivity, so the strip works with or without the outbox.
 */
export function useSyncState(): SyncState {
  const outbox = useContext(OutboxContext);
  const connectivity = useSyncStatus();
  return outbox ?? connectivity;
}
