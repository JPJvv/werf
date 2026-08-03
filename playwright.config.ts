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
   * ⭐ ONE worker, and this is the fix for §4 A9 — read the diagnosis before raising it again.
   *
   * A9 was two light-theme axe tests failing on a COLD run, for six sessions, with no explanation.
   * The captured trace ended it: BOTH failing tests requested `/assets/index-*.js` within 4 ms of
   * each other (the two workers starting together), both requests STALLED for ten seconds, and one
   * came back `net::ERR_CONNECTION_RESET`. The page's own CSS and `registerSW.js` stalled the same
   * ten seconds. A later load of the identical assets took 3–30 ms.
   *
   * So nothing was ever wrong with the app. The HTML shell loaded — which is why the theme script
   * had run, the background was painted, and the sibling `data-theme` assertion always passed — and
   * the React bundle never arrived, so the tree rendered nothing and every control on it was
   * "not found". That is the blank screenshot, exactly.
   *
   * The cause is load on a single-process static server: two cold workers each fetch the page's
   * assets AND install a service worker that precaches 561 KiB, all at once, and `vite preview`
   * resets a connection rather than serving them. Dropping to two workers (from "however many
   * cores") narrowed it from "a different test each run" to "the first two, on a cold run"; it did
   * not remove it, because two is still concurrent and the precache burst is the expensive part.
   *
   * The suite takes about eight seconds warm, so serialising it wins back nothing worth having, and
   * it makes the lane's result depend on the app rather than on a race for sockets.
   *
   * ⚠️ This reduces CONTENTION; it does not make the server robust. If a green run is ever offered
   * as proof this is fixed, note that A9 already ran 27/27 green once while entirely unfixed.
   */
  workers: 1,
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
