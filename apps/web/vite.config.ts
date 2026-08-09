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
  server: {
    // The API sets a global 'api' prefix, so this forwards the path unchanged rather than
    // rewriting it. Keeping both sides on /api means the dev proxy and the production
    // reverse proxy agree, and the client's API_BASE ('/api') is correct in both.
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  // Same proxy, for `vite preview` — the built PWA e2e/manual-verification runs against
  // (offline-capture.spec.ts's own header explains why: only a build has real worker chunks and
  // a real service worker). Without this, a diagnostic exercising a REAL `/api` call under
  // preview hits CORS (the API deliberately has none — main.ts's own comment: same-origin in
  // both dev and production means "we never need a CORS policy" — adding one there to work
  // around a local-only preview gap would be the wrong fix, applied to the wrong side).
  preview: {
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  // @powersync/web (ADR-0003, via @werf/sync) ships an inline ES module worker for its SQLite
  // engine. Rollup's default 'iife' worker format cannot be code-split and fails the build the
  // moment anything imports it — not a hypothetical, this is the error PowerSync's own build
  // hits under Vite without this. 'es' is fine for our target browsers: NFR-009's throttled
  // Galaxy A15 baseline and every evergreen browser support module workers.
  worker: {
    format: 'es',
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
