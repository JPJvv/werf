import { defineWorkspace } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Two projects: Node for packages + the NestJS api, jsdom for the React app.
// E2E lives under apps/web/e2e and is run by Playwright, never Vitest.
export default defineWorkspace([
  {
    test: {
      name: 'unit',
      environment: 'node',
      include: ['packages/**/*.{test,spec}.ts', 'apps/api/**/*.{test,spec}.ts'],
      passWithNoTests: true,
      /**
       * Well above Vitest's 5s default, because this project also holds the API
       * integration tests, and those are deliberately expensive: a real Postgres in
       * testcontainers (CLAUDE.md forbids mocking our own database) and argon2id at
       * OWASP's memory cost — a single 2FA enrolment hashes ten recovery codes. Several
       * container-backed suites running at once push honest tests past five seconds, and
       * a flaky gate is one people learn to re-run rather than read.
       */
      testTimeout: 30_000,
      /**
       * The same reasoning applied to HOOKS, which is where this actually bites. `testTimeout`
       * only covers the test body; `beforeAll`/`afterEach`/`afterAll` fall back to Vitest's 10s
       * `hookTimeout` unless it is raised — and the container-backed suites do their expensive
       * work in hooks (boot a Postgres, TRUNCATE between tests, stop the container). The
       * per-suite `beforeAll` already passes its own 180s timeout, so the failure lands on the
       * ones that cannot: an `afterEach` reset queued behind three other containers booting
       * takes longer than 10s and fails a suite that had nothing wrong with it. That is exactly
       * how this was found — two unrelated suites red on a full run, both green alone.
       */
      hookTimeout: 60_000,
      /**
       * Cap concurrent worker files. This project mixes fast pure-unit tests with ~10
       * suites that each start their OWN Postgres testcontainer (5 in apps/api, 5 in
       * packages/db). At Vitest's default (one worker per core = 12 here) they all try to
       * boot a container at once, and the spike — container start + argon2id memory —
       * intermittently drops a connection mid-query or times a container boot out, failing
       * unrelated suites. Four-wide bounds the peak to four containers so the gate is
       * reproducible, not lucky. It costs the fast tests a little parallelism; a gate that
       * flakes costs far more (a green run before this: 494/494; a red one: 3 suites down,
       * none for a real reason).
       */
      maxWorkers: 4,
      minWorkers: 1,
    },
  },
  {
    plugins: [react()],
    test: {
      name: 'web',
      root: './apps/web',
      environment: 'jsdom',
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      setupFiles: ['src/test-setup.ts'],
      passWithNoTests: true,
    },
  },
]);
