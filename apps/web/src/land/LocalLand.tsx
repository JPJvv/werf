/**
 * The local land register — the farm's camps and blocks as the device holds them, read and written
 * through the `@werf/sync` capture-store adapter, never a storage API directly (ADR-0003).
 *
 * Same family as `LocalHerd` and `LocalLifecycle`: append-only captured facts, reactive, farm-scoped
 * by key. It is the first store that is a PREREQUISITE for another capture rather than a record of
 * something that happened — an animal is put in a camp, an animal is moved to a camp — which is why
 * the outbox sends land units before animals: a herd row carrying `land_unit_id` would fail its
 * foreign key against ground the server has never seen.
 *
 * The boundary is held as GeoJSON text, never PostGIS. SQLite on the device has no notion of the
 * `geometry` type, so the client authors GeoJSON and the server derives the canonical geometry from
 * it (see `apps/api/src/land/land.service.ts`).
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  createSqliteCaptureStore,
  createDraftStore,
  type CaptureStore,
  type DraftStore,
} from '@werf/sync';
import type { schemas } from '@werf/core';
import type { WalkFix } from '@werf/domain';
import { useAuth } from '../auth/AuthProvider';
import { getLocalDatabase } from '../sync/local-db';

/** What the register holds: land units composed offline with a client UUIDv7 (the `new` shape). */
export type StoredLandUnit = schemas.NewLandUnit;
export type LandStore = CaptureStore<StoredLandUnit>;

/**
 * A completed boundary walk as the device holds it, waiting to be sent.
 *
 * ⭐ `occurredAt` is an ISO STRING here, not a Date, and that is not an oversight. `timestampSchema`
 * parses a string INTO a Date, so the parsed type describes the shape only after a parse — a store
 * typed as the parsed shape compiles and then crashes on a COLD START, because JSON has no Date and
 * localStorage returns exactly what it was given. Every capture store in this app keeps instants as
 * strings for the same reason.
 */
export interface StoredBoundaryWalk {
  readonly id: string;
  readonly farmId: string;
  readonly landUnitId: string;
  readonly occurredAt: string;
  readonly corners: readonly WalkFix[];
  /** The ring the device closed, so the map a farmer sees offline is the one they walked. */
  readonly boundaryGeojson: string;
  /** The area the device measured, in hectares — the number they were looking at when they saved. */
  readonly areaHectares: number;
}
export type BoundaryWalkStore = CaptureStore<StoredBoundaryWalk>;

/** The corners of a walk still in progress. Not a capture: nothing here is ever sent. */
export type WalkDraftStore = DraftStore<WalkFix>;

/** Injectable so tests can back the register with in-memory storage instead of localStorage. */
export type LandStoreFactory = (key: string) => LandStore;
export type BoundaryWalkStoreFactory = (key: string) => BoundaryWalkStore;
export type WalkDraftStoreFactory = (key: string) => WalkDraftStore;

const defaultFactory: LandStoreFactory = (key) =>
  createSqliteCaptureStore<StoredLandUnit>({
    database: getLocalDatabase(),
    key,
    legacyStorage: window.localStorage,
  });

const defaultWalkFactory: BoundaryWalkStoreFactory = (key) =>
  createSqliteCaptureStore<StoredBoundaryWalk>({
    database: getLocalDatabase(),
    key,
    legacyStorage: window.localStorage,
  });

// Untouched — a draft is explicitly not a capture (its own header: "not a queue, nothing here is
// ever sent"), so it stays on the localStorage-backed createDraftStore this slice.
const defaultDraftFactory: WalkDraftStoreFactory = (key) =>
  createDraftStore<WalkFix>({ storage: window.localStorage, key });

interface LandStores {
  readonly units: LandStore;
  readonly walks: BoundaryWalkStore;
  readonly draftFor: (landUnitId: string) => WalkDraftStore;
}

const LandStoreContext = createContext<LandStores | null>(null);

export interface LocalLandProviderProps {
  children: ReactNode;
  factory?: LandStoreFactory;
  walkFactory?: BoundaryWalkStoreFactory;
  draftFactory?: WalkDraftStoreFactory;
}

export function LocalLandProvider({
  children,
  factory = defaultFactory,
  walkFactory = defaultWalkFactory,
  draftFactory = defaultDraftFactory,
}: LocalLandProviderProps) {
  const { activeFarm } = useAuth();
  const farmId = activeFarm?.id ?? 'none';

  const stores = useMemo<LandStores>(() => {
    // Each camp's draft is its own, keyed by camp as well as by farm: a farmer who starts one camp,
    // drives to another and starts that one must not find the first camp's corners waiting.
    const drafts = new Map<string, WalkDraftStore>();
    return {
      units: factory(`werf-land:${farmId}`),
      walks: walkFactory(`werf-boundary-walks:${farmId}`),
      draftFor: (landUnitId) => {
        const existing = drafts.get(landUnitId);
        if (existing) return existing;
        const created = draftFactory(`werf-walk-draft:${farmId}:${landUnitId}`);
        drafts.set(landUnitId, created);
        return created;
      },
    };
  }, [factory, walkFactory, draftFactory, farmId]);

  return <LandStoreContext.Provider value={stores}>{children}</LandStoreContext.Provider>;
}

