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
  // A block (not a camp) plus a chemical product and an active-PHI spray on it — 4d's guard panel
  // and override controls only render once a harvest is actually blocked, and the "Overridden" line
  // on the harvest history list only renders once a harvest with a `phiOverride` exists.
  blockId: '0190f3a0-0000-7000-8000-0000000000c2',
  chemicalProductId: '0190f3a0-0000-7000-8000-0000000000d2',
  sprayId: '0190f3a0-0000-7000-8000-0000000000f3',
  overriddenHarvestId: '0190f3a0-0000-7000-8000-0000000000f4',
  // Phase 4e (FR-501): a received lot, so `/inventory` renders a row rather than its empty state.
  inventoryItemId: '0190f3a0-0000-7000-8000-0000000000g1',
  inventoryLotId: '0190f3a0-0000-7000-8000-0000000000g2',
  inventoryMovementId: '0190f3a0-0000-7000-8000-0000000000g3',
  // Phase 4 exit-review sweep (STATUS.md): the disclosed POPULATED-state a11y gap on
  // `/crops/spray`, `/crops/fertilise` and `/animals/feed` — none of the three had ever put their
  // OWN newest controls (the stock-lot picker, 4d·11's spray-side PHI override, the mob/camp
  // toggle) in front of axe, only their default/empty state. A planting due soon plus a chemical
  // lot lets the spray screen block-and-override with no interaction beyond picking the product;
  // a feed lot with a costed receipt lets the cost preview render for real, never a guessed figure.
  plantingId: '0190f3a0-0000-7000-8000-0000000000h1',
  chemicalInventoryItemId: '0190f3a0-0000-7000-8000-0000000000g4',
  chemicalInventoryLotId: '0190f3a0-0000-7000-8000-0000000000g5',
  chemicalInventoryMovementId: '0190f3a0-0000-7000-8000-0000000000g6',
  feedInventoryItemId: '0190f3a0-0000-7000-8000-0000000000g7',
  feedInventoryLotId: '0190f3a0-0000-7000-8000-0000000000g8',
  feedInventoryMovementId: '0190f3a0-0000-7000-8000-0000000000g9',
} as const;

/** localStorage entries that put a farm's worth of stock on the device. */
/**
 * Today ON THE FARM, not in UTC.
 *
 * ⚠️ This was `toISOString().slice(0, 10)`, which is the defect CLAUDE.md says keeps coming back —
 * it has now been found in production code twice and in test assertions once, and this was a fourth
 * instance sitting in the seed every one of those runs read. Between 00:00 and 02:00 SAST it stamps
 * a dose with YESTERDAY's day, so the fixture and the screen under audit disagree about what day it
 * is for two hours out of every twenty-four.
 *
 * It is spelled out here rather than imported from `src/farmTime` on purpose: nothing under `e2e/`
 * reaches into `src/`, and this lane is supposed to see the app the way a browser does. The zone is
 * the one `farms.jurisdiction` pins for ZA.
 */
function farmTodayForFixtures(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** `day` plus `delta` calendar days, UTC-only arithmetic — the fixture's own dates are day
 *  strings with no timezone question left to answer once `farmTodayForFixtures` has already
 *  resolved "today". */
function addDays(day: string, delta: number): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, date + delta)).toISOString().slice(0, 10);
}

