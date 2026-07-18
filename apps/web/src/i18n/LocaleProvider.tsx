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
 * Locale state for the running app. In Phase 1 this persists to localStorage; the auth slice
 * will seed it from the signed-in user's `locale` and write changes back to the user row
 * (locale is per user, FR-008). Same offline discipline as theme: read synchronously, no fetch.
 */

const LOCALE_STORAGE_KEY = 'werf-locale';

interface LocaleContextValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
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
      t: (key: TranslationKey) => dictionaries[locale][key],
    }),
    [locale, setLocale],
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
