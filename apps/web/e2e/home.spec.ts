import { expect, test } from '@playwright/test';

// Smoke check that the built app shell loads. Runs in its own CI lane, not in `pnpm verify`.
test('home shell renders the enterprise-adaptive grid', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Rietfontein' })).toBeVisible();
  await expect(page.getByRole('link', { name: /herd/i })).toBeVisible();
});
