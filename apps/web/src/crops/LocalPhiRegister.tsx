/**
 * The device's copy of the PHI compliance register (4d·6, FR-205) — COMPLIANCE-GATED. Mirrors
 * `livestock/LocalResidueRegister.tsx` exactly, one food-safety boundary over: only the server can
 * see BOTH devices' evidence in the cross-device race this exists for, so it is cached exactly like
 * the residue register — refreshed opportunistically, read unconditionally, a refresh that fails is
 * an older list rather than an error.
 *
 * ⛔ Not the whole answer on its own: what this phone captured and has not sent yet is invisible to
 * the server and therefore absent from here — `phiRegister.ts`'s `useLocalPhiFlags` covers that
 * half, from the device's own log.
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
import { useAuth } from '../auth/AuthProvider';
import { useSyncStatus } from '../sync/useSyncStatus';
import { harvestApi, type PhiFlagRow } from './harvestApi';

export type StoredPhiFlag = PhiFlagRow;
export type PhiRegisterStore = ReferenceCache<StoredPhiFlag>;
export type PhiRegisterStoreFactory = (key: string) => PhiRegisterStore;

const defaultFactory: PhiRegisterStoreFactory = (key) =>
  createReferenceCache<StoredPhiFlag>({ storage: window.localStorage, key });

const PhiRegisterContext = createContext<PhiRegisterStore | null>(null);

export interface LocalPhiRegisterProviderProps {
  children: ReactNode;
  factory?: PhiRegisterStoreFactory;
}

export function LocalPhiRegisterProvider({
  children,
  factory = defaultFactory,
}: LocalPhiRegisterProviderProps) {
  const { session, activeFarm } = useAuth();
  const farmId = activeFarm?.id ?? 'none';
  const store = useMemo(() => factory(`werf-phi-register:${farmId}`), [factory, farmId]);
  const online = useSyncStatus().status !== 'offline';
  const token = session?.accessToken;

  useEffect(() => {
    if (!online || !token || activeFarm === undefined || activeFarm === null) return;
    let cancelled = false;
    void harvestApi
      .listPhiRegister(activeFarm.id, token)
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

  return <PhiRegisterContext.Provider value={store}>{children}</PhiRegisterContext.Provider>;
}

/** The server's flagged harvests for this farm, reactive. Empty until the first refresh lands. */
export function usePhiRegister(): readonly StoredPhiFlag[] {
  const store = useContext(PhiRegisterContext);
  if (!store) throw new Error('usePhiRegister must be used inside a LocalPhiRegisterProvider');
  return useSyncExternalStore(store.subscribe, store.all);
}
