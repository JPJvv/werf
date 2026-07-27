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

/**
 * A herd, a counted flock, a vet product and a dose — enough that a capture screen renders its
 * CONTROLS rather than its empty state.
 *
 * ⭐ This exists because the a11y lane was auditing seventeen screens and almost no widgets. With
 * only the session seeded, every capture screen took its `length === 0` branch and rendered one
 * sentence — while the spec's own guard ("assert the heading is visible before auditing") passed,
 * because the heading sits OUTSIDE the conditional. So the animal picker, the outcome buttons, the
 * withholding panels, the date fields and the mob picker had never been in front of axe in either
 * theme, on a page the checklist claimed was covered.
 */
export const FIXTURE = {
  animalId: '0190f3a0-0000-7000-8000-0000000000a1',
  mobId: '0190f3a0-0000-7000-8000-0000000000b1',
  productId: '0190f3a0-0000-7000-8000-0000000000d1',
  campId: '0190f3a0-0000-7000-8000-0000000000c1',
} as const;

/** localStorage entries that put a farm's worth of stock on the device. */
export function populatedStores(): Record<string, unknown> {
  const today = new Date().toISOString().slice(0, 10);
  return {
    [`werf-land:${FARM_ID}`]: [
      {
        id: FIXTURE.campId,
        farmId: FARM_ID,
        code: 'NOORD',
        name: null,
        hectares: 12,
        kind: 'camp',
      },
    ],
    [`werf-herd:${FARM_ID}`]: [
      {
        id: FIXTURE.animalId,
        farmId: FARM_ID,
        enterpriseId: HERD.id,
        species: 'cattle',
        breed: 'Bonsmara',
        sex: 'female',
        dob: null,
        dobEstimated: false,
        status: 'alive',
        statusAt: null,
        damId: null,
        sireId: null,
        mobId: null,
        landUnitId: FIXTURE.campId,
        source: null,
        acquiredAt: null,
        brandId: null,
        brandAppliedAt: null,
        attributes: {},
        photoKey: null,
      },
    ],
    [`werf-mobs:${FARM_ID}`]: [
      {
        id: FIXTURE.mobId,
        farmId: FARM_ID,
        enterpriseId: HERD.id,
        name: 'Ossies',
        species: 'cattle',
        landUnitId: FIXTURE.campId,
        headCount: 300,
        initialHeadCount: 300,
      },
    ],
    [`werf-vet-products:${FARM_ID}`]: [
      {
        id: FIXTURE.productId,
        name: 'Terramycin LA',
        registrationNumber: 'G1234 Act 36/1947',
        species: ['cattle'],
        meatWithdrawalDays: 28,
        milkWithdrawalHours: 96,
        route: 'intramuscular',
      },
    ],
    // A dose given TODAY, so the withholding panels — the two newest controls on these screens,
    // and the ones that carry a colour meaning — actually render under the audit.
    [`werf-health:${FARM_ID}`]: [
      {
        id: '0190f3a0-0000-7000-8000-0000000000f1',
        farmId: FARM_ID,
        animalId: FIXTURE.animalId,
        mobId: null,
        kind: 'treatment',
        occurredAt: new Date().toISOString(),
        administeredOn: today,
        productId: FIXTURE.productId,
      },
      {
        id: '0190f3a0-0000-7000-8000-0000000000f2',
        farmId: FARM_ID,
        animalId: null,
        mobId: FIXTURE.mobId,
        kind: 'dip',
        occurredAt: new Date().toISOString(),
        administeredOn: today,
        productId: FIXTURE.productId,
        method: 'plunge',
      },
    ],
  };
}

export interface SeedOptions {
  /** False to boot signed out. */
  session?: boolean;
  /** True to put a herd, a counted flock and an active withholding on the device. */
  populated?: boolean;
  theme?: string;
  secondFactor?: 'complete' | 'required';
}

/** Seeds the session (and optionally the theme and the stores) before any app code runs. */
export async function seed(page: Page, options: SeedOptions = {}): Promise<void> {
  await page.addInitScript(
    ([sessionKey, session, themeKey, theme, stores]) => {
      if (session) window.localStorage.setItem(sessionKey as string, session as string);
      if (theme) window.localStorage.setItem(themeKey as string, theme as string);
      for (const [key, value] of Object.entries(stores as Record<string, unknown>)) {
        window.localStorage.setItem(key, JSON.stringify(value));
      }
    },
    [
      SESSION_KEY,
      options.session === false
        ? ''
        : JSON.stringify(cachedSession(options.secondFactor ?? 'complete')),
      THEME_STORAGE_KEY,
      options.theme ?? '',
      options.populated === true ? populatedStores() : {},
    ] as const,
  );
}

/**
 * NFR-401. `withTags` scopes an axe run to the WCAG levels we commit to, so a new axe release
 * adding an experimental rule cannot fail the build overnight — the standard is the contract, not
 * whatever the tool happens to check this month.
 */
export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
