import { defineConfig, devices } from '@playwright/test';

// E2E is intentionally NOT part of `pnpm verify`; it runs in its own CI lane.
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
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm --filter @werf/web preview --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
});
