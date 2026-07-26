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
import type { schemas } from '@werf/core';
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
  const store = useTallyStore();
  return useCallback(
    (c) => {
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
      });
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
      });
    },
    [store],
  );
}
