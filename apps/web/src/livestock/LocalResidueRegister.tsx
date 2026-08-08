/**
 * The device's copy of the residue register (FR-131) — COMPLIANCE-GATED.
 *
 * ⭐ This is the one thing in livestock the device genuinely CANNOT work out for itself, and that is
 * the whole reason it exists. Every other guard in this folder runs locally on purpose: a rule that
 * only the server can apply arrives days after the truck has left. But the case this register was
 * built for is two phones in two dead zones — one records Monday's dip, the other tallies forty head
 * to the abattoir on Tuesday — and neither device has ever heard of the other's capture. Only the
 * server holds both, so only the server can say the disposal was inside a withholding.
 *
 * So it is cached exactly like the veterinary-product register, and for the same reason: refreshed
 * opportunistically, read unconditionally, and a refresh that fails is an older list rather than an
 * error. A farmer who opens this screen in a shed with no signal still sees what the server last
 * told them, which is far better than a spinner or an empty page.
 *
 * ⛔ It is NOT the whole answer on its own, and the screen does not treat it as one. What this phone
 * captured five minutes ago and has not sent yet is invisible to the server and therefore absent
 * from here — `useLocalResidueFlags` in `residue.ts` covers that half, from the device's own log.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createReferenceCache, type ReferenceCache } from '@werf/sync';
import type { schemas } from '@werf/core';
import { useAuth } from '../auth/AuthProvider';
import { useSyncStatus } from '../sync/useSyncStatus';
import { livestockApi } from './livestockApi';

/**
 * A flagged disposal as the device holds it — the wire contract verbatim, derived from the schema
 * rather than restated. A hand-written duplicate of a server shape drifts silently and in one
 * direction, which is how a plausible-looking field ends up meaning nothing.
 *
 * ⭐ The `Json` variant, not the parsed one. `occurredAt` is an ISO STRING here: it arrives as one
 * over the wire and it survives in `localStorage` as one, because JSON has no Date. Typing this as
 * the parsed shape would compile and then crash on a cold start, which is the exact reason every
 * capture store in this app keeps its instants as strings.
 */
export type StoredResidueFlag = schemas.ResidueFlagJson;

export type ResidueRegisterStore = ReferenceCache<StoredResidueFlag>;
export type ResidueRegisterStoreFactory = (key: string) => ResidueRegisterStore;

const defaultFactory: ResidueRegisterStoreFactory = (key) =>
  createReferenceCache<StoredResidueFlag>({ storage: window.localStorage, key });

const ResidueRegisterContext = createContext<ResidueRegisterStore | null>(null);

export interface LocalResidueRegisterProviderProps {
  children: ReactNode;
  factory?: ResidueRegisterStoreFactory;
}

export function LocalResidueRegisterProvider({
  children,
  factory = defaultFactory,
}: LocalResidueRegisterProviderProps) {
  const { session, activeFarm } = useAuth();
  const farmId = activeFarm?.id ?? 'none';
  const store = useMemo(() => factory(`werf-residue-register:${farmId}`), [factory, farmId]);
  const online = useSyncStatus().status !== 'offline';
  const token = session?.accessToken;

  useEffect(() => {
    if (!online || !token || activeFarm === undefined || activeFarm === null) return;
    let cancelled = false;
    void livestockApi
      .listResidueRegister(activeFarm.id, token)
      .then((flags) => {
        if (!cancelled) store.replace(flags);
      })
      .catch(() => {
        /* An older register is not an error. */
      });
    return () => {
      cancelled = true;
    };
  }, [online, token, activeFarm, store]);

  return (
    <ResidueRegisterContext.Provider value={store}>{children}</ResidueRegisterContext.Provider>
  );
}

/** The server's flagged disposals for this farm, reactive. Empty until the first refresh lands. */
export function useResidueRegister(): readonly StoredResidueFlag[] {
  const store = useContext(ResidueRegisterContext);
  if (!store) {
    throw new Error('useResidueRegister must be used inside a LocalResidueRegisterProvider');
  }
  return useSyncExternalStore(store.subscribe, store.all);
}
