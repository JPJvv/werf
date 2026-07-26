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
import { useMobs } from '../livestock/LocalMobs';
import { useIdentifiers } from '../livestock/LocalIdentifiers';
import { useWeights } from '../livestock/LocalWeights';
import { useLifecycleEvents, type StoredLifecycleEvent } from '../livestock/LocalLifecycle';
import { useMoves } from '../livestock/LocalMoves';
import { useHealthEvents } from '../livestock/LocalHealth';
import { livestockApi } from '../livestock/livestockApi';
import { useRainfall } from '../rainfall/LocalRainfall';
import { rainfallApi } from '../rainfall/rainfallApi';
import { useSyncStatus, type SyncState } from './useSyncStatus';

/**
 * Send one lifecycle event to its own endpoint. The switch is exhaustive on the union, so adding a
 * new event type to the local log without an endpoint here is a compile error — the alternative, an
 * if/else with a default arm, would quietly post a weaning to /deaths.
 */
function sendLifecycleEvent(event: StoredLifecycleEvent, token: string): Promise<void> {
  switch (event.type) {
    case 'death':
      return livestockApi.recordDeath(event, token);
    case 'sale':
      return livestockApi.recordSale(event, token);
    case 'missing':
      return livestockApi.recordMissing(event, token);
    case 'purchase':
      return livestockApi.recordPurchase(event, token);
    case 'birth':
      return livestockApi.recordBirth(event, token);
    case 'weaning':
      return livestockApi.recordWeaning(event, token);
  }
}

/**
 * Did the server refuse this capture on its MERITS, or did it merely fail to handle it?
 *
 * A 4xx is the server saying "this record is not acceptable" — the identical request gets the
 * identical answer tomorrow, so the item is set aside rather than allowed to hold the queue. The
 * three exceptions are the 4xx codes that mean "ask again later": 401 is handled by the refresh
 * path above this, and 408/429 are transient by definition.
 *
 * Anything that is not an `AuthApiError` at all — a parse failure, a bug in a `send` — is treated
 * as transient. The asymmetry is deliberate: calling a transient failure permanent sets a record
 * aside that the server never refused, while calling a permanent failure transient costs one
 * wasted request per round. Only one of those loses a farmer's work.
 */
function isRefusal(err: unknown): boolean {
  if (!(err instanceof AuthApiError)) return false;
  if (err.status === 401 || err.status === 408 || err.status === 429) return false;
  return err.status >= 400 && err.status < 500;
}

