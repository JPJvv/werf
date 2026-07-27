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

/**
 * Chromium has WebAuthn, so the enrolment screen offers the CHOICE — passkey or authenticator app
 * — before the TOTP seed exists. Taking the app route is what the two TOTP audits below need; the
 * choice itself is audited on its own, because it is now the first thing anyone sees here.
 */
async function chooseAuthenticatorApp(page: Page): Promise<void> {
  await page.getByRole('button', { name: /use an authenticator app instead/i }).click();
}

for (const theme of THEMES) {
  test(`the second-factor choice has no accessibility violations in the ${theme} theme`, async ({
    page,
  }) => {
    await seed(page, { theme, secondFactor: 'required' });
    await stubEnrolment(page);
    await page.goto('/security/second-factor');

    await expect(page.getByRole('button', { name: /use this phone as the key/i })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });

  test(`second-factor enrolment has no accessibility violations in the ${theme} theme`, async ({
    page,
  }) => {
    await seed(page, { theme, secondFactor: 'required' });
    await stubEnrolment(page);
    await page.goto('/security/second-factor');
    await chooseAuthenticatorApp(page);

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
    await chooseAuthenticatorApp(page);

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

  test(`settings → farms has no accessibility violations in the ${theme} theme`, async ({
    page,
  }) => {
    await seed(page, { theme });
    await page.goto('/settings/farms');

    await expect(page.getByRole('heading', { name: /^farms$/i })).toBeVisible();
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

  // Which devices can open the account (FR-014c). There is no API behind the e2e seed, so what is
  // audited here is the screen's ERROR state — which is the right one to audit anyway: it is a
  // panel a farmer only ever meets when something has already gone wrong.
  test(`settings → security has no accessibility violations in the ${theme} theme`, async ({
    page,
  }) => {
    await seed(page, { theme });
    await page.goto('/settings/security');

    await expect(page.getByRole('heading', { name: /security/i })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });
}

/**
 * The capture screens Phase 2 added, in BOTH themes.
 *
 * These ran unthemed until an exit-gate review caught the reasoning behind it: "a form's markup
 * does not change with the theme" is true of markup and false of the audit. `WCAG_TAGS` includes
 * `wcag2aa`, so axe runs `color-contrast` — the one rule whose result depends entirely on the
 * theme, and the exact failure the themed audits above exist to catch. Auditing thirteen capture
 * screens in light only left dark-theme contrast on all of them unchecked, while three separate
 * places in the checklist claimed both. `.claude/rules/frontend.md` is not optional about this:
 * light AND dark, both audited by axe-core.
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
  { path: '/animals/groups/new', heading: /record a group/i },
  { path: '/animals/groups/count', heading: /change a group’s numbers/i },
  { path: '/animals/move', heading: /move animals/i },
  { path: '/animals/birth', heading: /record a birth/i },
  { path: '/animals/wean', heading: /weaning session/i },
  { path: '/animals/health', heading: /treat or vaccinate/i },
  // Stock theft (FR-603). The list and the capture are separate screens and both are audited: the
  // list is where the one online-only action in livestock lives, and a farmer reads it under the
  // worst conditions this product has — the morning after.
  { path: '/animals/theft', heading: /stock theft/i },
  { path: '/animals/theft/new', heading: /report stock theft/i },
  { path: '/weigh', heading: /weigh session/i },
  { path: '/rainfall', heading: /rainfall/i },
  // Not a capture, but it is reached FROM one going wrong, which is the worst moment to meet an
  // accessibility failure. The seed has nothing refused, so this audits the empty state; the
  // populated state's markup is the same list the other screens use.
  { path: '/not-sent', heading: /what needs your attention/i },
] as const;

/**
 * ⭐ The screens where the CONTROLS only exist once the farm has stock, walked through far enough
 * to render them.
 *
 * The sweep above audits every screen's default state, and for most of them that is the state with
 * the controls in it. For these three it is not: each takes a `length === 0` branch on an empty
 * device and renders one sentence. The heading still appears — it sits outside the conditional —
 * so the sweep's own "assert it rendered before auditing" guard passed while auditing almost
 * nothing. That is the same defect as the one-theme shortcut, one layer down: the audit ran, and it
 * ran on a page that did not contain the thing under test.
 *
 * Each `act` leaves the screen showing the widgets a farmer actually touches — including both
 * withholding panels, which are the newest controls here and the two that carry a colour meaning
 * (NFR-411), so they are exactly what a contrast rule needs to see in both themes.
 */
const POPULATED_SCREENS = [
  {
    path: '/animals/loss',
    heading: /record a loss/i,
    act: async (page: Page) => {
      await page
        .getByRole('button', { name: /bonsmara/i })
        .first()
        .click();
      await page.getByRole('button', { name: 'Slaughtered' }).click();
      // The animal was dosed today, so this renders the withholding panel and its clear date.
      await expect(page.getByText(/cannot be sold for slaughter yet/i)).toBeVisible();
    },
  },
  {
    path: '/animals/groups/count',
    heading: /change a group’s numbers/i,
    act: async (page: Page) => {
      await page
        .getByRole('button', { name: /ossies/i })
        .first()
        .click();
      await page.getByRole('button', { name: /^sold$/i }).click();
      await expect(page.getByText(/cannot go for slaughter or sale yet/i)).toBeVisible();
    },
  },
  {
    path: '/animals/health',
    heading: /treat or vaccinate/i,
    act: async (page: Page) => {
      // The mob picker — the control a group-only flock is dosed through, and new enough that it
      // had never been audited at all.
      await page
        .getByRole('button', { name: /ossies/i })
        .first()
        .click();
      await expect(page.getByLabel(/product/i)).toBeVisible();
    },
  },
] as const;

for (const theme of THEMES) {
  test(`the Phase 2 capture screens have no accessibility violations in the ${theme} theme`, async ({
    page,
  }) => {
    await seed(page, { theme });

    for (const { path, heading } of CAPTURE_SCREENS) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      expect(results.violations, `violations on ${path} in the ${theme} theme`).toEqual([]);
    }
  });

  test(`the capture screens have no violations WITH THEIR CONTROLS SHOWING in the ${theme} theme`, async ({
    page,
  }) => {
    await seed(page, { theme, populated: true });

    for (const { path, heading, act } of POPULATED_SCREENS) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
      await act(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      expect(results.violations, `violations on a populated ${path} in ${theme}`).toEqual([]);
    }
  });
}
