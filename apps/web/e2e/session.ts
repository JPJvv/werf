/**
 * The signed-in session the e2e lane boots from, and the seeding helper the specs share.
 *
 * The app reads this synchronously during its first render, so seeding it is the same thing as a
 * farmer opening an app they signed into last week — and it is what lets this lane exercise the
 * shell without standing up the API and a database.
 */

import type { Page } from '@playwright/test';
import { THEME_STORAGE_KEY } from '@werf/ui';

export const SESSION_KEY = 'werf-session';
export const FARM_ID = '0190f3a0-0000-7000-8000-0000000000f1';

/** The farm's herd (FR-113). One, so a capture screen asks nothing and files under it. */
export const HERD = {
  id: '0190f3a0-0000-7000-8000-00000000e001',
  name: 'Bonsmara cows',
  type: 'beef_cattle',
};

export function cachedSession(
  secondFactor: 'complete' | 'required' = 'complete',
): Record<string, unknown> {
  return {
    payload: {
      accessToken: 'e2e-access-token',
      expiresIn: 900,
      refreshToken: 'e2e-refresh-token',
      refreshExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      user: {
        id: '0190f3a0-0000-7000-8000-000000000001',
        email: 'thabo@rietfontein.test',
        phone: null,
        fullName: 'Thabo Mokoena',
        locale: 'en-ZA',
        theme: 'light',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null,
      },
      farms: [
        {
          id: FARM_ID,
          name: 'Rietfontein',
          enterpriseTypes: ['beef_cattle', 'row_crops'],
          enterprises: [HERD],
          role: 'owner',
        },
      ],
      activeFarmId: FARM_ID,
      secondFactor,
    },
    confirmedAt: new Date().toISOString(),
  };
}

export interface SeedOptions {
  /** False to boot signed out. */
  session?: boolean;
  theme?: string;
  secondFactor?: 'complete' | 'required';
}

/** Seeds the session (and optionally the theme) before any app code runs. */
export async function seed(page: Page, options: SeedOptions = {}): Promise<void> {
  await page.addInitScript(
    ([sessionKey, session, themeKey, theme]) => {
      if (session) window.localStorage.setItem(sessionKey as string, session as string);
      if (theme) window.localStorage.setItem(themeKey as string, theme as string);
    },
    [
      SESSION_KEY,
      options.session === false
        ? ''
        : JSON.stringify(cachedSession(options.secondFactor ?? 'complete')),
      THEME_STORAGE_KEY,
      options.theme ?? '',
    ] as const,
  );
}

/**
 * NFR-401. `withTags` scopes an axe run to the WCAG levels we commit to, so a new axe release
 * adding an experimental rule cannot fail the build overnight — the standard is the contract, not
 * whatever the tool happens to check this month.
 */
export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
