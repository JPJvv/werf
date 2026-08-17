import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/*.config.*',
      '**/tailwind-preset.cjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // ADR-0003's exit depends on application code never knowing PowerSync exists: only
    // packages/sync (the adapter) may import the SDK directly. Everyone else goes through
    // `createLocalDatabase` / `LocalDatabase` from `@werf/sync`. See packages/sync/src/local-database.ts.
    ignores: ['packages/sync/**'],
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@powersync/*'],
              message:
                'Import the PowerSync SDK only from packages/sync (ADR-0003 exit clause 2). Use createLocalDatabase / LocalDatabase from @werf/sync instead.',
            },
          ],
        },
      ],
    },
  },
);
