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
import { schemas } from '@werf/core';
// The SAME fold the server runs, which is the point: the outbox asks whether a decrease would
// underflow using the projection `deriveHeadCount` uses, not an approximation of it.
import { projectHeadCount } from '@werf/domain';
import { createSentLog, type SentLog } from '@werf/sync';
import { useAuth } from '../auth/AuthProvider';
import { AuthApiError, NetworkUnavailableError } from '../auth/api';
import {
  useBoundaryWalks,
  useBoundaryWalksSettled,
  useLandUnits,
  useLandUnitsSettled,
} from '../land/LocalLand';
import { landApi } from '../land/landApi';
import { useAnimals, useAnimalsSettled } from '../livestock/LocalHerd';
import { useMobs, useMobsSettled } from '../livestock/LocalMobs';
import { useTallies, useTalliesSettled, type StoredTally } from '../livestock/LocalTallies';
import {
  useAnimalLabels,
  useIdentifiers,
  useIdentifiersSettled,
} from '../livestock/LocalIdentifiers';
import { useWeights, useWeightsSettled } from '../livestock/LocalWeights';
import {
  useLifecycleEvents,
  useLifecycleEventsSettled,
  type StoredLifecycleEvent,
} from '../livestock/LocalLifecycle';
import { useMoves, useMovesSettled } from '../livestock/LocalMoves';
import { animalDisposalSubjects, mobDisposalSubjects } from '../livestock/withdrawal';
import { farmDay } from '../farmTime';
import { useHealthEvents, useHealthEventsSettled } from '../livestock/LocalHealth';
import { useBreedingEvents, useBreedingEventsSettled } from '../livestock/LocalBreeding';
import { useTheftIncidents, useTheftIncidentsSettled } from '../livestock/LocalTheft';
import { livestockApi } from '../livestock/livestockApi';
import { useRainfall, useRainfallSettled } from '../rainfall/LocalRainfall';
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

/** The same identity-preserving swap for the held set: a round that changes nothing re-renders
 *  nothing. Compared by membership, which is all a set carries. */
