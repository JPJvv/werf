/**
 * The local tally log (FR-102) — every change to a mob's head count, and why. Read and written
 * through the `@werf/sync` capture-store adapter, never a storage API directly (ADR-0003). Same
 * family as `LocalLifecycle` and `LocalMoves`: append-only captured facts, reactive, farm-scoped by
 * key, and JSON-safe (`occurredAt` is an ISO string, because the event envelope's Date does not
 * round-trip localStorage across a cold start).
 *
 * ⭐ This log is why the head count is a PROJECTION rather than a field the app edits. A capture
 * store is append-only because it holds a farmer's work, and the mob it holds keeps the number it
 * was created with forever; `herd.ts` folds these adjustments over that baseline to get the number
 * on screen. Editing the mob in place would need a `replace` on the capture store — the one method
 * that could erase a capture — and it would silently lose one of two adjustments made on two phones
 * in a dead zone. The fold keeps both, which is the truth (see `projectHeadCount` in @werf/domain).
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
import { recordMobTally } from '@werf/domain';
import { ValidationError, schemas } from '@werf/core';
import { useAuth } from '../auth/AuthProvider';

/**
 * A head-count adjustment as the device holds it.
 *
 * `count` is what the farmer typed and is what goes on the wire; `delta` / `countedHead` are what
 * the projection reads. Both are stored rather than one derived from the other at read time,
 * because the derivation is the sign rule and it lives in exactly one place — the domain capture
 * that produced this record — so the two cannot come to disagree.
 */
export interface StoredTally {
  readonly id: string;
  readonly farmId: string;
  readonly mobId: string;
  /** ISO 8601. When it happened on the farm, not when it was captured. */
  readonly occurredAt: string;
  readonly reason: schemas.TallyReason;
  /** Always positive, as typed: "how many died", or for a recount "how many there are". */
  readonly count: number;
  /** Signed change. Absent on a recount, which is absolute. */
  readonly delta?: number;
  /** The head actually counted. Present only on a recount. */
  readonly countedHead?: number;
  readonly counterparty?: string;
  readonly priceCents?: number;
  /** The other group in a mob-to-mob move (§2.3b). Present on `transfer_in` / `transfer_out` only. */
  readonly counterpartMobId?: string;
  /**
   * ⭐ The id shared by BOTH halves of one group-to-group move. Present on `transfer_in` /
   * `transfer_out` only, and unlike `carriedWithholdUntil` it IS sent — it is not a regulated
   * arithmetic result the server must own, it is the fact that these two captures are one action,
   * and only the device that performed the action knows it.
   *
   * The outbox reads it: the departure `provides` this subject and the arrival is `guardedBy` it, so
   * an arrival whose departure was refused is HELD rather than landing on its own and giving the
   * destination head that never left anywhere.
   */
  readonly batchId?: string;
  /**
   * ⭐ The withholding transferred head carry with them — a PREVIEW, like every regulated date this
   * device shows. It is stored so the device's own guard can see it: a counted flock has no
   * `animals` rows, so head that walks in from a dipped camp leaves nothing else for the guard to
   * read, and forty dipped sheep would be clear on this phone the moment they came through the gate.
   *
   * ⛔ It is NOT sent. The server computes its own from the source mob's log at the moment the
   * transfer lands, exactly as it computes a treatment's clear date — a device with a stale product
   * register must never be able to shorten a withholding by being the one that did the arithmetic.
   */
  readonly carriedWithholdUntil?: string;
  /** The withdrawal the seller declared for bought-in head. Absent = unknown history, never guessed. */
  readonly declaredWithdrawalUntil?: string;
}

/** What a screen hands the recorder. The capture instant is a real Date at this boundary. */
export interface TallyCapture {
  readonly id: string;
  readonly farmId: string;
  readonly mobId: string;
  readonly occurredAt: Date;
  readonly reason: schemas.TallyReason;
  readonly count: number;
  /** The mob's head count right now — the number the domain validates the change against. */
  readonly currentHead: number | null;
  readonly counterparty?: string;
  readonly priceCents?: number;
  readonly counterpartMobId?: string;
  readonly batchId?: string;
  readonly carriedWithholdUntil?: string;
  readonly declaredWithdrawalUntil?: string;
}

export type TallyStore = CaptureStore<StoredTally>;

/** Injectable so tests can back the log with in-memory storage instead of localStorage. */
export type TallyStoreFactory = (key: string) => TallyStore;

const defaultFactory: TallyStoreFactory = (key) =>
  createCaptureStore<StoredTally>({ storage: window.localStorage, key });

const TallyStoreContext = createContext<TallyStore | null>(null);

export interface LocalTalliesProviderProps {
  children: ReactNode;
  factory?: TallyStoreFactory;
}

export function LocalTalliesProvider({
  children,
  factory = defaultFactory,
}: LocalTalliesProviderProps) {
  const { activeFarm } = useAuth();
  const farmId = activeFarm?.id ?? 'none';
  const store = useMemo(() => factory(`werf-tallies:${farmId}`), [factory, farmId]);

  return <TallyStoreContext.Provider value={store}>{children}</TallyStoreContext.Provider>;
}

