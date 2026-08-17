/**
 * Offline session persistence (FR-006).
 *
 * Lives in the sync package rather than in `apps/web` because it is local durable state,
 * and application code reaches local durable state through this adapter — never through a
 * storage API directly (ADR-0003, .claude/rules/frontend.md). In Phase 1 the backing store
 * is `localStorage`; in Phase 3 it becomes the same OPFS/SQLite the rest of the local data
 * uses. Everything above this seam is unaffected by that swap, which is the point.
 *
 * What this exists for: a farmer opens the app on a cold start, in a camp, with no signal.
 * The shell has to render — their name, their language, their farms, their tiles — without
 * asking the server anything. A login wall at that moment is the product failing at the
 * exact moment it claims to be useful.
 */

/**
 * The default offline window: 30 days (ADR-0007). It measures SILENCE, not account age —
 * every successful contact with the server pushes it out again, so a farmer who syncs on
 * day 21 of a month in the veld gets another 30 days.
 */
export const DEFAULT_SESSION_WINDOW_DAYS = 30;

const STORAGE_KEY = 'werf-session';

/**
 * The cached session. Deliberately opaque about its payload: this module's job is the
 * lifecycle (store it, hand it back, know when it is too old), not the shape of an auth
 * response, which belongs to `@werf/core`. Typing it as a generic keeps the sync package
 * free of a dependency on the auth contract.
 */
export interface CachedSession<TPayload> {
  readonly payload: TPayload;
  /** When the server last confirmed this session, ISO 8601. The window measures from here. */
  readonly confirmedAt: string;
}

export interface SessionStore<TPayload> {
  /** The cached session, or null if there is none or it has aged out of the window. */
  read(): CachedSession<TPayload> | null;
  /** Stores a session and restarts the window. Call on every successful server contact. */
  write(payload: TPayload): void;
  /**
   * Forgets the session. This is a LOGOUT, and it must never be called merely because a
   * token expired — see the note on `isWithinWindow`.
   */
  clear(): void;
}

/** The slice of the Storage API this needs. Injected, so the store is testable and swappable. */
export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SessionStoreOptions<TPayload = unknown> {
  readonly storage: SessionStorageLike;
  readonly windowDays?: number;
  /** Injected so window expiry is testable without waiting a month. */
  readonly now?: () => Date;
  /**
   * One-way migration applied to the durable payload before it is returned. The original payload
   * is returned to the current tab once, so a short-lived legacy credential can move into memory,
   * while storage is rewritten immediately without extending `confirmedAt`.
   */
  readonly sanitizePersisted?: (payload: unknown) => TPayload;
}

export function createSessionStore<TPayload>(
  options: SessionStoreOptions<TPayload>,
): SessionStore<TPayload> {
  const {
    storage,
    windowDays = DEFAULT_SESSION_WINDOW_DAYS,
    now = () => new Date(),
    sanitizePersisted,
  } = options;

  return {
    read(): CachedSession<TPayload> | null {
      const raw = storage.getItem(STORAGE_KEY);
      if (raw === null) return null;

      let parsed: CachedSession<TPayload>;
      try {
        parsed = JSON.parse(raw) as CachedSession<TPayload>;
      } catch {
        // Corrupt or half-written — treat as "no session" rather than throwing. A parse
        // error here would otherwise crash the app on boot, offline, with no way out.
        return null;
      }

      if (!parsed?.payload || typeof parsed.confirmedAt !== 'string') return null;
      if (sanitizePersisted) {
        try {
          const sanitized = sanitizePersisted(parsed.payload);
          storage.setItem(
            STORAGE_KEY,
            JSON.stringify({ payload: sanitized, confirmedAt: parsed.confirmedAt }),
          );
        } catch {
          // An unrecognisable identity cache is not authority and must not crash boot. Removing it
          // cannot remove captures: those live in separate stores by invariant.
          storage.removeItem(STORAGE_KEY);
          return null;
        }
      }
      if (!isWithinWindow(parsed.confirmedAt, windowDays, now())) return null;

      return parsed;
    },

    write(payload: TPayload): void {
      const entry: CachedSession<TPayload> = {
        payload,
        confirmedAt: now().toISOString(),
      };
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(entry));
      } catch {
        // Quota exceeded, or storage disabled (private browsing on some platforms). The
        // session is still live in memory for this tab, so the app keeps working — it just
        // will not survive a cold start. Failing the login over this would be worse.
      }
    },

    clear(): void {
      storage.removeItem(STORAGE_KEY);
    },
  };
}

/**
 * Whether a session confirmed at `confirmedAt` is still inside the offline window.
 *
 * Read the consequence carefully: FALSE means the cached session no longer renders the
 * shell and the farmer must sign in again. It does NOT mean anything may be deleted.
 * Pending writes belong to the farmer, not to the session — an expired token holds the
 * queue, it never clears it (offline-sync invariant 5). `if (tokenExpired) queue.clear()`
 * is a plausible two-line change that destroys a month of work in a signal dead zone.
 */
export function isWithinWindow(confirmedAt: string, windowDays: number, at: Date): boolean {
  const confirmed = Date.parse(confirmedAt);
  if (Number.isNaN(confirmed)) return false;

  // A confirmation in the future means a clock moved — the device's or ours. Treating it
  // as valid is the safe direction: the alternative locks out a farmer whose phone clock
  // is wrong, offline, with no way to correct it.
  const elapsedMs = at.getTime() - confirmed;
  if (elapsedMs < 0) return true;

  return elapsedMs < windowDays * 24 * 60 * 60 * 1000;
}
