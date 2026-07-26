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
import { useAnimalLabels, useIdentifiers } from '../livestock/LocalIdentifiers';
import { useWeights } from '../livestock/LocalWeights';
import { useLifecycleEvents, type StoredLifecycleEvent } from '../livestock/LocalLifecycle';
import { useMoves } from '../livestock/LocalMoves';
import { useHealthEvents } from '../livestock/LocalHealth';
import { useTheftIncidents } from '../livestock/LocalTheft';
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

/** Why the server refused one capture: its stable code and the HTTP status it came back on. */
interface RefusalReason {
  readonly code: string;
  readonly status: number;
}

/**
 * The server's own account of a refusal. `isRefusal` has already established this is an
 * `AuthApiError`; the fallback exists so a future caller cannot make this throw.
 */
function reasonOf(err: unknown): RefusalReason {
  return err instanceof AuthApiError
    ? { code: err.code, status: err.status }
    : { code: 'UNKNOWN', status: 0 };
}

/** Keeps the previous map's identity when nothing changed, so subscribers do not re-render. */
function replaceIfChanged(
  previous: ReadonlyMap<string, RefusalReason>,
  next: ReadonlyMap<string, RefusalReason>,
): ReadonlyMap<string, RefusalReason> {
  if (
    previous.size === next.size &&
    [...next].every(([id, reason]) => previous.get(id)?.code === reason.code)
  ) {
    return previous;
  }
  return next;
}

/**
 * What KIND of thing a queued capture is, in the farmer's terms rather than the table's.
 *
 * It exists so a refusal can be named. "One capture was not accepted" is a sentence that tells
 * someone their work is stuck and gives them nothing to do about it; "Tag number 0417 — that
 * number is already on another animal" is one they can act on in the crush.
 */
export type CaptureKind =
  | 'landUnit'
  | 'mob'
  | 'animal'
  | 'identifier'
  | 'weight'
  | 'lifecycle'
  | 'move'
  | 'health'
  | 'theft'
  | 'rainfall';

/** One queued capture: its id (for the sent-log), what it is, and how to send it. */
interface FlushItem {
  readonly id: string;
  readonly kind: CaptureKind;
  /**
   * What this one is CALLED, if it has a name a farmer would recognise — a tag number, a camp
   * name. Null when there is nothing to say beyond the kind, which is honest: inventing "Weight
   * #3" would be a label the farmer has never seen anywhere else in the product.
   */
  readonly detail: string | null;
  readonly send: (token: string) => Promise<void>;
}

/** A capture the server refused on its merits, with enough to tell the farmer what and why. */
export interface RefusedCapture {
  readonly id: string;
  readonly kind: CaptureKind;
  readonly detail: string | null;
  /** The server's stable error code — branched on, never string-matched against its message. */
  readonly code: string;
  readonly status: number;
}

/** Injectable so tests can back the sent-log with in-memory storage instead of localStorage. */
export type SentLogFactory = (key: string) => SentLog;

const defaultSentLogFactory: SentLogFactory = (key) =>
  createSentLog({ storage: window.localStorage, key });

/** The published save/send state. Null outside a provider, so consumers fall back to connectivity. */
const OutboxContext = createContext<SyncState | null>(null);

/**
 * The ids the server has CONFIRMED it stored.
 *
 * Published because a handful of actions are only meaningful once the server has the record — the
 * stock-theft evidence pack most of all, since the PDF is rendered from the rows the server holds
 * and there is nothing to render before then. A screen that reads this can say "this incident has
 * not reached us yet" instead of offering a button that 404s and reads as the app being broken.
 *
 * Deliberately NOT a general "is this saved?" signal. A capture is SAVED the moment it is in its
 * local store — that is the whole promise (FR-009) — and nothing in the product should gate a
 * farmer's own view of their own work on this set. It gates one thing: asking the server to
 * produce a document.
 *
 * An empty set outside a provider is the safe default: it withholds the action, never invents it.
 */
const EMPTY_SENT: ReadonlySet<string> = new Set();
const SentCapturesContext = createContext<ReadonlySet<string>>(EMPTY_SENT);

