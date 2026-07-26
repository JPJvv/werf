/**
 * The local health log (FR-130/131/132/133) — treatments, vaccinations and dips, as the device
 * holds them. COMPLIANCE-GATED: these are the records a withdrawal period is computed from, and an
 * export auditor reads.
 *
 * ⭐ What is NOT stored here is the interesting part. A stored health event carries a `productId`
 * and NEVER a withdrawal period, because the withdrawal is a REGULATED NUMBER: it is resolved
 * server-side from the registration in force on the treatment day and written onto the event there
 * (ADR-0005, FR-131, .claude/rules/domain.md). A client that sent a withdrawal could claim a shorter
 * one by relabelling, and a client that stored one would freeze today's cached figure into a record
 * that outlives it. The screen SHOWS a clear date from the cached register so the farmer knows when
 * they can sell — that is a preview, and it is the server's number that is kept.
 *
 * Health events change no status, so they are not folded onto the herd. They live in their own
 * store rather than the lifecycle log for that reason and one more: `.claude/rules/db.md` classifies
 * health as sensitive, and keeping it in its own farm-scoped key makes "what is on this phone"
 * answerable table by table.
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

/** Which of the three health captures this is. Each posts to its own endpoint. */
export type HealthKind = 'treatment' | 'vaccination' | 'dip';

/**
 * How a dip was applied (FR-133), taken FROM the event payload schema rather than written out here.
 *
 * It used to be a hand-written union, and it had drifted: it offered `'injectable'`, which the dip
 * payload does not accept and the server would have refused on the wire. Nothing ever hit it only
 * because the field was not on any screen yet — the moment it appeared, a plausible-looking choice
 * would have queued a capture that could never be sent. Deriving the type is the rule in CLAUDE.md
 * for exactly this reason: a schema and a duplicate of it drift silently and in one direction.
 */
export type DipMethod = NonNullable<schemas.DipPayload['method']>;

/** A health event as held locally. No withdrawal period — see the note above. */
export interface StoredHealthEvent {
  readonly id: string;
  readonly farmId: string;
  readonly animalId: string;
  readonly kind: HealthKind;
  /** ISO 8601 instant it was captured on the farm. */
  readonly occurredAt: string;
  /** The farm-local treatment DAY (YYYY-MM-DD) the withdrawal arithmetic is based on. */
  readonly administeredOn: string;
  /** The registered product selected. The server resolves its withdrawal from this. */
  readonly productId: string;
  /** Ties one dosing run across many animals together as the single action it was (FR-112). */
  readonly batchId: string | null;
  /** How much was given, and in what — 20, "ml". A treatment only (FR-130). */
  readonly doseValue?: number;
  readonly doseUnit?: string;
  /** How it went in (FR-130). Derived from the treatment payload so the vocabulary cannot drift. */
  readonly route?: schemas.TreatmentRoute;
  readonly administeredBy?: string;
  readonly reason?: string;
  readonly programme?: string;
  /** How the dip was applied (FR-133). A dip only. */
  readonly method?: DipMethod;
}

export type HealthStore = CaptureStore<StoredHealthEvent>;
export type HealthStoreFactory = (key: string) => HealthStore;

const defaultFactory: HealthStoreFactory = (key) =>
  createCaptureStore<StoredHealthEvent>({ storage: window.localStorage, key });

const HealthStoreContext = createContext<HealthStore | null>(null);

export interface LocalHealthProviderProps {
  children: ReactNode;
  factory?: HealthStoreFactory;
}

export function LocalHealthProvider({
  children,
  factory = defaultFactory,
}: LocalHealthProviderProps) {
  const { activeFarm } = useAuth();
  const farmId = activeFarm?.id ?? 'none';
  const store = useMemo(() => factory(`werf-health:${farmId}`), [factory, farmId]);

  return <HealthStoreContext.Provider value={store}>{children}</HealthStoreContext.Provider>;
}

function useHealthStore(): HealthStore {
  const store = useContext(HealthStoreContext);
  if (!store) throw new Error('useHealthEvents must be used inside a LocalHealthProvider');
  return store;
}

/** Every health event on the farm, reactive. */
export function useHealthEvents(): readonly StoredHealthEvent[] {
  const store = useHealthStore();
  return useSyncExternalStore(store.subscribe, store.all);
}

/**
 * Record one health event per animal in a dosing run, under ONE batch id (FR-112). Synchronous;
 * never awaits the network (NFR-007). A dosing run is a batch by nature — nobody doses one animal
 * and walks away — so the group is the unit here and a single animal is a group of one.
 */
export function useRecordHealth(): (events: readonly StoredHealthEvent[]) => void {
  const store = useHealthStore();
  return useCallback(
    (events) => {
      for (const event of events) store.append(event);
    },
    [store],
  );
}
