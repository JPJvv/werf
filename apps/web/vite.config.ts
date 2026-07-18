import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

const resolvePath = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  resolve: {
    // Consume workspace packages as source; no pre-build step in the dev/build loop.
    // Exact-match regexes only, so subpath imports (e.g. '@werf/ui/theme.css') still
    // resolve through the package's `exports` map.
    alias: [
      { find: /^@werf\/ui$/, replacement: resolvePath('../../packages/ui/src/index.ts') },
      { find: /^@werf\/core$/, replacement: resolvePath('../../packages/core/src/index.ts') },
    ],
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Werf',
        short_name: 'Werf',
        description: 'Offline-first farm management',
        start_url: '/',
        display: 'standalone',
        background_color: '#FBF8F3',
        theme_color: '#FBF8F3',
      },
    }),
  ],
  build: {
    target: 'es2022',
  },
});
