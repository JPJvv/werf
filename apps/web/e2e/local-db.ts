/**
 * Reads captures back from the REAL app's OPFS database (`werf.db`), for e2e specs that need to
 * prove durability from a source other than the still-open app tab — the Playwright analogue of
 * `apps/web/src/test-support/local-db.ts`'s `storedCaptures` (which reads a fake DB under jsdom).
 *
 * Works via `apps/web/diagnostics.html?mode=read-capture&key=...`
 * (`apps/web/src/diagnostics/local-db-diagnostic.ts`), the same never-shipped diagnostic entry
 * `local-db-diagnostic.spec.ts` already uses to prove OPFS persistence — `read-capture` is the
 * only mode that deliberately opens the app's own `werf.db` rather than an isolated diagnostic
 * file, specifically so it reads what the app itself wrote.
 */

import { expect, type Page } from '@playwright/test';

/** Every record under one capture-store key ("werf-<name>:<farmId>"), in append order. */
export async function storedCaptures<T>(page: Page, key: string): Promise<readonly T[]> {
  await page.goto(`/diagnostics/diagnostics.html?mode=read-capture&key=${encodeURIComponent(key)}`);
  const result = page.getByRole('status');
  await expect(result).toHaveAttribute('data-status', 'ok', { timeout: 15_000 });
  const text = await result.textContent();
  const payload = text?.slice('ok:'.length) ?? '[]';
  return JSON.parse(payload) as T[];
}