export function populatedStores(): Record<string, unknown> {
  const today = farmTodayForFixtures();
  return {
    // This is a previously synced device, not a queue fixture. Mark the captured facts below as
    // confirmed so the accessibility lane does not turn into an accidental API/proxy retry test.
    // The dedicated offline-capture spec owns the pending → sent transition.
    [`werf-sent:${FARM_ID}`]: [
      FIXTURE.campId,
      FIXTURE.animalId,
      FIXTURE.mobId,
      '0190f3a0-0000-7000-8000-0000000000f1',
      '0190f3a0-0000-7000-8000-0000000000f2',
      '0190f3a0-0000-7000-8000-0000000000e1',
      FIXTURE.blockId,
      FIXTURE.sprayId,
      FIXTURE.overriddenHarvestId,
      FIXTURE.inventoryItemId,
      FIXTURE.inventoryLotId,
      FIXTURE.inventoryMovementId,
      FIXTURE.plantingId,
      FIXTURE.chemicalInventoryItemId,
      FIXTURE.chemicalInventoryLotId,
      FIXTURE.chemicalInventoryMovementId,
      FIXTURE.feedInventoryItemId,
      FIXTURE.feedInventoryLotId,
      FIXTURE.feedInventoryMovementId,
    ],
    [`werf-land:${FARM_ID}`]: [
      {
        id: FIXTURE.campId,
        farmId: FARM_ID,
        code: 'NOORD',
        name: null,
        hectares: 12,
        kind: 'camp',
      },
      {
        id: FIXTURE.blockId,
        farmId: FARM_ID,
        code: 'B12',
        name: null,
        hectares: 8,
        kind: 'block',
      },
    ],
    // A registered chemical product with a PHI (FR-204/FR-508), and a spray on the block that has
    // NOT round-tripped through the server yet (no `activeIngredients` — `usePhiGuard`'s own
    // `resolved` discriminator), so the offline PREVIEW path (O-12) is what a11y sees, not an
    // already-resolved date.
    [`werf-chemical-products:${FARM_ID}`]: [
      {
        id: FIXTURE.chemicalProductId,
        jurisdiction: 'ZA',
        name: 'Roundup PowerMax',
        registrationNumber: 'L1234 Act 36/1947',
        crop: 'maize',
        phiDays: 21,
        reentryHours: 24,
        effectiveFrom: '2020-01-01',
        effectiveTo: null,
      },
    ],
    [`werf-sprays:${FARM_ID}`]: [
      {
        id: FIXTURE.sprayId,
        farmId: FARM_ID,
        landUnitId: FIXTURE.blockId,
        occurredAt: new Date().toISOString(),
        sprayedOn: today,
        productId: FIXTURE.chemicalProductId,
      },
    ],
    // A planned harvest 5 days out (FR-203) — inside the 21-day PHI a spray TODAY would carry, so
    // `/crops/spray`'s own PHI guard (4d·11, § 4.3's EARLY half) blocks at capture with no
    // interaction beyond picking the product, and its override controls (the newest markup on that
    // screen, never before audited) render under the sweep.
    [`werf-plantings:${FARM_ID}`]: [
      {
        id: FIXTURE.plantingId,
        farmId: FARM_ID,
        landUnitId: FIXTURE.blockId,
        occurredAt: new Date().toISOString(),
        crop: 'Maize',
        expectedHarvestDate: addDays(today, 5),
      },
    ],
    // A harvest this device already recorded with a written override (FR-205) — the only way the
    // "Overridden — <reason>" line on the harvest history list ever renders.
    [`werf-harvests:${FARM_ID}`]: [
      {
        id: FIXTURE.overriddenHarvestId,
        farmId: FARM_ID,
        landUnitId: FIXTURE.blockId,
        occurredAt: new Date().toISOString(),
        harvestedOn: today,
        quantity: 4.5,
        unit: 'ton',
        phiOverride: { reason: 'Export deadline: contract ships Friday' },
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
    // The gestation figures, as a device that has seen signal holds them (FR-121). Without these
    // the pregnancy screen correctly renders its "no calving date can be worked out" note instead
    // of the projection panel — which is honest behaviour, and would mean the audit never saw the
    // control it was added for. Mirrors what migration 0019 seeds.
    [`werf-species-gestation:${FARM_ID}`]: [
      { species: 'cattle', gestationDays: 283, source: 'Species mean (e2e fixture)' },
      { species: 'sheep', gestationDays: 147, source: 'Species mean (e2e fixture)' },
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
    // A disposal out of the dipped flock, so the residue register at `/attention` has a row on it
    // and is audited with its CONTENT rather than its one-sentence empty state (FR-131). A `death`
    // is used rather than a slaughter because a death is never refused — it is recorded and flagged,
    // which is exactly the row this screen exists to show — and because it renders the "did NOT go
    // into the food chain" panel, a tinted block carrying a meaning that a contrast rule must see.
    [`werf-tallies:${FARM_ID}`]: [
      {
        id: '0190f3a0-0000-7000-8000-0000000000e1',
        farmId: FARM_ID,
        mobId: FIXTURE.mobId,
        occurredAt: new Date().toISOString(),
        reason: 'death',
        count: 3,
        delta: -3,
      },
    ],
    // Phase 4e (FR-501): an item, an empty lot, and a `received` movement into it — so `/inventory`
    // renders the stock row (name, quantity, batch/location) its empty state would otherwise hide.
    // Also carries a `chemical`-category lot and a `feed`-category one (below), so `/crops/spray`'s
    // and `/animals/feed`'s own OPTIONAL stock-lot pickers (FR-502/FR-153) have real stock to offer
    // — a farm with only the fertiliser lot never renders either.
    [`werf-inventory-items:${FARM_ID}`]: [
      {
        id: FIXTURE.inventoryItemId,
        farmId: FARM_ID,
        enterpriseId: null,
        category: 'fertiliser',
        name: 'Urea 46%',
        unit: 'kg',
      },
      {
        id: FIXTURE.chemicalInventoryItemId,
        farmId: FARM_ID,
        enterpriseId: null,
        category: 'chemical',
        name: 'Roundup PowerMax',
        unit: 'L',
      },
      {
        id: FIXTURE.feedInventoryItemId,
        farmId: FARM_ID,
        enterpriseId: null,
        category: 'feed',
        name: 'Lucerne bales',
        unit: 'kg',
      },
    ],
    [`werf-inventory-lots:${FARM_ID}`]: [
      {
        id: FIXTURE.inventoryLotId,
        farmId: FARM_ID,
        inventoryItemId: FIXTURE.inventoryItemId,
        batch: 'B-2026-01',
        expiryDate: null,
        location: 'Main store',
      },
      {
        id: FIXTURE.chemicalInventoryLotId,
        farmId: FARM_ID,
        inventoryItemId: FIXTURE.chemicalInventoryItemId,
        batch: 'C-2026-01',
        expiryDate: null,
        location: 'Chemical store',
      },
      {
        id: FIXTURE.feedInventoryLotId,
        farmId: FARM_ID,
        inventoryItemId: FIXTURE.feedInventoryItemId,
        batch: 'F-2026-01',
        expiryDate: null,
        location: 'Feed shed',
      },
    ],
    [`werf-inventory-movements:${FARM_ID}`]: [
      {
        id: FIXTURE.inventoryMovementId,
        farmId: FARM_ID,
        inventoryLotId: FIXTURE.inventoryLotId,
        occurredAt: new Date().toISOString(),
        reason: 'received',
        quantity: 40,
        delta: 40,
      },
      {
        id: FIXTURE.chemicalInventoryMovementId,
        farmId: FARM_ID,
        inventoryLotId: FIXTURE.chemicalInventoryLotId,
        occurredAt: new Date().toISOString(),
        reason: 'received',
        quantity: 20,
        delta: 20,
      },
      // Carries a cost (FR-153's estimate is derived, never typed — see RecordFeedScreen.tsx's
      // own module note) so the feed screen's cost-preview panel, the newest control there, has a
      // real number to show under the audit rather than staying silently absent.
      {
        id: FIXTURE.feedInventoryMovementId,
        farmId: FARM_ID,
        inventoryLotId: FIXTURE.feedInventoryLotId,
        occurredAt: new Date().toISOString(),
        reason: 'received',
        quantity: 50,
        delta: 50,
        unitCostCents: 1500,
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

/**
 * The browser lane has no API. Abort only the known background reads so providers retain the
 * durable fixture already on the device. A catch-all would hide a new server-only dependency.
 */
async function stubBackgroundReads(page: Page): Promise<void> {
  const reads = [
    '**/api/reference/species-gestation?*',
    '**/api/reference/veterinary-products?*',
    '**/api/livestock/residue-register?*',
    '**/api/auth/2fa/passkey',
  ] as const;

  for (const pattern of reads) {
    await page.route(pattern, (route) => route.abort('failed'));
  }
}

/** Seeds the session (and optionally the theme and the stores) before any app code runs. */
export async function seed(page: Page, options: SeedOptions = {}): Promise<void> {
  await stubBackgroundReads(page);
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
