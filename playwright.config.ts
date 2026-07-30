import { defineConfig, devices } from '@playwright/test';

/**
 * E2E is intentionally NOT part of `pnpm verify`; it runs in its own CI lane.
 *
 * ⭐ The suite runs against the BUILT PWA (`vite preview` serves `dist`), which is the right call —
 * the service worker, the precache manifest and the offline cold-start path only exist in a build.
 * But `vite preview` does not build, so for a while this lane could report 25 green against a `dist`
 * from a previous edit: a screen could be deleted in source and the axe audit for it would still
 * pass. Proven, not theorised — replacing the Security heading with a literal left the suite fully
 * green. `pnpm test:e2e` therefore builds first (turbo-cached, so it costs nothing when nothing
 * changed). Do not "simplify" it back to a bare `playwright test`.
 *
 * The build cannot live in `webServer.command`, because `reuseExistingServer` skips that command
 * entirely when a preview server is already up — which is exactly the case where the stale bundle
 * bites.
 */
export default defineConfig({
  testDir: './apps/web/e2e',
  fullyParallel: true,
  /**
   * Two workers, not "however many cores". The suite is served by a single `vite preview`
   * process, and six concurrent Chromium instances hammering it produced `page.goto`
   * timeouts on a DIFFERENT test each run — the classic flake that gets re-run rather
   * than read. The suite takes about eight seconds; there is nothing to win here.
   */
  workers: 2,
  forbidOnly: !!process.env.CI,
  /**
   * No retries. A retry on this suite would hide exactly the failure above, and the axe
   * assertions it guards are deterministic: a contrast violation does not pass on the
   * second attempt. A red lane should stay red.
   */
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    /**
     * ⭐ Capture what actually rendered when a test FAILS. A9 has been open four sessions because
     * the two light-theme axe failures left no evidence to read — `on-first-retry` never fired,
     * since retries are deliberately 0 above, so every red run was diagnosed by guesswork. That is
     * the mistake A8 names: never let a failure decide anything without capturing it first.
     * `retain-on-failure` records every test and keeps the trace (a full DOM snapshot) only for the
     * ones that fail; the screenshot names the missing second-factor choice UI at a glance.
     */
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm --filter @werf/web preview --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
});
