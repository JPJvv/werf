import { expect, test } from '@playwright/test';

/**
 * The OPFS-durability proof phase-checklists.md 3i(c)'s design notes call for, mirroring
 * `local-db-diagnostic.spec.ts`'s shape exactly: the unit tier cannot reach OPFS at all (jsdom has
 * none), so whether `createOpfsBlobStore` actually opens the directory and the bytes actually
 * survive a reload is unverified by every other test in this repo, no matter how many of them
 * pass. Runs against the BUILT preview for the same reason — see `local-db-diagnostic.ts`'s header.
 */

test('an attachment blob survives OPFS across a reload', async ({ page }) => {
  await page.goto('/diagnostics/diagnostics.html?mode=blob-write');
  const result = page.getByRole('status');
  await expect(result).toHaveAttribute('data-status', 'ok', { timeout: 15_000 });

  const text = await result.textContent();
  const id = text?.split(':')[1];
  expect(id).toBeTruthy();

  // A fresh navigation, not just a fresh render — proves OPFS persistence, not an in-memory
  // illusion of it, the same distinction `local-db-diagnostic.spec.ts` makes for the SQLite half.
  await page.goto(`/diagnostics/diagnostics.html?mode=blob-read&id=${id}`);
  await expect(result).toHaveAttribute('data-status', 'ok', { timeout: 15_000 });
  await expect(result).toHaveText('ok:diagnostic-blob-bytes');
});
