/**
 * Who is signed in, and the farm they are looking at (FR-004, FR-006).
 *
 * The important behaviour is the boot path: the session is hydrated SYNCHRONOUSLY from the
 * local store before first render. No loading spinner, no `useEffect` that fetches, no
 * flash of a login screen. A farmer opening the app in a camp with no signal sees their
 * farm, because the answer to "who is this?" was already on the device.
 *
 * Session state is React context rather than TanStack Query on purpose. Query caches
 * SERVER state and revalidates it; a session that must survive thirty days with no server
 * is local durable state that happens to have come from a server once. Treating it as a
 * query would make the network the source of truth for whether the app opens, which is
 * exactly backwards for this product. TanStack Query remains the tool for the API path
 * proper (payroll, reports) when those arrive.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createSessionStore, type SessionStore } from '@werf/sync';
import type { schemas } from '@werf/core';
import { authApi } from './api';
import { useTranslation } from '../i18n/LocaleProvider';

export interface AuthContextValue {
  readonly session: schemas.AuthSession | null;
  /** The farm the shell is currently showing. Null before a farm exists. */
  readonly activeFarm: schemas.SessionFarm | null;
  readonly isAuthenticated: boolean;
  /** True when the account owes an enrolment and the server will refuse everything else. */
  readonly mustEnrolSecondFactor: boolean;

  register(input: schemas.RegisterRequest): Promise<void>;
  /**
   * Returns what the server decided: a live session, or a challenge that the caller must
   * complete with a second factor. The screen branches on this rather than the provider
   * guessing.
   */
  signIn(input: schemas.LoginRequest): Promise<schemas.LoginResponse>;
  completeSecondFactor(input: schemas.VerifySecondFactorRequest): Promise<void>;
  signOut(): Promise<void>;
  /** FR-004: switch the farm the shell is showing, without re-authenticating. */
  setActiveFarm(farmId: string): void;
  /**
   * Re-reads the session from the server and returns the new access token (null when there is
   * no refresh token to spend). Used after enrolling a second factor, where the account's
   * posture changes server-side; and by the capture flush to recover a fresh access token when
   * a queued POST is refused with a 401 after a long spell offline.
   */
  refreshSession(): Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export interface AuthProviderProps {
  children: ReactNode;
  /** Injected in tests; defaults to the real local store. */
  store?: SessionStore<schemas.AuthSession>;
}

export function AuthProvider({ children, store }: AuthProviderProps) {
  // `useRef` with a lazy initialiser, not `useMemo`: this must be created exactly once and
  // must not be re-created by a re-render, because reading the store is how boot works.
  const storeRef = useRef<SessionStore<schemas.AuthSession> | null>(null);
  storeRef.current ??= store ?? defaultStore();
  const sessions = storeRef.current;

  // Hydrated during the first render, from local storage. This is the line that makes an
  // offline cold start work.
  const [session, setSession] = useState<schemas.AuthSession | null>(
    () => sessions.read()?.payload ?? null,
  );

  const { adoptUserLocale } = useTranslation();

  /**
   * The account's language wins over the device's (FR-008). A farmer who chose Afrikaans
   * must get Afrikaans on a borrowed tablet that has never been told.
   *
   * An effect rather than a line inside `adopt`, because the cold-start path does not go
   * through `adopt` — a cached session arrives via `useState`, and handling only the login
   * path would leave the device language showing until the next sign-in. Re-running is
   * free: setting the same locale is a no-op.
   */
  useEffect(() => {
    if (session) adoptUserLocale(session.user.locale);
  }, [session, adoptUserLocale]);

  const adopt = useCallback(
    (next: schemas.AuthSession) => {
      sessions.write(next);
      setSession(next);
    },
    [sessions],
  );

  const register = useCallback(
    async (input: schemas.RegisterRequest) => {
      adopt(await authApi.register(input));
    },
    [adopt],
  );

  const signIn = useCallback(
    async (input: schemas.LoginRequest): Promise<schemas.LoginResponse> => {
      const result = await authApi.login(input);
      // A second-factor challenge is NOT a session and must never be cached as one. The
      // response shape cannot hold tokens, so this check is belt and braces on a contract
      // that already refuses to carry them.
      if ('accessToken' in result) adopt(result);
      return result;
    },
    [adopt],
  );

  const completeSecondFactor = useCallback(
    async (input: schemas.VerifySecondFactorRequest) => {
      adopt(await authApi.verifySecondFactor(input));
    },
    [adopt],
  );

  const signOut = useCallback(async () => {
    const refreshToken = session?.refreshToken;
    // Local state is cleared FIRST and regardless. A farmer who taps "sign out" with no
    // signal must end up signed out on this device; leaving them signed in because the
    // server was unreachable is the wrong failure direction for a phone that may have
    // just been handed to someone else.
    sessions.clear();
    setSession(null);

    if (refreshToken) {
      try {
        await authApi.logout(refreshToken);
      } catch {
        // The server will expire the family on its own. Nothing useful to say here.
      }
    }
  }, [session, sessions]);

  const setActiveFarm = useCallback(
    (farmId: string) => {
      setSession((current) => {
        if (!current || !current.farms.some((farm) => farm.id === farmId)) return current;
        const next = { ...current, activeFarmId: farmId };
        sessions.write(next);
        return next;
      });
    },
    [sessions],
  );

  const refreshSession = useCallback(async (): Promise<string | null> => {
    const refreshToken = session?.refreshToken;
    if (!refreshToken) return null;
    // Rotation is single-use, so the response carries a NEW refresh token — adopting the
    // whole session rather than patching a field is what keeps the stored token the live
    // one. Patching would leave a spent token cached and log the farmer out on next use.
    const next = await authApi.refresh(refreshToken);
    adopt(next);
    return next.accessToken;
  }, [session, adopt]);

  const value = useMemo<AuthContextValue>(() => {
    const activeFarm =
      session?.farms.find((farm) => farm.id === session.activeFarmId) ?? session?.farms[0] ?? null;

    return {
      session,
      activeFarm,
      isAuthenticated: session !== null,
      mustEnrolSecondFactor: session?.secondFactor === 'required',
      register,
      signIn,
      completeSecondFactor,
      signOut,
      setActiveFarm,
      refreshSession,
    };
  }, [session, register, signIn, completeSecondFactor, signOut, setActiveFarm, refreshSession]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider');
  return context;
}

function defaultStore(): SessionStore<schemas.AuthSession> {
  return createSessionStore<schemas.AuthSession>({ storage: window.localStorage });
}
