import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const resolvePath = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

/**
 * A SEPARATE build, deliberately not folded into vite.config.ts's build. `diagnostics.html`
 * (src/diagnostics/local-db-diagnostic.ts) proves `@werf/sync/local-database` opens a real
 * PowerSync database in a browser — see that file's header for why the proof is needed. It is
 * built to its own `dist/diagnostics` output, not `dist/`, for two reasons that both matter:
 *
 * 1. `scripts/check-bundle-size.mjs` sums every JS chunk under `dist/assets` on the reasoning
 *    that all of it is app code a farmer's phone must pull. A diagnostic page is not that, and
 *    if it landed in `dist/assets` it would drag PowerSync's WASM engine (1-2.5MB, per 3a) into
 *    a gate that exists to keep exactly that weight out.
 * 2. `VitePWA` (vite.config.ts) is not applied to this build, so the diagnostic page and its
 *    WASM chunks never enter the service worker's precache manifest. 3a already found that
 *    importing the SDK where VitePWA can see it "breaks the PWA precache manifest outright."
 *
 * `pnpm --filter @werf/web preview` serves the whole `dist/` tree as static files regardless of
 * which build wrote which file, so `dist/diagnostics/diagnostics.html` is reachable at
 * `/diagnostics/diagnostics.html` with no change to playwright.config.ts's webServer.
 *
 * Not part of `pnpm build` / `pnpm verify` — only `pnpm test:e2e` runs it, because nothing here
 * ships to a farmer's device.
 */
export default defineConfig({
  root: resolvePath('.'),
  // Served from `/diagnostics/` (this build's output lives under `dist/diagnostics`, a
  // subdirectory of what `vite preview` serves as site root) — without this, the build emits
  // root-relative asset URLs like `/assets/...` that 404 once nested one level down.
  base: '/diagnostics/',
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    outDir: resolvePath('./dist/diagnostics'),
    rollupOptions: {
      input: resolvePath('./diagnostics.html'),
    },
  },
});