function replaceSetIfChanged(
  previous: ReadonlySet<string>,
  next: ReadonlySet<string>,
): ReadonlySet<string> {
  if (previous.size === next.size && [...next].every((id) => previous.has(id))) return previous;
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
  | 'boundaryWalk'
  | 'mob'
  | 'tally'
  | 'animal'
  | 'identifier'
  | 'weight'
  | 'lifecycle'
  | 'move'
  | 'health'
  | 'breeding'
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
  /**
   * The subjects this item ESTABLISHES for something later in the queue: a move settles where an
   * animal is, a dose settles what a mob or animal was given, a departure settles that head left,
   * a mob row settles that the mob exists at all. If this item is set aside on a refusal — or held
   * — every later item that reads one of these subjects must be HELD too, or the act lands without
   * the thing it depended on.
   *
   * ⭐ Not only "evidence a server-side guard reads", and not only animal and mob ids. It also
   * carries batch ids and `mobrow:` subjects, and the failure mode differs per namespace: a
   * missing dose returns 201 for meat inside a withholding, a missing arrival corrupts a head
   * count, a missing mob row earns a 404 per capture behind it.
   */
  readonly provides?: readonly string[];
  /**
   * The subjects this item is judged against. When one of them was tainted by a refused or held
   * item earlier in the same round, this item is held back — left pending, not refused — so the
   * next round can send it once the dependency lands or the farmer resolves the refusal.
   *
   * ⭐ No longer "the subjects a DISPOSAL is judged against". A `sale` is judged against a
   * withholding; a `transfer_in` is judged against its own departure; every tally is judged
   * against whether the server has the mob row at all. The union is ordinary now.
   */
  readonly guardedBy?: readonly string[];
  /**
   * ⭐ Whether this capture would take out head the server does not yet have — asked as ARITHMETIC
   * rather than as a subject, because that is what the server asks.
   *
   * `landed(id)` answers "will the server hold this capture when this item is sent": everything
   * accepted in an earlier round plus everything sent earlier in this one. The item computes the
   * same fold the server computes, over the same cut, and reports whether it would underflow.
   *
   * A subject could only say "something this mob's count depends on did not land", which held
   * captures the server would have accepted — see the note at the tally's own `guardedBy`. The
   * question is not whether an increase is missing; it is whether THIS decrease is short.
   */
  readonly needsHead?: (landed: (id: string) => boolean) => boolean;
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

/**
 * A tally that brings head IN carrying a withholding with it — the third source of one (§2.3b),
 * after a dose given here and a dose given to an animal elsewhere in its history.
 *
 * An UNDECLARED purchase is deliberately not one. It claims nothing in either direction: inventing a
 * period would be a fabricated regulated number and assuming clear would be the laundering the
 * declaration exists to stop. It carries no WITHHOLDING, so it holds no disposal back.
 *
 * ⛔ It said "it is not evidence, so it holds nothing back", which was briefly false: while head
 * availability was a subject, every increase — undeclared purchases included — provided it and so
 * held departures back. Head availability is arithmetic again (`needsHead`), so this is true once
 * more, and stated narrowly this time. A purchase still contributes head to the fold, which is a
 * different sentence from holding something back.
 */
const arrivesWithheld = (tally: StoredTally): boolean =>
  tally.reason === 'transfer_in' ||
  (tally.reason === 'purchase' && tally.declaredWithdrawalUntil !== undefined);

/**
 * Which of TWO passes a tally is sent in: everything that is not a food-chain disposal, then the
 * disposals. A total function rather than filters, so a reason added later cannot fall out.
 *
 *   0. Everything else — births, purchases, deaths, recounts, and BOTH halves of a move — kept in
 *      CAPTURE ORDER by the stable sort.
 *   1. Food-chain disposals (`sale`, `slaughter`).
 *
 * ⭐ This replaces a THREE-pass order (departures → arrivals → rest) that `d0dd571` introduced and
 * that was a regression, found by `sync-auditor`. Lifting departures above everything broke chains:
 * move 40 A→B then 20 B→C in one offline session, and `out_B` was posted before `in_B` had landed,
 * so the server folded B's log, saw no head, and refused with *"There are 0 head on file in this
 * group… count the group and record what you find."* A perfectly valid capture, refused — and the
 * `/not-sent` copy tells the farmer to record it again, which turns a transient ordering artefact
 * into a permanent double-move. `reviewer` found the same shape with an increase: a birth of 20
 * captured before a transfer of 110 out of a 100-head flock.
 *
 * ⭐ CAPTURE ORDER IS CAUSAL, which is why preserving it is the fix rather than a compromise. A
 * farmer cannot transfer head they have not yet recorded arriving — the device's OWN fold refuses
 * that at capture (`canSave`), so anything that funds a departure was necessarily captured before
 * it. Departures likewise precede their own arrivals because `AdjustMobScreen.save()` writes the
 * two halves in that order, which `AdjustMob.test.tsx` pins.
 *
 * The one thing capture order does NOT give is arrivals before disposals, and that is what pass 1
 * is for: a slaughter recorded on Tuesday and a BACK-DATED transfer recorded on Wednesday arrive in
 * that order, so the disposal would otherwise reach a server that has never heard of the withholding
 * walking in with the head. That was `6ae9dfa`'s finding and it stays closed.
 */
const tallyPass = (tally: StoredTally): number =>
  tally.reason === 'sale' || tally.reason === 'slaughter' ? 1 : 0;

/**
 * The send order for tallies: `tallyPass`, then capture order — with ONE guarantee made explicit
 * instead of inherited, because inheriting it is how the chain bug got in.
 *
 * ⭐ Within a batch, the DEPARTURE is emitted immediately before its ARRIVAL. `AdjustMobScreen`
 * already writes them that way, so in practice this changes nothing; but the reason the departure
 * must go first is a correctness rule — a refused departure has to taint the batch before the
 * arrival is attempted, or the destination gains head that never left anywhere — and a correctness
 * rule that holds only because another file happens to write in a convenient order is one refactor
 * away from being wrong. It is stated here, where it is relied on.
 *
 * ⛔ It pulls the departure FORWARD to just before its own arrival; it never pushes departures to
 * the front of the queue. That distinction is the whole fix: hoisting every departure is exactly
 * what broke a chained A→B→C move, because `out_B` then overtook the `in_B` that funded it.
 */
function orderTallies(tallies: readonly StoredTally[]): readonly StoredTally[] {
  const ordered = [...tallies].sort((a, b) => tallyPass(a) - tallyPass(b));
  const result: StoredTally[] = [];
  const emitted = new Set<string>();

  for (const tally of ordered) {
    if (emitted.has(tally.id)) continue;
    if (tally.reason === 'transfer_in' && tally.batchId !== undefined) {
      // Its own half, if the store happens to hold it later than the arrival. Already emitted in
      // the ordinary case, so this is a no-op on every queue the product itself produces.
      const departure = ordered.find(
        (t) => t.reason === 'transfer_out' && t.batchId === tally.batchId && !emitted.has(t.id),
      );
      if (departure !== undefined) {
        result.push(departure);
        emitted.add(departure.id);
      }
    }
    result.push(tally);
    emitted.add(tally.id);
  }
  return result;
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
 * local store — that is the whole promise (FR-009) — and nothing in the product should GATE a
 * farmer's own view of their own work on this set.
 *
 * Two readers, and the rule that separates them is gating versus labelling:
 *   • the stock-theft pack GATES on it — the PDF is rendered from rows the server holds, so there
 *     is nothing to render before then, and the screen says so instead of offering a button that
 *     404s;
 *   • `/attention` LABELS with it — "not sent yet" versus "sent, flagged from what this phone
 *     holds". It never withholds a row, and an empty set falls back to the more cautious sentence.
 *
 * (This paragraph said "it gates one thing" for one session after the second reader landed —
 * `6abb6cf`. The premise-outlived-comment class, in the file that keeps collecting it.)
 *
 * An empty set outside a provider is the safe default: it withholds the action, never invents it.
 */
const EMPTY_SENT: ReadonlySet<string> = new Set();
const SentCapturesContext = createContext<ReadonlySet<string>>(EMPTY_SENT);

/** The captures the server refused, with enough for a screen to say what and why. */
const EMPTY_REFUSED: readonly RefusedCapture[] = [];
const RefusedCapturesContext = createContext<readonly RefusedCapture[]>(EMPTY_REFUSED);

/** The captures HELD behind one of those refusals — waiting, not rejected. */
const HeldCapturesContext = createContext<readonly RefusedCapture[]>(EMPTY_REFUSED);

export interface OutboxProviderProps {
  children: ReactNode;
  factory?: SentLogFactory;
}

export function OutboxProvider({ children, factory = defaultSentLogFactory }: OutboxProviderProps) {
  const { session, activeFarm, refreshSession } = useAuth();
  const landUnits = useLandUnits();
  const boundaryWalks = useBoundaryWalks();
  const mobs = useMobs();
  const tallies = useTallies();
  const animals = useAnimals();
  const identifiers = useIdentifiers();
  // What each animal is CALLED. Read here purely so a refused capture can be named by the number
  // on the animal's ear rather than by a uuid the farmer has never seen.
  const labels = useAnimalLabels();
  const weights = useWeights();
  const events = useLifecycleEvents();
  const moves = useMoves();
  const health = useHealthEvents();
  const breeding = useBreedingEvents();
  const theftIncidents = useTheftIncidents();
  const rainfall = useRainfall();

  // ⭐ EVERY STORE THIS QUEUE READS, SETTLED, BEFORE ANY OF IT IS TRUSTED. Each of the 13 stores
  // above hydrates independently and asynchronously (phase-checklists.md 3c) — the SQLite-backed
  // capture stores start empty and fill in on their own schedule, not necessarily together. An
  // unhydrated store's `all()` is `[]`, which is INDISTINGUISHABLE from "this farm genuinely has
  // none of these" to every FK/`guardedBy`/`needsHead` check below: a dip that has not hydrated
  // yet cannot taint the tally it is meant to guard, because from this queue's point of view the
  // dip simply does not exist. A real regression this way: the tallies store hydrating first, on
  // its own, produced a queue with no dose to hold a slaughter behind — the slaughter posted, the
  // dip posted six entries later, and a server-side guard that exists specifically to stop meat
  // leaving inside a withdrawal was never given the chance to run. Gating the flush (below) and
  // "synced" itself (in `state`, below) on every one of these settling closes it: an unhydrated
  // store reads as "still finding out", never as "confirmed empty".
  //
  // ⛔ Every hook called UNCONDITIONALLY, one per line, before the `&&` chain — combining them
  // with `useX() && useY()` directly would short-circuit and skip calling useY() the moment useX()
  // is false, which changes how many hooks this component calls between renders and breaks React
  // outright (the Rules of Hooks), not just this feature.
  const landUnitsSettled = useLandUnitsSettled();
  const boundaryWalksSettled = useBoundaryWalksSettled();
  const mobsSettled = useMobsSettled();
  const talliesSettled = useTalliesSettled();
  const animalsSettled = useAnimalsSettled();
  const identifiersSettled = useIdentifiersSettled();
  const weightsSettled = useWeightsSettled();
  const eventsSettled = useLifecycleEventsSettled();
  const movesSettled = useMovesSettled();
  const healthSettled = useHealthEventsSettled();
  const breedingSettled = useBreedingEventsSettled();
  const theftSettled = useTheftIncidentsSettled();
  const rainfallSettled = useRainfallSettled();
  const allSettled =
    landUnitsSettled &&
    boundaryWalksSettled &&
    mobsSettled &&
    talliesSettled &&
    animalsSettled &&
    identifiersSettled &&
    weightsSettled &&
    eventsSettled &&
    movesSettled &&
    healthSettled &&
    breedingSettled &&
    theftSettled &&
    rainfallSettled;

  // Connectivity is the same signal the strip has always used; the outbox layers send-state on top.
  const online = useSyncStatus().status !== 'offline';

  // The sent-log is farm-scoped by key, exactly like the stores it shadows: one farm's send-state
  // never counts against another's pending total.
  // What each camp is CALLED, for the same reason `labels` exists: a refused boundary walk must be
  // named by the code on the gate ("Camp 3") rather than by a uuid the farmer has never seen.
  const landUnitCodes = useMemo(
    () => new Map(landUnits.map((unit) => [unit.id, unit.code])),
    [landUnits],
  );

  const farmId = activeFarm?.id ?? 'none';
  const sentLog = useMemo(() => factory(`werf-sent:${farmId}`), [factory, farmId]);
  const sent = useSyncExternalStore(sentLog.subscribe, sentLog.all);

  // The pending queue, in send order. Two rules decide it, and the second is not obvious:
  //   1. FOREIGN KEYS — a row must not arrive before what it points at. Land, then mobs, then
  //      animals, then everything that references them.
  //   2. SAFETY — a capture a server-side guard READS must not arrive after the capture that guard
  //      JUDGES. A withdrawal check is a point-in-time query; it cannot refuse a dose it has not
  //      received yet. So moves and health events precede every disposal.
  // A record is pending until its id is confirmed in the sent-log.
  const queue = useMemo<readonly FlushItem[]>(() => {
    const items: FlushItem[] = [];
    const nonNull = (...ids: readonly (string | null | undefined)[]): string[] =>
      ids.filter((id): id is string => typeof id === 'string');
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
    // A boundary walk references the camp it is the shape of, so it follows the land units above.
    //
    // ⭐ NO SAFETY ORDERING APPLIES HERE, and that is asked explicitly rather than assumed, because
    // §2d's rule is that "will this row insert" and "will the check have its evidence" are two
    // different questions. Nothing in this pair creates evidence a server-side guard reads, and
    // nothing judges it: a boundary is not a withholding, a disposal, or a head count. Where the
    // walk lands relative to everything below it is a matter of foreign keys alone.
    for (const walk of boundaryWalks) {
      if (!sent.has(walk.id)) {
        items.push({
          id: walk.id,
          kind: 'boundaryWalk',
          detail: landUnitCodes.get(walk.landUnitId) ?? null,
          send: (token) => landApi.recordBoundaryWalk(walk, token),
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
          // The row every tally on this mob is a foreign key to. Refused or held, the tallies
          // behind it must wait rather than each earning its own 404 for the same one cause.
          provides: [`mobrow:${mob.id}`],
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
    // ⭐ MOVES AND HEALTH EVENTS GO BEFORE EVERY DISPOSAL, and this is a SAFETY ordering rather
    // than a foreign-key one. The FK graph is satisfied either way — both reference only animals
    // and mobs, which are already ahead.
    //
    // The server's withdrawal guard is a point-in-time check against what has LANDED. It cannot
    // refuse what it has not yet received. With health last, a single device could do this: treat
    // five cattle on Monday offline, tally forty of their mob to the abattoir on Tuesday offline,
    // reconnect on Friday — the tally arrived first, the guard found no dose, and it returned 201.
    // Meat inside an active withdrawal, with an affirmative answer from the boundary that exists
    // to prevent it.
    //
    // So the order is: the EVIDENCE a guard reads (where the animal was, what it was given) before
    // the ACT the guard judges (a sale, a slaughter, a tally out of a flock). Moves come first of
    // the two because membership decides which doses reached which animal.
    for (const move of moves) {
      if (!sent.has(move.id)) {
        items.push({
          id: move.id,
          kind: 'move',
          detail: labels.get(move.animalId) ?? null,
          send: (token) => livestockApi.recordMove(move, token),
          // Settles the animal's membership, and the mob it walks INTO — both are subjects a later
          // disposal is judged against.
          provides: nonNull(move.animalId, move.toMobId),
        });
      }
    }
    // A mob-subject event has no tag number to show; the mob's name is not in `labels`, which is an
    // animal register, so the row simply carries no detail rather than a misleading one.
    for (const event of health) {
      if (!sent.has(event.id)) {
        items.push({
          id: event.id,
          kind: 'health',
          detail: event.animalId === null ? null : (labels.get(event.animalId) ?? null),
          send: (token) => livestockApi.recordHealth(event, token),
          // A dose creates the withholding a disposal is judged against — on the animal it was
          // given to, or on the whole mob for a plunge dip.
          provides: nonNull(event.animalId, event.mobId),
        });
      }
    }
    // A tally references its mob and nothing else. It sits HERE, after the doses, and not up with
    // the mobs where the FK graph alone would put it — a `sale`/`slaughter` tally is judged against
    // the withholding, so it must not overtake the dose that creates one. It is named by the mob it
    // adjusts: "three off Flock A" is a sentence a farmer recognises; the uuid is not.
    //
    // ⭐ ARRIVALS GO BEFORE DISPOSALS, and for the same reason doses go before tallies. Since §2.3b a
    // tally is not only an act: head arriving by `transfer_in`, or by a purchase whose seller
    // declared a withdrawal, IS the withholding on the mob it joins — for a counted flock it is the
    // only thing that can be, because there are no `animals` rows for a dose to attach to. Left in
    // capture order, a slaughter captured on Tuesday could overtake the transfer captured on Monday
    // that withholds it, and the server cannot refuse what it has not received.
    //
    // ⭐ Everything that is not a disposal keeps CAPTURE ORDER, which is causal — see `tallyPass`.
    // That is what makes a departure precede its own arrival, and an increase precede the departure
    // it funds, without a pass for either. `sort` is stable, so the order is the farmer's own.
    for (const tally of orderTallies(tallies)) {
      if (!sent.has(tally.id)) {
        // Only a sale or slaughter tally is judged against a WITHHOLDING; a death or recount takes
        // head out without putting meat into the food chain.
        //
        // ⛔ That does not mean a death is never held. It said "so it is not held for evidence" and
        // that stopped being true the moment a tally could be held for HEAD as well — a death is a
        // decrease like any other, and a death on a mob the server has not accepted waits for the
        // mob row. Two different questions, and this flag answers only the food-chain one.
        const intoFoodChain = tally.reason === 'sale' || tally.reason === 'slaughter';
        // Declaring nothing here meant a refused transfer tainted no subject, so the slaughter
        // behind it was sent and the server — which had never received the arrival — returned 201.
        // That is the fifth pass's own finding, one route along, reintroduced by the commit after
        // its fix.
        const arrives = arrivesWithheld(tally);
        // ⭐ The two halves of a move, tied by the batch id the capture screen minted for the pair.
        // The departure ESTABLISHES the move (it is the half that proves head left a group that had
        // them), so it provides the subject; the arrival is judged against it. A purchase carries no
        // batch id and is judged against nothing here — there is no other half to wait for.
        const departs = tally.reason === 'transfer_out';
        const link = tally.batchId;
        // ⭐⭐ HEAD AVAILABILITY IS AN ARITHMETIC QUESTION, NOT A SUBJECT-GRAPH ONE. This is the
        // ninth pass's SEV-2 and the reason §7's ceiling clause fired, so it is worth stating why
        // the shape changed rather than widening once more.
        //
        // The gap being closed originally: `transfer_out`, `death` and `theft` declared no
        // `guardedBy` at all, so they were SENT even when the arrival that funded the head was
        // refused or held. Offline chain A→B→C: `out_A` is refused (another phone recounted A),
        // `in_B` is correctly held — and `out_B` went anyway, to a server whose fold of B has no
        // head in it. The refusal that comes back says *"count the group and record what you find"*
        // and `/not-sent` says *"Record it again"*, and A RECOUNT RESETS, so following either
        // instruction corrupts B's count permanently.
        //
        // ⚠️ Both quotes above were challenged by the tenth pass as premises that had outlived
        // themselves, and both were RE-VERIFIED as true: the shortage throws `ValidationError`
        // (`mob-tally.ts:146`), `werf-error.filter.ts:85` maps that to code `VALIDATION`, and
        // `reasonKey` renders `notSent.why.validation` — *"Record it again, checking the numbers
        // and dates."* Checking `notSent.intro` alone is not checking this screen's copy.
        //
        // ⛔ The first fix for that was a `head:<mobId>` SUBJECT, and it held a decrease whenever
        // ANY increase on the mob was tainted — whether or not this decrease needed it. Mob of 100
        // on the server, a refused purchase of 10, three unrelated deaths: the deaths were held
        // every round for ever, the server would have taken them, and a held item appears in no
        // surface the product has. That is a capture silently lost, which is the same severity as
        // the false pass it replaced. Two agents found it independently.
        //
        // ⭐ THE FIX IS TO STOP APPROXIMATING AND RUN THE SERVER'S OWN TEST. The server folds the
        // log it actually holds, strictly before `(occurredAt, id)`, over `initialHeadCount`, and
        // refuses only when the result would go negative (`deriveHeadCount` → `recordMobTally`).
        // The device can compute exactly that: it knows the baseline, it holds the whole log, and
        // the sent-log tells it which rows the server has. So a decrease is held only when the
        // server genuinely could not accept it yet — same projection, same total order, both sides.
        // That is this repo's general rule for every aggregate it adds, applied to the hold instead
        // of re-derived one reader at a time.
        //
        // A `recount` needs no special case any more: `projectHeadCount` already RESETS on one, so
        // a landed recount is simply part of the fold. The old sign literals are gone with it.
        const consumesHead = (schemas.TALLY_DECREASES as readonly string[]).includes(tally.reason);
        const providesFor = [
          ...(arrives ? [tally.mobId] : []),
          ...(departs && link !== undefined ? [link] : []),
        ];
        const guardedByFor = [
          ...(intoFoodChain
            ? mobDisposalSubjects(
                tally.mobId,
                farmDay(new Date(tally.occurredAt)),
                animals,
                moves,
                // ⛔ The tally log, so the subject set walks the TRANSFER CHAIN the guard walks.
                // Without it the set stopped at this mob and its members, and a refused dose on
                // the SOURCE of an accepted transfer held nothing — 201 for meat inside an active
                // withholding, which is the only shape in this file where meat reaches a truck.
                tallies,
              )
            : []),
          ...(tally.reason === 'transfer_in' && link !== undefined ? [link] : []),
          // ⭐ The mob ROW is a foreign key, which genuinely IS a graph question, so it keeps a
          // subject — in its own namespace, for the reason the head subject should never have
          // shared one. A tally on a mob the server has not accepted 404s; without this, creating a
          // camp offline and recording five deaths in it yielded six "needs your attention" rows
          // for one cause. Nothing provides `mobrow:` for a mob the server already has, so this
          // cannot hold anything in the ordinary case.
          `mobrow:${tally.mobId}`,
        ];
        items.push({
          id: tally.id,
          kind: 'tally',
          detail: mobs.find((m) => m.id === tally.mobId)?.name ?? null,
          send: (token) => livestockApi.recordTally(tally, token),
          // The FULL subject set the mob guard reads — the mob AND every individually-registered
          // member standing in it and their mob histories — not just `[tally.mobId]`. A refused
          // individual dose on a member, or a dose carried in from a mob a member has left, must
          // hold this tally exactly as `meatWithdrawalForMob` refuses it at capture. Shadowing the
          // guard with a narrower set was the gap the fifth pass found in all three agents.
          // One expression for the same question on both arms — `link !== undefined` twice, not
          // `!== undefined` outside and truthiness inside. They agree today only because
          // `StoredTally.batchId` cannot be `''`; a `provides: []` that exists and protects nothing
          // is not a thing to leave one type change away.
          ...(providesFor.length > 0 ? { provides: providesFor } : {}),
          // ⛔ A UNION, and no longer "at most one of these two". That claim was true only while a
          // disposal could not also depend on something else; a `sale` is now BOTH — judged against
          // a withholding AND against the mob row existing. Head availability left this set in the
          // ninth pass and is asked as arithmetic below.
          ...(guardedByFor.length > 0 ? { guardedBy: guardedByFor } : {}),
          // Only a DECREASE can underflow: `recordMobTally` adds the signed delta and refuses a
          // negative result, so an increase and a recount can never be short of head.
          ...(consumesHead
            ? {
                needsHead: (landed: (id: string) => boolean): boolean => {
                  const stored = mobs.find((m) => m.id === tally.mobId);
                  // The mob row itself has not been seen. `mobrow:` above is what holds this;
                  // underflow is not the question and a guess here would be a second answer.
                  if (stored === undefined) return false;
                  const baseline =
                    stored.initialHeadCount === undefined
                      ? stored.headCount
                      : stored.initialHeadCount;
                  // Managed as individual animals: there is no head count to be short of. The
                  // server refuses this on its merits, permanently — a 4xx, not a hold.
                  if (baseline === null) return false;
                  // ⭐ Strictly BEFORE `(occurredAt, id)` and only what the server actually holds —
                  // the same cut `deriveHeadCount` applies, with the same total order. A tally
                  // later in this queue, refused this round, or held this round is not in the
                  // sent-log and is correctly absent: the server will not have it either.
                  //
                  // ⛔ PHASE 3 TRIPWIRE. That last sentence rests on a premise this file cannot
                  // enforce: `landed()` is `sentLog.has(id)`, which answers "did THIS DEVICE send
                  // it", and that equals "does the server hold it" ONLY while the device holds the
                  // whole log. True today — nothing hydrates. The moment PowerSync brings mobs and
                  // tallies DOWN, a tally another phone landed is invisible here, this fold
                  // under-counts, and the decrease is held every round for ever with no refusal
                  // above it to clear. `landed()` must become
                  // `sentLog.has(id) || hydratedFromServer.has(id)` in the same slice that ships
                  // hydration. Checklist item 3e carries this; a comment alone goes stale.
                  const before = tallies.filter(
                    (t) =>
                      t.mobId === tally.mobId &&
                      landed(t.id) &&
                      (t.occurredAt < tally.occurredAt ||
                        (t.occurredAt === tally.occurredAt && t.id < tally.id)),
                  );
                  const head = projectHeadCount(baseline, before);
                  return head !== null && head - tally.count < 0;
                },
              }
            : {}),
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
    // Breeding (FR-120/121) sits here on FOREIGN KEYS ALONE, and the second question is asked
    // explicitly because that is the rule this queue learned the hard way: a mating references the
    // dam and, when the bull is on this farm, the sire — both animals, both already ahead — and a
    // pregnancy diagnosis references only the dam. Nothing here CREATES evidence a server-side
    // guard reads, and nothing here is JUDGED by one; the due date is projected from reference
    // data the server already holds, not from anything else in this queue. So unlike the doses
    // above, no safety ordering applies, and moving it would be harmless rather than dangerous.
    for (const event of breeding) {
      if (!sent.has(event.id)) {
        items.push({
          id: event.id,
          kind: 'breeding',
          detail: labels.get(event.animalId) ?? null,
          send: (token) =>
            event.kind === 'mating'
              ? livestockApi.recordMating(event, token)
              : livestockApi.recordPregnancyTest(event, token),
        });
      }
    }
    // One entry per lifecycle event TYPE. Exhaustive by construction rather than by an
    // if/else with a default arm: a new event type added to the store without an endpoint here
    // fails the typecheck instead of being silently posted to /deaths.
    for (const event of events) {
      if (sent.has(event.id)) continue;
      // A sale is a food-chain disposal; a death is only when it was a slaughter. Both are judged
      // against doses given to the animal itself AND to EVERY mob it has stood in — a mob it has
      // since left can still be withholding it — so a refused dose on any of them holds this act
      // back. `currentMob` alone (the earlier fix) missed a dose on a mob the animal walked out of,
      // which is exactly the carried-in class the capture guard was widened for this same session.
      const intoFoodChain =
        event.type === 'sale' || (event.type === 'death' && event.slaughtered === true);
      const subject = animals.find((a) => a.id === event.animalId);
      items.push({
        id: event.id,
        kind: 'lifecycle',
        detail: labels.get(event.animalId) ?? null,
        send: (token) => sendLifecycleEvent(event, token),
        ...(intoFoodChain
          ? {
              guardedBy: subject ? animalDisposalSubjects(subject, moves) : nonNull(event.animalId),
            }
          : {}),
      });
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
    landUnitCodes,
    boundaryWalks,
    mobs,
    tallies,
    animals,
    identifiers,
    weights,
    events,
    moves,
    health,
    breeding,
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
  // Captures HELD this round: the server never saw them, because something they depend on did not
  // land. Held in memory and re-derived every round for the same reason refusals are — a hold is a
  // fact about one attempt, and it clears itself the moment the cause does.
  const [held, setHeld] = useState<ReadonlySet<string>>(() => new Set());

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
    // Subjects whose EVIDENCE was set aside this round. A disposal judged against any of them is
    // held rather than sent — evidence goes before the act in this queue, so by the time a disposal
    // is reached its evidence has been attempted, and a tainted subject means it did not land.
    const taintedSubjects = new Set<string>();
    const taint = (item: FlushItem): void => {
      for (const subject of item.provides ?? []) taintedSubjects.add(subject);
    };
    // ⛔ The ids HELD this round. A hold is not a refusal — the server never saw the capture — but
    // it is not nothing either, and until the ninth pass it was reported nowhere: `blocked` is
    // derived from the refusal map, so a held capture appeared in no list, and the strip's status
    // line returned early on the refusal count so it was not even in the pending total. Three
    // stranded deaths behind one refused move read to a farmer as "1 not sent".
    const heldThisRound = new Set<string>();
    try {
      for (const item of items) {
        if (!mountedRef.current) return;
        if (sentLog.has(item.id)) continue; // sent earlier this round
        // The act must not overtake evidence that was refused this round. Held, not refused: it is
        // left pending so the next reconnect sends it once the dose or move lands — or once the
        // farmer resolves the refusal that stranded it. Marking it "needs attention" would blame
        // the farmer for a capture the server never actually rejected.
        //
        // ⭐ A HELD ITEM TAINTS WHAT IT PROVIDES, because it did not land either. `taint` means "the
        // server does not have this", and a refusal is only one way to get there. Until the transfer
        // link existed no queue item had both `provides` and `guardedBy`, so this could not bite; a
        // held `transfer_in` has both, and without this line the destination mob stayed clean and
        // the slaughter behind it posted to a server that had never heard of the arrival — the
        // sixth pass's own finding, one round deeper.
        if (item.guardedBy?.some((subject) => taintedSubjects.has(subject))) {
          taint(item);
          heldThisRound.add(item.id);
          continue;
        }
        // ⭐ The head check runs on the SAME footing as the subject check and taints identically: a
        // decrease that cannot be funded did not land either, so anything depending on it — the
        // other half of its move — must wait too. `sentLog` is the live view of what the server
        // holds, so this asks the server's own question at the moment of sending rather than from a
        // snapshot taken when the queue was built.
        if (item.needsHead?.((id) => sentLog.has(id)) === true) {
          taint(item);
          heldThisRound.add(item.id);
          continue;
        }
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
                taint(item);
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
            taint(item);
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
        setHeld((previous) => replaceSetIfChanged(previous, heldThisRound));
      }
    }
  }, [online, sentLog, refreshSession]);

  // Flush whenever there is something to send and a way to send it. `pendingCount` in the deps
  // makes a new capture (or a reconnect) trigger a fresh attempt; a server error does not change
  // the deps, so a stuck queue does not spin — it waits for the next capture or reconnect.
  //
  // ⭐ `allSettled` gates this exactly as `online` does — a flush must not read a queue built from
  // stores that have not finished saying what they hold. `pendingCount` climbing from 0 as stores
  // settle one at a time re-fires this effect on its own, so the flush simply waits for the last
  // store rather than needing a separate "now everything is ready" signal.
  useEffect(() => {
    if (online && allSettled && pendingCount > 0) void flush();
  }, [online, allSettled, pendingCount, flush]);

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

  // ⭐ The captures WAITING on one of those refusals, derived the same way and for the same reason.
  // A held capture is not the farmer's fault and must never be listed as needing attention — but
  // it was previously listed nowhere at all, and the strip's own status line hid it from the
  // pending total too, so three deaths stranded behind one refused move read as "1 not sent".
  // "Waiting" is a third state, and the farmer is owed it.
  const waiting = useMemo<readonly RefusedCapture[]>(
    () =>
      queue.flatMap((item) =>
        held.has(item.id) && !refused.has(item.id)
          ? [{ id: item.id, kind: item.kind, detail: item.detail, code: 'held', status: 0 }]
          : [],
      ),
    [queue, held, refused],
  );
  const waitingCount = waiting.length;

  const state = useMemo<SyncState>(() => {
    // ⭐ `!allSettled` is checked BEFORE the empty-queue fallthrough reaches 'synced'. Before every
    // store has hydrated, `pendingCount` reads 0 not because the farm has nothing pending but
    // because nothing has finished saying what it holds yet — reaching 'synced' here is the
    // farmer-visible half of the same bug the flush gate above closes: "Saved and sent" on ground
    // this device has not actually finished checking. There is no dedicated status for "still
    // finding out" (`SyncStatus` has no loading state); 'syncing' is the closest honest word and
    // it self-corrects within the same render pass once the last store settles.
    const status: SyncState['status'] = !online
      ? 'offline'
      : !allSettled || flushing
        ? 'syncing'
        : (errored || blockedCount > 0) && pendingCount > 0
          ? 'error'
          : pendingCount > 0
            ? 'pending'
            : 'synced';
    return { status, pendingCount, blockedCount, waitingCount };
  }, [online, allSettled, flushing, errored, pendingCount, blockedCount, waitingCount]);

  return (
    <OutboxContext.Provider value={state}>
      <SentCapturesContext.Provider value={sent}>
        <RefusedCapturesContext.Provider value={blocked}>
          <HeldCapturesContext.Provider value={waiting}>{children}</HeldCapturesContext.Provider>
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
 * The captures HELD behind a refusal, in queue order. Empty outside an `OutboxProvider`.
 *
 * Separate from `useRefusedCaptures` on purpose: these were never rejected, and listing them as
 * "needs your attention" would blame the farmer for a capture the server has not even seen. What
 * they need is the opposite — to be visible while needing nothing, so that resolving the ONE
 * refusal they wait on is legibly the thing that releases them.
 */
export function useHeldCaptures(): readonly RefusedCapture[] {
  return useContext(HeldCapturesContext);
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
