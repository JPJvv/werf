import { expect, test } from '@playwright/test';

// Smoke check that the built app shell loads. Runs in its own CI lane, not in `pnpm verify`.
test('home shell renders the product name', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Werf' })).toBeVisible();
});
