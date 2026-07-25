import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { THEMES } from '@werf/ui';
import { seed, WCAG_TAGS } from './session';

/**
 * The built app, in a real browser. Runs in its own CI lane, not in `pnpm verify`.
 *
 * This is where NFR-401 is enforced: axe-core, zero violations, in BOTH themes. Auditing
 * only the default is the trap — dark is where contrast regressions actually happen,
 * because a token whose light value passes can fail once its dark value changes, and
 * nothing about the component looks wrong in review. The screens Phase 1 left unaudited
 * (enrolment, recovery codes, Settings) are covered in `a11y.spec.ts`.
 */

test('home shell renders the enterprise-adaptive grid', async ({ page }) => {
  await seed(page);
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
