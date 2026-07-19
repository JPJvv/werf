import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  DEFAULT_LOCALE,
  LOCALES,
  dictionaries,
  type Locale,
  type TranslationKey,
} from './dictionaries';

/**
 * Locale state for the running app (FR-008).
 *
 * The device preference in localStorage is a stand-in for a person we have not met yet.
 * Once a session identifies the user, `adoptUserLocale` switches to THEIR language — the
 * locale lives on the user row, so it follows them onto a borrowed tablet. Changes made
 * while signed in are not yet written back to that row; see the note on `setLocale`.
 *
 * Same offline discipline as theme: read synchronously on boot, never fetched.
 */

const LOCALE_STORAGE_KEY = 'werf-locale';

interface LocaleContextValue {
  locale: Locale;
  /**
   * Changes the language for this device. NOT yet persisted to the user row — the API has
   * no profile-update endpoint, so a change made here follows the device rather than the
   * person until the next sign-in re-adopts the stored account locale. Tracked as a Phase 2
   * follow-up; the onboarding choice IS stored on the account (RegisterScreen).
   */
  setLocale: (next: Locale) => void;
  /** Adopts the signed-in account's language. Called by the auth provider, never by a screen. */
  adoptUserLocale: (next: string) => void;
  t: (key: TranslationKey) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

function readStoredLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored && (LOCALES as readonly string[]).includes(stored)) {
      return stored as Locale;
    }
  } catch {
    // Storage unavailable — fall through to the default.
  }
  return DEFAULT_LOCALE;
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readStoredLocale);

  /**
   * Adopts the language attached to the signed-in account (FR-008).
   *
   * The device preference is only a stand-in for a person we do not know yet. Once a
   * session says who this is, THEIR language wins — a farmer who chose Afrikaans and then
   * signs in on the bakkie's tablet must not get English because that device has never
   * been told. Called by the auth provider on adopt rather than read from here, so the
   * i18n layer keeps knowing nothing about auth.
   */
  const adoptUserLocale = useCallback((next: string) => {
    if ((LOCALES as readonly string[]).includes(next)) setLocaleState(next as Locale);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // Non-fatal: the language still applies for this session.
    }
    // Keep the document language in sync for assistive tech and hyphenation.
    document.documentElement.setAttribute('lang', locale);
  }, [locale]);

  const setLocale = useCallback((next: Locale) => setLocaleState(next), []);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale,
      adoptUserLocale,
      t: (key: TranslationKey) => dictionaries[locale][key],
    }),
    [locale, setLocale, adoptUserLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useTranslation(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (ctx === null) {
    throw new Error('useTranslation must be used within a LocaleProvider');
  }
  return ctx;
}