/** The captures the server refused, with enough for a screen to say what and why. */
const EMPTY_REFUSED: readonly RefusedCapture[] = [];
const RefusedCapturesContext = createContext<readonly RefusedCapture[]>(EMPTY_REFUSED);

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
  // What each animal is CALLED. Read here purely so a refused capture can be named by the number
  // on the animal's ear rather than by a uuid the farmer has never seen.
  const labels = useAnimalLabels();
  const weights = useWeights();
  const events = useLifecycleEvents();
  const moves = useMoves();
  const health = useHealthEvents();
  const theftIncidents = useTheftIncidents();
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
        items.push({
          id: unit.id,
          kind: 'landUnit',
          detail: unit.name,
          send: (token) => landApi.createLandUnit(unit, token),
        });
      }
    }
    // A mob sits between the two: it can carry `land_unit_id`, and an animal can carry `mob_id`.
    for (const mob of mobs) {
      if (!sent.has(mob.id)) {
        items.push({
          id: mob.id,
          kind: 'mob',
          detail: mob.name,
          send: (token) => livestockApi.createMob(mob, token),
        });
      }
    }
    for (const animal of animals) {
      if (!sent.has(animal.id)) {
        items.push({
          id: animal.id,
          kind: 'animal',
          detail: labels.get(animal.id) ?? null,
          send: (token) => livestockApi.createAnimal(animal, token),
        });
      }
    }
    // Identifiers reference `animals(id)`, so they follow the animals and precede nothing.
    for (const identifier of identifiers) {
      if (!sent.has(identifier.id)) {
        items.push({
          id: identifier.id,
          kind: 'identifier',
          // The number itself, which is the whole point: a duplicate tag is the commonest refusal
          // in the product, and the fix is to read the number off the animal again.
          detail: identifier.value,
          send: (token) => livestockApi.createIdentifier(identifier, token),
        });
      }
    }
    for (const weight of weights) {
      if (!sent.has(weight.id)) {
        items.push({
          id: weight.id,
          kind: 'weight',
          detail: labels.get(weight.animalId) ?? null,
          send: (token) => livestockApi.recordWeight(weight, token),
        });
      }
    }
    // One entry per lifecycle event TYPE. Exhaustive by construction rather than by an
    // if/else with a default arm: a new event type added to the store without an endpoint here
    // fails the typecheck instead of being silently posted to /deaths.
    for (const event of events) {
      if (sent.has(event.id)) continue;
      items.push({
        id: event.id,
        kind: 'lifecycle',
        detail: labels.get(event.animalId) ?? null,
        send: (token) => sendLifecycleEvent(event, token),
      });
    }
    // Moves reference an animal AND its destination camp/mob, so they come after all three.
    for (const move of moves) {
      if (!sent.has(move.id)) {
        items.push({
          id: move.id,
          kind: 'move',
          detail: labels.get(move.animalId) ?? null,
          send: (token) => livestockApi.recordMove(move, token),
        });
      }
    }
    // Health events reference an animal, so they follow the animals like every other event.
    for (const event of health) {
      if (!sent.has(event.id)) {
        items.push({
          id: event.id,
          kind: 'health',
          detail: labels.get(event.animalId) ?? null,
          send: (token) => livestockApi.recordHealth(event, token),
        });
      }
    }
    // A theft incident points at a camp AND at the animals it concerns, so it comes after both.
    // Its evidence pack cannot be generated until it has been through here, which is why the
    // incidents screen reads the sent-set below rather than offering a button that would 404.
    for (const incident of theftIncidents) {
      if (!sent.has(incident.id)) {
        items.push({
          id: incident.id,
          kind: 'theft',
          detail: null,
          send: (token) => livestockApi.createTheftIncident(incident, token),
        });
      }
    }
    // Rainfall references no animal, so it has no place in the FK ordering above — it can go last.
    for (const reading of rainfall) {
      if (!sent.has(reading.id)) {
        items.push({
          id: reading.id,
          kind: 'rainfall',
          detail: null,
          send: (token) => rainfallApi.recordRainfall(reading, token),
        });
      }
    }
    return items;
  }, [
    landUnits,
    mobs,
    animals,
    identifiers,
    weights,
    events,
    moves,
    health,
    theftIncidents,
    rainfall,
    sent,
  ]);
  const pendingCount = queue.length;

  const [flushing, setFlushing] = useState(false);
  const [errored, setErrored] = useState(false);
  // Captures the server REFUSED on their merits, keyed by id and carrying the server's own error
  // code so the farmer can be told WHY, not only that. Held in memory only, and deliberately: a
  // refusal is a fact about one attempt, not about the record, so it is re-tested on every round
  // and on every cold start. One that was only situationally invalid — a move whose destination
  // camp had not been sent yet — heals itself the moment the cause clears.
  const [refused, setRefused] = useState<ReadonlyMap<string, RefusalReason>>(() => new Map());

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
    const refusedThisRound = new Map<string, RefusalReason>();
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
                refusedThisRound.set(item.id, reasonOf(retryErr));
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
            refusedThisRound.set(item.id, reasonOf(err));
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
  //
  // Derived from the QUEUE rather than from the refusal map, so the order a farmer reads is the
  // order the flush attempts, and a refusal whose record has left the queue simply disappears.
  const blocked = useMemo<readonly RefusedCapture[]>(
    () =>
      queue.flatMap((item) => {
        const reason = refused.get(item.id);
        return reason === undefined
          ? []
          : [{ id: item.id, kind: item.kind, detail: item.detail, ...reason }];
      }),
    [queue, refused],
  );
  const blockedCount = blocked.length;

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

  return (
    <OutboxContext.Provider value={state}>
      <SentCapturesContext.Provider value={sent}>
        <RefusedCapturesContext.Provider value={blocked}>
          {children}
        </RefusedCapturesContext.Provider>
      </SentCapturesContext.Provider>
    </OutboxContext.Provider>
  );
}

/**
 * The ids the server has confirmed. See `SentCapturesContext` for what this may and may not gate.
 * Outside an `OutboxProvider` this is empty, which withholds the server-dependent action rather
 * than offering one that cannot work.
 */
export function useSentCaptures(): ReadonlySet<string> {
  return useContext(SentCapturesContext);
}

/**
 * The captures the server refused, in queue order. Empty outside an `OutboxProvider`.
 *
 * The strip has been able to say "N need your attention" since the flush stopped stranding the
 * queue behind a refusal — and until now there was nowhere to go and see WHICH capture or WHY,
 * which is half an answer. This is the other half.
 */
export function useRefusedCaptures(): readonly RefusedCapture[] {
  return useContext(RefusedCapturesContext);
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