function useLandStores(): LandStores {
  const stores = useContext(LandStoreContext);
  if (!stores) throw new Error('useLandStore must be used inside a LocalLandProvider');
  return stores;
}

/** The farm's camps and blocks, reactive: this re-renders when one is captured. */
export function useLandUnits(): readonly StoredLandUnit[] {
  const { units } = useLandStores();
  return useSyncExternalStore(units.subscribe, units.all);
}

/** Whether the land-unit store's initial hydration attempt is over (`CaptureStore.settled()`) —
 *  the Outbox flush must not act on `useLandUnits()` until this is true. */
export function useLandUnitsSettled(): boolean {
  const { units } = useLandStores();
  return useSyncExternalStore(units.subscribe, units.settled);
}

/** Commit a camp/block to the local register. Synchronous; never awaits the network (NFR-007). */
export function useRecordLandUnit(): (unit: StoredLandUnit) => void {
  const { units } = useLandStores();
  return useCallback((unit) => units.append(unit), [units]);
}

/** Every boundary walk this device holds, in capture order. */
export function useBoundaryWalks(): readonly StoredBoundaryWalk[] {
  const { walks } = useLandStores();
  return useSyncExternalStore(walks.subscribe, walks.all);
}

/** Whether the boundary-walk store's initial hydration attempt is over
 *  (`CaptureStore.settled()`) — the Outbox flush must not act on `useBoundaryWalks()` until
 *  this is true. */
export function useBoundaryWalksSettled(): boolean {
  const { walks } = useLandStores();
  return useSyncExternalStore(walks.subscribe, walks.settled);
}

/** Commit a finished walk locally. Synchronous; the outbox sends it when there is a signal. */
export function useRecordBoundaryWalk(): (walk: StoredBoundaryWalk) => void {
  const { walks } = useLandStores();
  return useCallback((walk) => walks.append(walk), [walks]);
}

/**
 * The boundary a camp currently has, as this device sees it.
 *
 * ⭐ ORDERED BY `(occurredAt, id)`, THE SAME TOTAL ORDER THE SERVER USES — never by `occurredAt`
 * alone. A walk is day-grained in practice, so two walks of one camp tie on the instant BY
 * CONSTRUCTION, and a tie left to array order resolves to whichever the capture store happened to
 * append first, which is arrival order and not what happened. The id is a client UUIDv7: time-
 * ordered, and byte-identical on both sides, so the device and the server cannot reach different
 * answers about the same camp. This is the defect class the mob membership and tally projections
 * were both corrected for; it is written this way from the start here.
 *
 * Compared with `<` on the strings rather than `localeCompare`, for the same reason `mob-tally.ts`
 * was changed: a locale comparison is collation-dependent and the server's is not.
 */
export function useCurrentBoundary(landUnitId: string): StoredBoundaryWalk | undefined {
  const walks = useBoundaryWalks();
  return useMemo(() => latestWalkFor(walks, landUnitId), [walks, landUnitId]);
}

/** The latest walk for a camp by the total order, or undefined when it has never been walked. */
export function latestWalkFor(
  walks: readonly StoredBoundaryWalk[],
  landUnitId: string,
): StoredBoundaryWalk | undefined {
  let latest: StoredBoundaryWalk | undefined;
  for (const walk of walks) {
    if (walk.landUnitId !== landUnitId) continue;
    if (latest === undefined || isLater(walk, latest)) latest = walk;
  }
  return latest;
}

function isLater(candidate: StoredBoundaryWalk, incumbent: StoredBoundaryWalk): boolean {
  if (candidate.occurredAt !== incumbent.occurredAt) {
    return candidate.occurredAt > incumbent.occurredAt;
  }
  return candidate.id > incumbent.id;
}

/**
 * The in-progress walk for one camp: its corners, and the two things a farmer can do to them.
 *
 * Every change is written through the draft store, so a phone that locks halfway round the fence
 * still knows where the farmer has been.
 */
export function useWalkDraft(landUnitId: string): {
  readonly corners: readonly WalkFix[];
  readonly mark: (fix: WalkFix) => void;
  readonly dropLast: () => void;
  readonly discard: () => void;
} {
  const { draftFor } = useLandStores();
  const store = useMemo(() => draftFor(landUnitId), [draftFor, landUnitId]);
  const corners = useSyncExternalStore(store.subscribe, store.read);

  const mark = useCallback((fix: WalkFix) => store.write([...store.read(), fix]), [store]);
  const dropLast = useCallback(() => store.write(store.read().slice(0, -1)), [store]);
  const discard = useCallback(() => store.clear(), [store]);

  return { corners, mark, dropLast, discard };
}
