import { useCallback, useEffect, useState } from 'react';
import { APPEARANCE_CHOICES, THEME_STORAGE_KEY, type Appearance, type Theme } from '@werf/ui';

/**
 * The in-app half of theming (FR-016). The pre-paint half — reading the stored choice and
 * setting [data-theme] before first render so a dark user never gets a white flash at 5am —
 * lives in index.html; this hook keeps that same localStorage key and <html> attribute in
 * sync while the app runs. The two MUST agree on the key (THEME_STORAGE_KEY) and semantics.
 *
 * Default is light. It does NOT follow the OS unless the user chooses "Match my phone"
 * (stored as 'system') — a farmer who set their phone dark at night must not get a mirror
 * in a crush at noon. This overrides the platform convention on purpose.
 */

function prefersDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;
}

/** The concrete theme a choice resolves to right now. 'system' asks the OS; the rest are literal. */
export function resolveTheme(appearance: Appearance): Theme {
  if (appearance === 'system') return prefersDark() ? 'dark' : 'light';
  return appearance;
}

function readStoredAppearance(): Appearance {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored && (APPEARANCE_CHOICES as readonly string[]).includes(stored)) {
      return stored as Appearance;
    }
  } catch {
    // Private mode / storage disabled — fall through to the light default.
  }
  return 'light';
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
}

export interface UseAppearance {
  appearance: Appearance;
  setAppearance: (next: Appearance) => void;
}

export function useAppearance(): UseAppearance {
  const [appearance, setAppearanceState] = useState<Appearance>(readStoredAppearance);

  // Persist the choice and reflect the resolved theme onto <html> whenever it changes.
  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, appearance);
    } catch {
      // Non-fatal: the theme still applies for this session.
    }
    applyTheme(resolveTheme(appearance));
  }, [appearance]);

  // Only when following the OS do we react to the OS flipping light/dark live.
  useEffect(() => {
    if (appearance !== 'system') return;
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme(resolveTheme('system'));
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [appearance]);

  const setAppearance = useCallback((next: Appearance) => setAppearanceState(next), []);

  return { appearance, setAppearance };
}
