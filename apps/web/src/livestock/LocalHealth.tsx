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
import { useAuth } from '../auth/AuthProvider';

/** Which of the three health captures this is. Each posts to its own endpoint. */
export type HealthKind = 'treatment' | 'vaccination' | 'dip';

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
  readonly doseValue?: number;
  readonly doseUnit?: string;
  readonly administeredBy?: string;
  readonly reason?: string;
  readonly programme?: string;
  readonly method?: 'plunge' | 'spray' | 'pour_on' | 'injectable';
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
