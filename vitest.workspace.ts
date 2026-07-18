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
    },
  },
  {
    plugins: [react()],
    test: {
      name: 'web',
      root: './apps/web',
      environment: 'jsdom',
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      passWithNoTests: true,
    },
  },
]);
