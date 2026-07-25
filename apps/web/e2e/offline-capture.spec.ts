import { expect, test } from '@playwright/test';
import { FARM_ID, seed } from './session';

/**
 * The offline cold start, on the BUILT PWA, in a real browser — the one thing the Phase 1 reviewer
 * flagged that nothing exercised, and the last ☐ in the Phase 2 quality gates.
 *
 * jsdom already proves the behaviour (`src/sync/Outbox.test.tsx`), but it proves it against a
 * simulated environment: no service worker, no real reload, no browser deciding whether a document
 * can be fetched with the radio off. The promise this product makes — "capture it in the veld, it is
 * still there tomorrow, and it goes up when you have signal" — is only demonstrated by a browser
 * that genuinely has no network.
 *
 * So: capture with the network OFF, reload with the network still OFF, and only then let the signal
 * come back and watch the queue drain. If the service worker were not precaching the shell, step two
 * would fail here rather than in a farmer's hands.
 */

const HERD_KEY = `werf-herd:${FARM_ID}`;
const WEIGHTS_KEY = `werf-weights:${FARM_ID}`;

test('captures with the network off, survives a reload, and sends when the signal returns', async ({
  page,
  context,
}) => {
  await seed(page);
  await page.goto('/');

  // Wait for the service worker to take control — until it does, a reload still needs the network
  // and this test would be proving something weaker than it claims.
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, {
    timeout: 30_000,
  });

  // ── The radio goes off. Everything from here is what a farmer in a crush actually has. ──
  await context.setOffline(true);

  // Navigation is client-side, so getting to the capture screen needs no network either.
  await page.getByRole('link', { name: /herd/i }).click();
  await page.getByRole('link', { name: /record an animal/i }).click();
  await page.getByRole('button', { name: /save animal/i }).click();
  await expect(page.getByText(/saved — your work is saved/i)).toBeVisible();

  // A weight against that animal — an EVENT, so the pair proves the FK-ordered flush below.
  await page.getByRole('link', { name: /^done$/i }).click();
  await page.getByRole('link', { name: /weigh session/i }).click();
  await page.getByLabel(/weight \(kg\)/i).fill('412.5');
  await page.getByRole('button', { name: /save & next/i }).click();

  // The strip says the thing that matters most in the product. Never "sync", never an apology.
  await expect(page.getByRole('status', { name: /save status/i })).toContainText(
    /offline — your work is saved/i,
  );

  // ── The cold start: the app is closed and reopened, still with no signal. ──
  // Reloaded ON THE CAPTURE ROUTE, not on "/". A farmer closes the app where they were working, so
  // the service worker has to serve a deep route from its precached shell — the document for
  // /weigh was never fetched from anywhere. This is the assertion that would have caught a missing
  // navigation fallback, and it is why this test reloads here rather than after going home.
  await page.reload();
  await expect(page.getByRole('heading', { name: /weigh session/i })).toBeVisible();
  await expect(page.getByRole('status', { name: /save status/i })).toContainText(
    /offline — your work is saved/i,
  );

  // The herd tile counts the animal captured while offline, read back off the device.
  await page
    .getByRole('link', { name: /back to animals|^done$/i })
    .first()
    .click();
  await page.getByRole('link', { name: /back to home/i }).click();
  await expect(page.getByRole('heading', { name: 'Rietfontein' })).toBeVisible();
  await expect(page.getByRole('link', { name: /herd/i })).toContainText('1');

  // Both captures are genuinely on the device, not in a page that happens to still be open.
  const stored = await page.evaluate(
    ([herdKey, weightsKey]) => ({
      animals: JSON.parse(window.localStorage.getItem(herdKey as string) ?? '[]') as unknown[],
      weights: JSON.parse(window.localStorage.getItem(weightsKey as string) ?? '[]') as unknown[],
    }),
    [HERD_KEY, WEIGHTS_KEY] as const,
  );
  expect(stored.animals).toHaveLength(1);
  expect(stored.weights).toHaveLength(1);

  // ── The signal comes back. ──
  const sent: string[] = [];
  await context.route('**/api/livestock/**', async (route) => {
    sent.push(new URL(route.request().url()).pathname);
    await route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
  });
  await context.setOffline(false);

  // The queue drains on its own, in the app the farmer already has open — no reload needed to
  // trigger it, and nothing they have to remember to do.
  await expect(page.getByRole('status', { name: /save status/i })).toContainText(
    /saved and sent/i,
    { timeout: 15_000 },
  );

  // Animals FIRST: a weight event references animals(id), and an event that arrived before its
  // animal would fail the foreign key against a row the server has never seen. Asserted as an
  // ORDER rather than an exact call list, because the flush is deliberately at-least-once: an
  // interrupted round retries, and every endpoint is idempotent on the client-generated id so a
  // retry is a server-side no-op. Demanding exactly-once here would test against the design.
  expect(sent[0]).toBe('/api/livestock/animals');
  expect(sent).toContain('/api/livestock/weights');
  expect(sent.indexOf('/api/livestock/animals')).toBeLessThan(
    sent.indexOf('/api/livestock/weights'),
  );

  // And a second open does not re-send what the server has already confirmed.
  sent.length = 0;
  await page.reload();
  await expect(page.getByRole('status', { name: /save status/i })).toContainText(/saved and sent/i);
  expect(sent).toEqual([]);
});
