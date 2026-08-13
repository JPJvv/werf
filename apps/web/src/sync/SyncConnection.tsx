/**
 * The app-level down-sync connection lifecycle (phase-checklists.md 3e). Owns the ONLY call to
 * `LocalDatabase.connect()`/`.disconnect()` this application makes — mounted once, inside
 * `AppShell`, so it lives exactly as long as an authenticated session does and never a route.
 *
 * Four rules, all from the slice's requirements:
 *
 *  1. NO CONNECTION WITHOUT A VALID USER. `.connect()` is attempted only once a real access token
 *     exists in memory — an offline cold start with a cached identity but no token (the ordinary
 *     case: `RequireAuth` admits a farmer on a cached session before any network call has run)
 *     never opens a sync connection, because down-sync cannot do anything useful without one and
 *     ADR-0003's promise is that the network is a background enhancement, never a gate.
 *  2. RECONNECT SAFELY AFTER REFRESHED CREDENTIALS, WITHOUT RECONNECTING. `fetchCredentials`
 *     (`packages/sync/src/connector.ts`) is re-invoked by the SDK itself before every credential
 *     expiry — "always fetch a fresh set of credentials" is that function's own contract. This
 *     file's `getAccessToken` callback reads a ref kept current every render, so the SDK always
 *     sees the freshest token without this component ever calling `.connect()` a second time.
 *  3. NEVER CLEAR QUEUED CAPTURES BECAUSE AUTHENTICATION EXPIRED. `disconnect()`, never
 *     `disconnectAndClear()` — the latter can drop local-only tables depending on its options, and
 *     even the option that spares them is the wrong verb for "we lost sync", which touches nothing
 *     `Outbox.tsx`'s queue depends on. Down-sync pausing must never be visible as a lost capture.
 *  4. FARM CHANGE FILTERS RATHER THAN RECONNECTS. Sync Streams are per-USER, not per-farm
 *     (`connector.ts`'s header) — switching the active farm does not change what the connection
 *     receives, only which of it `HydratedLivestock.tsx`'s farm-scoped queries read. Reconnecting
 *     on every farm switch would be churn with no correctness benefit.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import {
  createEventRetentionController,
  createSyncConnector,
  type EventRetentionController,
  type FarmEventRetention,
} from '@werf/sync';
import { useAuth } from '../auth/AuthProvider';
import { getLocalDatabase } from './local-db';

/** Same base every other API call in this app uses — mirrors captureApi.ts/auth/api.ts. */
const API_BASE = (import.meta.env['VITE_API_URL'] as string | undefined) ?? '/api';

export interface SyncConnectionProviderProps {
  children: ReactNode;
}

export function SyncConnectionProvider({ children }: SyncConnectionProviderProps) {
  const { session, refreshSession } = useAuth();
  const accessToken = session?.accessToken ?? null;
  // The effect's actual dependency. A PRESENCE flip, not the token STRING, so a routine rotation
  // never tears the connection down and back up — `getAccessToken` below reads the live value via
  // a ref instead.
  const hasToken = accessToken !== null;

  // Read by `getAccessToken` below, kept current every render — the same "assign a ref during
  // render" convention `Outbox.tsx` already uses for its own token/queue refs.
  const tokenRef = useRef<string | null>(accessToken);
  tokenRef.current = accessToken;
  const refreshSessionRef = useRef(refreshSession);
  refreshSessionRef.current = refreshSession;
  const farmRetention: readonly FarmEventRetention[] =
    session?.farms.map((farm) => ({
      farmId: farm.id,
      months: farm.eventRetentionMonths,
    })) ?? [];
  const farmRetentionRef = useRef(farmRetention);
  farmRetentionRef.current = farmRetention;
  // Active-farm switches do not change this key. A genuine retention-setting/farm-list change
  // does, and deserves one controlled reconnect so its subscription set is rebuilt.
  const farmRetentionKey = farmRetention
    .map((farm) => `${farm.farmId}:${farm.months}`)
    .sort()
    .join('|');

  useEffect(() => {
    // Rule 1: nothing to connect without a token.
    if (!hasToken) return;

    let cancelled = false;
    let retentionController: EventRetentionController | null = null;
    void (async () => {
      const db = await getLocalDatabase();
      if (cancelled) return;
      const connector = createSyncConnector({
        apiBaseUrl: API_BASE,
        getAccessToken: async () => {
          // Rule 2: the freshest token this render cycle knows about. When it is absent — the
          // access token expired while this connection sat idle with nothing else to trigger a
          // refresh — fall back to the SAME recovery path `Outbox.tsx`'s 401 handling already
          // trusts, rather than a second, divergent one.
          if (tokenRef.current) return tokenRef.current;
          try {
            return await refreshSessionRef.current();
          } catch {
            return null;
          }
        },
      });
      try {
        if (!db.connected) await db.connect(connector);
        if (cancelled) return;
        const nextRetentionController = createEventRetentionController({
          database: db,
          farms: farmRetentionRef.current,
        });
        if (cancelled) nextRetentionController.close();
        else retentionController = nextRetentionController;
      } catch {
        // A failed connect is a down-sync problem, not a capture-path one — offline writes do not
        // depend on this succeeding, and the SDK governs its own retry/backoff. Nothing here
        // needs to surface it; `Outbox.tsx`'s hydration-failed gating covers the read side.
      }
    })();

    return () => {
      cancelled = true;
      retentionController?.close();
      // Rule 3: disconnect, never disconnectAndClear. Fires on sign-out (accessToken -> null,
      // `AuthProvider.signOut` clears the session synchronously) and on unmount — RequireAuth
      // only mounts this provider's parent (`AppShell`) for an authenticated route.
      void getLocalDatabase().then((db) => {
        if (db.connected) void db.disconnect();
      });
    };
  }, [hasToken, farmRetentionKey]);

  return <>{children}</>;
}