/** Keeps the previous set's identity when nothing changed, so subscribers do not re-render. */
function replaceIfChanged(
  previous: ReadonlySet<string>,
  next: ReadonlySet<string>,
): ReadonlySet<string> {
  if (previous.size === next.size && [...next].every((id) => previous.has(id))) return previous;
  return next;
}

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
  const mobs = useMobs();
  const animals = useAnimals();
  const identifiers = useIdentifiers();
  const weights = useWeights();
  const events = useLifecycleEvents();
  const moves = useMoves();
  const health = useHealthEvents();
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
    // A mob sits between the two: it can carry `land_unit_id`, and an animal can carry `mob_id`.
    for (const mob of mobs) {
      if (!sent.has(mob.id)) {
        items.push({ id: mob.id, send: (token) => livestockApi.createMob(mob, token) });
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
    // One entry per lifecycle event TYPE. Exhaustive by construction rather than by an
    // if/else with a default arm: a new event type added to the store without an endpoint here
    // fails the typecheck instead of being silently posted to /deaths.
    for (const event of events) {
      if (sent.has(event.id)) continue;
      items.push({ id: event.id, send: (token) => sendLifecycleEvent(event, token) });
    }
    // Moves reference an animal AND its destination camp/mob, so they come after all three.
    for (const move of moves) {
      if (!sent.has(move.id)) {
        items.push({ id: move.id, send: (token) => livestockApi.recordMove(move, token) });
      }
    }
    // Health events reference an animal, so they follow the animals like every other event.
    for (const event of health) {
      if (!sent.has(event.id)) {
        items.push({ id: event.id, send: (token) => livestockApi.recordHealth(event, token) });
      }
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
  }, [landUnits, mobs, animals, identifiers, weights, events, moves, health, rainfall, sent]);
  const pendingCount = queue.length;

  const [flushing, setFlushing] = useState(false);
  const [errored, setErrored] = useState(false);
  // Captures the server REFUSED on their merits, by id. Held in memory only, and deliberately:
  // a refusal is a fact about one attempt, not about the record, so it is re-tested on every
  // round and on every cold start. One that was only situationally invalid — a move whose
  // destination camp had not been sent yet — heals itself the moment the cause clears.
  const [refused, setRefused] = useState<ReadonlySet<string>>(() => new Set());

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
    // Rebuilt from scratch each round rather than added to: a capture refused last time gets a
    // genuine second hearing, so the set never accumulates a stale refusal.
    const refusedThisRound = new Set<string>();
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
            } catch (retryErr) {
              if (isRefusal(retryErr)) {
                refusedThisRound.add(item.id);
                continue;
              }
              if (mountedRef.current) setErrored(true);
              return;
            }
          } else if (err instanceof NetworkUnavailableError) {
            // The signal dropped mid-flush. Not an error to show — everything unsent stays
            // pending and the next reconnect picks up where we left off.
            return;
          } else if (isRefusal(err)) {
            // The server refused THIS capture on its merits — a tag number already live on
            // another animal, a camp code a second device used the same week, a sale inside a
            // withdrawal period. Retrying it unchanged refuses it again, forever.
            //
            // So it is set aside, NOT dropped: `continue`, not `return`. The record stays in its
            // append-only store and stays out of the sent-log, because the queue is never
            // discarded by the system (.claude/rules/db.md) — but it no longer holds the rest of
            // the farmer's work hostage behind it. Sixty tags captured in a crush must not be
            // stranded by one misread digit, which is exactly what returning here did: the queue
            // rebuilds in the same FK order every round, so the poison item was always first and
            // nothing behind it could ever be sent again.
            refusedThisRound.add(item.id);
            continue;
          } else {
            // A 5xx, or something we do not recognise. Transient by assumption — give up the
            // round and leave everything pending, exactly as a dropped signal does.
            if (mountedRef.current) setErrored(true);
            return;
          }
        }
      }
    } finally {
      flushingRef.current = false;
      if (mountedRef.current) {
        setFlushing(false);
        // Committed in `finally` so an aborted round still reports what it managed to learn.
        setRefused((previous) => replaceIfChanged(previous, refusedThisRound));
      }
    }
  }, [online, sentLog, refreshSession]);

  // Flush whenever there is something to send and a way to send it. `pendingCount` in the deps
  // makes a new capture (or a reconnect) trigger a fresh attempt; a server error does not change
  // the deps, so a stuck queue does not spin — it waits for the next capture or reconnect.
  useEffect(() => {
    if (online && pendingCount > 0) void flush();
  }, [online, pendingCount, flush]);

  // Only refusals that are still queued count. One the farmer resolved another way — or that the
  // server accepted on a later round — leaves the queue and stops being reported.
  const blockedCount = useMemo(
    () => queue.reduce((total, item) => (refused.has(item.id) ? total + 1 : total), 0),
    [queue, refused],
  );

  const state = useMemo<SyncState>(() => {
    const status: SyncState['status'] = !online
      ? 'offline'
      : flushing
        ? 'syncing'
        : (errored || blockedCount > 0) && pendingCount > 0
          ? 'error'
          : pendingCount > 0
            ? 'pending'
            : 'synced';
    return { status, pendingCount, blockedCount };
  }, [online, flushing, errored, pendingCount, blockedCount]);

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