function useTallyStore(): TallyStore {
  const store = useContext(TallyStoreContext);
  if (!store) throw new Error('useTallies must be used inside a LocalTalliesProvider');
  return store;
}

/** Every head-count adjustment the device holds, reactive. */
export function useTallies(): readonly StoredTally[] {
  const store = useTallyStore();
  return useSyncExternalStore(store.subscribe, store.all);
}

/**
 * Commit a head-count adjustment locally (FR-102). Synchronous; never awaits the network (NFR-007).
 *
 * Validates through the pure domain capture FIRST — the sign rule, the zero-change rule, and the
 * refusal to take more head out than the group has — so a bad capture throws before it can enter
 * the append-only log, and the screen shows the domain's own message rather than inventing one.
 */
export function useRecordTally(): (capture: TallyCapture) => void {
  const record = useRecordTallies();
  return useCallback((c) => record([c]), [record]);
}

/**
 * Commit a SET of head-count adjustments as one act (FR-102).
 *
 * ⭐ ALL of them are validated before ANY of them is appended, and that is the whole reason this
 * exists — raised by all three review agents. A mob-to-mob move is two captures, and the screen
 * wrote them one at a time: if the second threw, the first was already in the append-only log. That
 * leaves an orphan `transfer_out` carrying a batch id whose sibling never existed, which still
 * flushes and takes forty head out of the source into nothing — the exact outcome the screen's own
 * `canSave` guard says it prevents. The farmer meanwhile sees an error and records the move again.
 *
 * A capture store cannot roll back: it is append-only on purpose, because it holds a farmer's work.
 * So the only place to be atomic is BEFORE the first append.
 */
export function useRecordTallies(): (captures: readonly TallyCapture[]) => void {
  const store = useTallyStore();
  return useCallback(
    (captures) => {
      const built = captures.map((c) => ({ c, event: buildTally(c) }));
      for (const { c, event } of built) appendTally(store, c, event);
    },
    [store],
  );
}

/** The domain capture, which throws before anything is written. Pure; no store, no side effect. */
function buildTally(c: TallyCapture) {
  // ⭐ THE CAPTURE-TIME HALF OF THE BATCH RULE, and it lives here rather than in the domain because
  // here is the only place it is knowable. A move is two events, and only the device performing it
  // knows they are one act — the server receives them as separate requests, possibly days apart,
  // with nothing in the second identifying the first, so it cannot check this and must not refuse
  // on it (see `recordMobTally`). A half written without a link is a half that can flush alone.
  if (
    (schemas.TALLY_TRANSFERS as readonly string[]).includes(c.reason) &&
    (c.batchId === undefined || c.batchId === null)
  ) {
    throw new ValidationError('Both halves of a group-to-group move must share one batch id');
  }
  const { event } = recordMobTally({
    id: c.id,
    farmId: c.farmId,
    mobId: c.mobId,
    occurredAt: c.occurredAt,
    reason: c.reason,
    count: c.count,
    currentHead: c.currentHead,
    counterparty: c.counterparty,
    priceCents: c.priceCents,
    // Validated through the domain like everything else — the schema refuses a transfer with no
    // counterpart, and a declared withdrawal on anything but a purchase.
    counterpartMobId: c.counterpartMobId,
    // ⚠️ NOT validated by the domain — the check above this is the only one. `recordMobTally`
    // deliberately accepts an unlinked half because the server cannot verify a sibling it may not
    // receive for days, so the rule lives at capture, where it is knowable. This comment said the
    // opposite twenty lines under the header that explains why.
    batchId: c.batchId,
    carriedWithholdUntil: c.carriedWithholdUntil,
    declaredWithdrawalUntil: c.declaredWithdrawalUntil,
  });
  return event;
}

/** The append, once every capture in the act has been proved buildable. */
function appendTally(
  store: TallyStore,
  c: TallyCapture,
  event: ReturnType<typeof buildTally>,
): void {
  const payload = event.payload as { delta?: number; countedHead?: number };
  store.append({
    id: c.id,
    farmId: c.farmId,
    mobId: c.mobId,
    occurredAt: c.occurredAt.toISOString(),
    reason: c.reason,
    count: c.count,
    ...(payload.delta === undefined ? {} : { delta: payload.delta }),
    ...(payload.countedHead === undefined ? {} : { countedHead: payload.countedHead }),
    ...(c.counterparty === undefined ? {} : { counterparty: c.counterparty }),
    ...(c.priceCents === undefined ? {} : { priceCents: c.priceCents }),
    ...(c.counterpartMobId === undefined ? {} : { counterpartMobId: c.counterpartMobId }),
    ...(c.batchId === undefined ? {} : { batchId: c.batchId }),
    ...(c.carriedWithholdUntil === undefined
      ? {}
      : { carriedWithholdUntil: c.carriedWithholdUntil }),
    ...(c.declaredWithdrawalUntil === undefined
      ? {}
      : { declaredWithdrawalUntil: c.declaredWithdrawalUntil }),
  });
}
