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
  readonly session: ClientSession | null;
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
  signIn(
    input: schemas.LoginRequest,
  ): Promise<schemas.BrowserAuthSession | schemas.SecondFactorRequired>;
  completeSecondFactor(input: schemas.VerifySecondFactorRequest): Promise<void>;
  /**
   * Satisfies the second factor with a PASSKEY (FR-014, ADR-0007). Separate from
   * `completeSecondFactor` because it is a different exchange, not a different code: the server
   * issues a challenge, the device signs it, and the signature — never a secret the person typed —
   * comes back. It adopts the session through the same path, so there is one place a session
   * becomes the live one however it was earned.
   */
  completeSecondFactorWithPasskey(input: schemas.PasskeyAuthenticationRequest): Promise<void>;
  signOut(): Promise<void>;
  /** FR-004: switch the farm the shell is showing, without re-authenticating. */
  setActiveFarm(farmId: string): void;
  /** FR-004: add another farm to this business. Needs a connection — see the implementation. */
  addFarm(input: schemas.CreateFarmRequest): Promise<void>;
  /**
   * Re-reads the session from the server and returns the new access token (null when there is
   * no refresh token to spend). Used after enrolling a second factor, where the account's
   * posture changes server-side; and by the capture flush to recover a fresh access token when
   * a queued POST is refused with a 401 after a long spell offline.
   */
  refreshSession(): Promise<string | null>;
  /**
   * Writes the account's language back to the user row (FR-008) and patches the cached session so
   * the next cold start re-adopts the NEW locale instead of reverting. Resolves false when the
   * change could not be persisted (no signal, no session) — the caller has already applied it to
   * the device, so this reports whether it followed the person or only the phone.
   */
  saveLocale(locale: string): Promise<boolean>;
  /**
   * Sets or clears the active farm's FR-152 rest-period warning threshold (4e·2). Resolves false
   * rather than throwing when it cannot reach the server — see the implementation for why this is
   * `saveLocale`'s shape, not `addFarm`'s.
   */
  saveRestPeriodDays(days: number | null): Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export interface AuthProviderProps {
  children: ReactNode;
  /** Injected in tests; defaults to the real local store. */
  store?: SessionStore<schemas.OfflineSession>;
}

/** A live browser session, or an offline identity with no bearer credential in memory. */
type ClientSession = schemas.OfflineSession & {
  readonly accessToken: string | null;
  readonly expiresIn: number;
};

