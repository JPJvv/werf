/**
 * The local move log (FR-103) — where animals have been walked, as the device holds it.
 *
 * Append-only, like the lifecycle log, and stored in exactly the shape the wire takes: the
 * DESTINATION only. The "from" side is never captured here, because the animal already knows where
 * it is — the projection derives the before/after, and the server derives it again from the animal's
 * own row. Storing a client-authored "from" would give the history two sources that can disagree.
 *
 * `occurredAt` is an ISO string, since the event envelope's Date does not round-trip localStorage
 * across a cold start; that conversion lives at this boundary, as it does for the lifecycle log.
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

/** A walk, as held locally. `undefined` on a destination means that dimension was left alone. */
export interface StoredMove {
  readonly id: string;
  readonly farmId: string;
  readonly animalId: string;
  /** ISO 8601. When the animal was walked, on the farm. */
  readonly occurredAt: string;
  /** Destination camp. Absent = camp unchanged; null = taken off a mapped camp. */
  readonly toLandUnitId?: string | null;
  /** Destination mob. Absent = mob unchanged; null = unassigned from its mob. */
  readonly toMobId?: string | null;
  /** Ties one walk across many animals together as the single action it was (FR-112). */
  readonly batchId: string | null;
}

export type MoveStore = CaptureStore<StoredMove>;
export type MoveStoreFactory = (key: string) => MoveStore;

const defaultFactory: MoveStoreFactory = (key) =>
  createCaptureStore<StoredMove>({ storage: window.localStorage, key });

const MoveStoreContext = createContext<MoveStore | null>(null);

export interface LocalMovesProviderProps {
  children: ReactNode;
  factory?: MoveStoreFactory;
}

export function LocalMovesProvider({
  children,
  factory = defaultFactory,
}: LocalMovesProviderProps) {
  const { activeFarm } = useAuth();
  const farmId = activeFarm?.id ?? 'none';
  const store = useMemo(() => factory(`werf-moves:${farmId}`), [factory, farmId]);

  return <MoveStoreContext.Provider value={store}>{children}</MoveStoreContext.Provider>;
}

function useMoveStore(): MoveStore {
  const store = useContext(MoveStoreContext);
  if (!store) throw new Error('useMoveStore must be used inside a LocalMovesProvider');
  return store;
}

/** Every move, reactive: this re-renders when one is captured. */
export function useMoves(): readonly StoredMove[] {
  const store = useMoveStore();
  return useSyncExternalStore(store.subscribe, store.all);
}

/**
 * Record a walk for each animal in a group, under ONE batch id (FR-112). Synchronous; never awaits
 * the network (NFR-007). A farmer walks a mob, not an animal, so the group is the unit here and a
 * single-animal move is simply a group of one.
 */
export function useRecordMoves(): (moves: readonly StoredMove[]) => void {
  const store = useMoveStore();
  return useCallback(
    (moves) => {
      for (const move of moves) store.append(move);
    },
    [store],
  );
}
