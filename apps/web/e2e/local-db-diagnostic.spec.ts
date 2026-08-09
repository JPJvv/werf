import { expect, test } from '@playwright/test';

/**
 * The blocking check STATUS.md's Phase 3 next-steps demanded before any other 3b work:
 * `@journeyapps/wa-sqlite`'s postinstall (dynamic WASM download) 404'd during 3a's `pnpm install`,
 * and nothing in 3a ever called `createLocalDatabase` — Node cannot run it (local-database.ts's
 * own header: it opens real OPFS/Worker/WASM and hangs forever outside a browser). So whether the
 * static WASM core this repo actually ships even opens was unverified, not just untested.
 *
 * This runs against the BUILT PWA for the same reason offline-capture.spec.ts does: only a real
 * build has the real worker chunks, and only a real browser has OPFS.
 */

test('the local SQLite/OPFS database opens and a write survives a reload', async ({ page }) => {
  await page.goto('/diagnostics/diagnostics.html?mode=write');
  const result = page.getByRole('status');
  await expect(result).toHaveAttribute('data-status', 'ok', { timeout: 15_000 });

  const text = await result.textContent();
  const id = text?.split(':')[1];
  expect(id).toBeTruthy();

  // A fresh navigation, not just a fresh render — proves OPFS persistence, not an in-memory
  // illusion of it. Same origin, same dbFilename, no state carried by the page itself.
  await page.goto(`/diagnostics/diagnostics.html?mode=read&id=${id}`);
  await expect(result).toHaveAttribute('data-status', 'ok', { timeout: 15_000 });
  await expect(result).toHaveText('ok:Diagnostic farm:ZA');
});
