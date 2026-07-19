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