export function AuthProvider({ children, store }: AuthProviderProps) {
  // `useRef` with a lazy initialiser, not `useMemo`: this must be created exactly once and
  // must not be re-created by a re-render, because reading the store is how boot works.
  const storeRef = useRef<SessionStore<schemas.OfflineSession> | null>(null);
  const bootRefreshAttempted = useRef(false);
  storeRef.current ??= store ?? defaultStore();
  const sessions = storeRef.current;

  // Hydrated during the first render, from local storage. This is the line that makes an
  // offline cold start work.
  const [session, setSession] = useState<ClientSession | null>(() => {
    const cached = sessions.read()?.payload;
    if (!cached) return null;
    // `sanitizePersisted` has already removed these fields from storage. A pre-migration
    // short-lived access token may enter memory once so an in-field app upgrade does not stop a
    // running capture session; the rotating credential is deliberately never adopted.
    const legacy = cached as schemas.OfflineSession &
      Partial<Pick<schemas.BrowserAuthSession, 'accessToken' | 'expiresIn'>>;
    return {
      ...cached,
      accessToken: typeof legacy.accessToken === 'string' ? legacy.accessToken : null,
      expiresIn: typeof legacy.expiresIn === 'number' ? legacy.expiresIn : 0,
    };
  });

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
    (next: schemas.BrowserAuthSession): boolean => {
      // The network boundary is untrusted even when TypeScript says otherwise. An invalid response
      // must not replace a valid offline identity with `{}` and crash the shell.
      if (
        typeof next?.accessToken !== 'string' ||
        !next.user ||
        !Array.isArray(next.farms) ||
        !('secondFactor' in next)
      ) {
        return false;
      }
      // Identity and farm context may survive a reload. The bearer access token remains in React
      // memory, and the rotating refresh credential never reaches JavaScript at all.
      cacheOffline(sessions, next);
      setSession(next);
      return true;
    },
    [sessions],
  );

  useEffect(() => {
    if (bootRefreshAttempted.current || !session || session.accessToken) return;

    const restoreFromCookie = () => {
      if (bootRefreshAttempted.current) return;
      bootRefreshAttempted.current = true;
      // Do not put a loading wall in front of the cached farm. The cookie quietly restores an
      // in-memory token when a signal exists; offline work remains held until the browser's real
      // `online` event gives this effect a reason to try.
      void authApi
        .refresh()
        .then(adopt)
        .catch(() => undefined);
    };

    if (navigator.onLine) restoreFromCookie();
    else window.addEventListener('online', restoreFromCookie, { once: true });

    return () => window.removeEventListener('online', restoreFromCookie);
  }, [session, adopt]);

  const register = useCallback(
    async (input: schemas.RegisterRequest) => {
      adopt(await authApi.register(input));
    },
    [adopt],
  );

  const signIn = useCallback(
    async (
      input: schemas.LoginRequest,
    ): Promise<schemas.BrowserAuthSession | schemas.SecondFactorRequired> => {
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

  const completeSecondFactorWithPasskey = useCallback(
    async (input: schemas.PasskeyAuthenticationRequest) => {
      adopt(await authApi.passkeyVerify(input));
    },
    [adopt],
  );

  const signOut = useCallback(async () => {
    // Local state is cleared FIRST and regardless. A farmer who taps "sign out" with no
    // signal must end up signed out on this device; leaving them signed in because the
    // server was unreachable is the wrong failure direction for a phone that may have
    // just been handed to someone else.
    sessions.clear();
    setSession(null);

    try {
      await authApi.logout();
    } catch {
      // The server will expire the family on its own. Nothing useful to say here.
    }
  }, [sessions]);

  /**
   * FR-004. The DEVICE switches first and unconditionally; the server is told afterwards, and a
   * failure to tell it changes nothing about what the farmer sees.
   *
   * That order is the whole design. Which farm you are looking at is a view decision, and a farmer
   * standing in a camp with no signal must be able to change it — making the switch await a POST
   * would put the network in front of an action that needs no network. The server-side session
   * still matters (another device, and the next refresh, should agree), so it is told, best-effort,
   * and it catches up on its own the next time the app is opened in range.
   */
  const setActiveFarm = useCallback(
    (farmId: string) => {
      let token: string | undefined;
      setSession((current) => {
        if (!current || !current.farms.some((farm) => farm.id === farmId)) return current;
        token = current.accessToken ?? undefined;
        const next = { ...current, activeFarmId: farmId };
        cacheOffline(sessions, next);
        return next;
      });
      if (token) {
        void authApi.switchActiveFarm(token, farmId).catch(() => {
          // No signal, or a stale token. The device is already showing the right farm, which is
          // what the farmer asked for; nothing is lost and nothing needs saying.
        });
      }
    },
    [sessions],
  );

  /**
   * FR-004: add another farm to the business. Unlike a capture this genuinely NEEDS the network —
   * a farm is a tenancy root with RLS and memberships behind it, and inventing one offline would
   * create a farm no server has agreed to. So this is one of the few places the app is honest about
   * requiring a connection, and it says so rather than queuing something it cannot honour.
   */
  const addFarm = useCallback(
    async (input: schemas.CreateFarmRequest): Promise<void> => {
      const token = session?.accessToken;
      if (!token) throw new Error('Adding a farm needs a signed-in session');
      const farm = await authApi.createFarm(token, input);
      setSession((current) => {
        if (!current) return current;
        // Switched to immediately: someone who just created a farm wants to be in it.
        const next = { ...current, farms: [...current.farms, farm], activeFarmId: farm.id };
        cacheOffline(sessions, next);
        return next;
      });
    },
    [session, sessions],
  );

  const refreshSession = useCallback(async (): Promise<string | null> => {
    if (!session) return null;
    // The rotating credential remains in the HttpOnly cookie. Only the short-lived access token
    // enters React memory, while the durable cache receives the non-secret identity projection.
    const next = await authApi.refresh();
    return adopt(next) ? next.accessToken : null;
  }, [session, adopt]);

  /**
   * FR-008 write-back. The language change has already been applied to the running app by the
   * locale provider — this makes it stick to the PERSON.
   *
   * Failure is not an error to shout about: the farmer's app is already in the language they asked
   * for, and the only loss is that a different device (or the next cold start) will not know yet.
   * So it resolves false rather than throwing, and the screen says what that means. Nothing is
   * queued for retry: a preference is not a capture, and the write-queue rule exists to protect a
   * farmer's WORK, not their last tap on a radio button.
   */
  const saveLocale = useCallback(
    async (locale: string): Promise<boolean> => {
      const token = session?.accessToken;
      if (!token) return false;
      try {
        const user = await authApi.updateProfile(token, {
          locale: locale as schemas.UpdateProfileRequest['locale'],
        });
        // Patch the CACHED session too, or the next cold start re-adopts the old locale from it
        // and silently undoes what the server has just accepted.
        setSession((current) => {
          if (!current) return current;
          const next = { ...current, user };
          cacheOffline(sessions, next);
          return next;
        });
        return true;
      } catch {
        return false;
      }
    },
    [session, sessions],
  );

  /**
   * FR-152 write-back (4e·2). Mirrors `saveLocale`, not `addFarm`: this is a per-farm PREFERENCE
   * an owner sets, not a tenancy-root-minting action, so there is no local write path to fall
   * back to and none is needed — it resolves false rather than throwing when offline, and the
   * screen states that plainly rather than queuing a settings edit as though it were a farmer's
   * captured work (CLAUDE.md's write-queue rule protects work, not a preference toggle).
   */
  const saveRestPeriodDays = useCallback(
    async (days: number | null): Promise<boolean> => {
      const token = session?.accessToken;
      const farmId = resolveActiveFarm(session)?.id;
      if (!token || !farmId) return false;
      try {
        const farm = await authApi.updateRestPeriodDays(token, farmId, { restPeriodDays: days });
        setSession((current) => {
          if (!current) return current;
          const next = {
            ...current,
            farms: current.farms.map((f) => (f.id === farmId ? farm : f)),
          };
          cacheOffline(sessions, next);
          return next;
        });
        return true;
      } catch {
        return false;
      }
    },
    [session, sessions],
  );

  const value = useMemo<AuthContextValue>(() => {
    const activeFarm = resolveActiveFarm(session);

    return {
      session,
      activeFarm,
      isAuthenticated: session !== null,
      mustEnrolSecondFactor: session?.secondFactor === 'required',
      register,
      signIn,
      completeSecondFactor,
      completeSecondFactorWithPasskey,
      signOut,
      setActiveFarm,
      addFarm,
      refreshSession,
      saveLocale,
      saveRestPeriodDays,
    };
  }, [
    session,
    register,
    signIn,
    completeSecondFactor,
    completeSecondFactorWithPasskey,
    signOut,
    setActiveFarm,
    addFarm,
    refreshSession,
    saveLocale,
    saveRestPeriodDays,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider');
  return context;
}

function defaultStore(): SessionStore<schemas.OfflineSession> {
  return createSessionStore<schemas.OfflineSession>({
    storage: window.localStorage,
    sanitizePersisted: sanitizeOfflineSession,
  });
}

/**
 * The single rule for which farm the shell is showing: the one named by `activeFarmId`, or the
 * first farm on the session when there is none (a session cached before it existed, or one that
 * never explicitly switched). ONE function, not a hand-duplicated inline expression, because a
 * second copy of this rule is exactly the kind of drift CLAUDE.md's schema-duplication warning
 * generalises to — `saveRestPeriodDays` writing to a different farm than `activeFarm` displays
 * would be a silent, farm-scoped version of that same defect class.
 */
function resolveActiveFarm(session: ClientSession | null): schemas.SessionFarm | null {
  return (
    session?.farms.find((farm) => farm.id === session.activeFarmId) ?? session?.farms[0] ?? null
  );
}

function cacheOffline(
  sessions: SessionStore<schemas.OfflineSession>,
  session: ClientSession | schemas.BrowserAuthSession,
): void {
  // Strip the legacy fields defensively too. A stale service worker or an accidentally old API
  // response must not be able to reintroduce a long-lived credential into browser storage.
  const candidate = session as typeof session &
    Partial<Pick<schemas.AuthSession, 'refreshToken' | 'refreshExpiresAt'>>;
  const {
    accessToken: _accessToken,
    expiresIn: _expiresIn,
    refreshToken: _refreshToken,
    refreshExpiresAt: _refreshExpiresAt,
    ...offline
  } = candidate;
  sessions.write(offline);
}

function sanitizeOfflineSession(payload: unknown): schemas.OfflineSession {
  if (typeof payload !== 'object' || payload === null) throw new TypeError('Invalid session cache');
  const candidate = payload as Record<string, unknown>;
  const {
    accessToken: _accessToken,
    expiresIn: _expiresIn,
    refreshToken: _refreshToken,
    refreshExpiresAt: _refreshExpiresAt,
    ...offline
  } = candidate;
  if (!offline['user'] || !Array.isArray(offline['farms'])) {
    throw new TypeError('Invalid session identity cache');
  }
  return offline as schemas.OfflineSession;
}
