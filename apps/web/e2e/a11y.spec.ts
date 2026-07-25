import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { THEMES } from '@werf/ui';
import { seed, WCAG_TAGS } from './session';

/**
 * NFR-401 on the screens Phase 1 left unaudited: second-factor enrolment, the recovery codes, and
 * Settings. Both themes, zero violations.
 *
 * These are the screens where an accessibility failure costs the most and is least likely to be
 * noticed in review. Enrolment and recovery codes are seen ONCE, under mild stress, and a farmer who
 * cannot read them cannot ask for them again — the codes are shown exactly once by design. Settings
 * is where someone goes precisely BECAUSE the defaults are not working for them, which includes the
 * farmer who needs the dark theme or a bigger tap target.
 *
 * Dark is audited for the same reason as the home grid: a token whose light value passes contrast can
 * fail once its dark value changes, and nothing about the component looks wrong in a diff.
 */

/** The enrolment screen fetches a TOTP seed on mount; the recovery step needs a confirm reply. */
async function stubEnrolment(page: Page): Promise<void> {
  await page.route('**/api/auth/2fa/totp', async (route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ secret: 'GEZDGNBVGY3TQOJQ', uri: 'otpauth://totp/Werf:thabo' }),
    });
  });
  await page.route('**/api/auth/2fa/totp/confirm', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        recoveryCodes: Array.from({ length: 10 }, (_, i) => `AAAA${i}-BBBB${i}`),
      }),
    });
  });
}

for (const theme of THEMES) {
  test(`second-factor enrolment has no accessibility violations in the ${theme} theme`, async ({
    page,
  }) => {
    await seed(page, { theme, secondFactor: 'required' });
    await stubEnrolment(page);
    await page.goto('/security/second-factor');

    await expect(page.getByRole('heading', { name: /protect this account/i })).toBeVisible();
    // `expect` first: the seed arrives asynchronously, and auditing before it renders would skip
    // the part of the screen that carries the secret.
    await expect(page.getByText(/GEZD/)).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });

  test(`the recovery codes have no accessibility violations in the ${theme} theme`, async ({
    page,
  }) => {
    await seed(page, { theme, secondFactor: 'required' });
    await stubEnrolment(page);
    await page.goto('/security/second-factor');

    await page.getByLabel(/^code$/i).fill('123456');
    await page.getByRole('button', { name: /confirm/i }).click();

    // Ten codes a farmer must be able to read off a screen once, and print.
    await expect(page.getByRole('heading', { name: /write these down/i })).toBeVisible();
    await expect(page.getByRole('listitem')).toHaveCount(10);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });

  test(`settings → appearance has no accessibility violations in the ${theme} theme`, async ({
    page,
  }) => {
    await seed(page, { theme });
    await page.goto('/settings/appearance');

    await expect(page.getByRole('heading', { name: /appearance/i })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });

  test(`settings → language has no accessibility violations in the ${theme} theme`, async ({
    page,
  }) => {
    await seed(page, { theme });
    await page.goto('/settings/language');

    await expect(page.getByRole('heading', { name: /language/i })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });
}

/**
 * The capture screens Phase 2 added. One theme each rather than both: the themed audits above are
 * what actually test the token system, and a form's markup does not change with the theme.
 *
 * Each screen is asserted to have RENDERED before it is audited. axe reports zero violations on a
 * blank page, so an audit without that assertion passes hardest when the screen is broken.
 */
const CAPTURE_SCREENS = [
  // The seeded farm is MIXED (cattle + row crops), so its word for a piece of ground is "block" —
  // crop naming wins on a mixed farm, because a block is the audited unit. Asserting the camp
  // wording here would be asserting the wrong farm's vocabulary.
  { path: '/land', heading: /blocks/i },
  { path: '/land/new', heading: /add a block/i },
  { path: '/animals', heading: /animals/i },
  { path: '/animals/new', heading: /record an animal/i },
  { path: '/animals/loss', heading: /record a loss/i },
  { path: '/animals/tag', heading: /tag animals/i },
  { path: '/weigh', heading: /weigh session/i },
  { path: '/rainfall', heading: /rainfall/i },
] as const;

test('the Phase 2 capture screens have no accessibility violations', async ({ page }) => {
  await seed(page);

  for (const { path, heading } of CAPTURE_SCREENS) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations, `violations on ${path}`).toEqual([]);
  }
});
