import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { THEME_STORAGE_KEY, THEMES } from '@werf/ui';

/**
 * The built app, in a real browser. Runs in its own CI lane, not in `pnpm verify`.
 *
 * This is where NFR-401 is enforced: axe-core, zero violations, in BOTH themes. Auditing
 * only the default is the trap — dark is where contrast regressions actually happen,
 * because a token whose light value passes can fail once its dark value changes, and
 * nothing about the component looks wrong in review.
 */

const SESSION_KEY = 'werf-session';

/**
 * A signed-in session, written to storage before the app boots.
 *
 * The app reads this synchronously during its first render, so seeding it is the same
 * thing as a farmer opening an app they signed into last week — and it is what lets this
 * lane exercise the shell without standing up the API and a database.
 */
const CACHED_SESSION = {
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
        id: '0190f3a0-0000-7000-8000-0000000000f1',
        name: 'Rietfontein',
        enterpriseTypes: ['beef_cattle', 'row_crops'],
        role: 'owner',
      },
    ],
    activeFarmId: '0190f3a0-0000-7000-8000-0000000000f1',
    secondFactor: 'complete',
  },
  confirmedAt: new Date().toISOString(),
};

/** Seeds the session (and optionally the theme) before any app code runs. */
async function seed(page: Page, options: { session?: boolean; theme?: string }): Promise<void> {
  await page.addInitScript(
    ([sessionKey, session, themeKey, theme]) => {
      if (session) window.localStorage.setItem(sessionKey as string, session as string);
      if (theme) window.localStorage.setItem(themeKey as string, theme as string);
    },
    [
      SESSION_KEY,
      options.session === false ? '' : JSON.stringify(CACHED_SESSION),
      THEME_STORAGE_KEY,
      options.theme ?? '',
    ] as const,
  );
}

test('home shell renders the enterprise-adaptive grid', async ({ page }) => {
  await seed(page, {});
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Rietfontein' })).toBeVisible();
  await expect(page.getByRole('link', { name: /herd/i })).toBeVisible();
  // A mixed farm gets Blocks, never Camps — the adaptation, end to end.
  await expect(page.getByRole('link', { name: /blocks/i })).toBeVisible();
});

test('an unauthenticated visitor is offered a way in, not an empty shell', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
});

/**
 * NFR-401. `withTags` scopes the run to the WCAG levels we commit to, so a new axe release
 * adding an experimental rule cannot fail the build overnight — the standard is the
 * contract, not whatever the tool happens to check this month.
 */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

for (const theme of THEMES) {
  test(`the home grid has no accessibility violations in the ${theme} theme`, async ({ page }) => {
    await seed(page, { theme });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Rietfontein' })).toBeVisible();
    // The theme is applied before first paint by the bootstrap in index.html. Assert it
    // actually took, or this silently audits the light theme twice and proves nothing.
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });

  test(`sign-in has no accessibility violations in the ${theme} theme`, async ({ page }) => {
    // The one screen every farmer meets, including those who never get past it.
    await seed(page, { session: false, theme });
    await page.goto('/sign-in');
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });

  test(`onboarding has no accessibility violations in the ${theme} theme`, async ({ page }) => {
    await seed(page, { session: false, theme });
    await page.goto('/register');
    await expect(page.getByRole('heading', { name: /set up your farm business/i })).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });
}
