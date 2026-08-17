// Production connectivity gate (P1.4, 2026-08-14): writes `dist/_headers` with a CSP whose
// `connect-src` names the EXACT origins this PWA actually needs, rather than a static file that
// silently drifted out of sync with what the app connects to.
//
// The API is deliberately NOT in this list. `apps/api/src/main.ts` and this package's own
// `vite.config.ts` proxy both document the same design: the API is served SAME-ORIGIN in both dev
// (Vite proxy) and production (the reverse proxy serves `/api` off the PWA's own domain) — see
// main.ts's "we never need a CORS policy" comment. `'self'` already covers it.
//
// Two origins genuinely are cross-origin, because the browser talks to them DIRECTLY, never
// through the API:
//   - PowerSync (offline-sync.md's down-sync connection, `SyncConnection.tsx`) — the API hands the
//     client a `{ endpoint, token }` pair (`GET /sync/token`) and the PowerSync SDK then connects
//     to `endpoint` itself, from the browser.
//   - Object storage (`ObjectStorage.presignPut`, phase-checklists.md 3i) — a presigned PUT is a
//     direct browser→S3/MinIO request; ADR-0012's REST-up topology carries metadata only.
//
// Before this script, `public/_headers` hardcoded `connect-src 'self'` — which is not "too
// permissive", the opposite defect from what a CSP usually gets wrong: it silently BLOCKS every
// PowerSync connection and every attachment upload the moment either is served from a real,
// separate origin, which is exactly the production shape (deployment-guide.md §7). Nothing caught
// this because every existing test either mocks the transport or runs under Node (`fetch` enforces
// no CSP at all) — see `apps/web/e2e/deployed-connectivity.spec.ts` for the real-browser proof.
//
// Origins are environment-driven with production-shaped defaults (deployment-guide.md §7), so a
// local dev/e2e build against the docker-compose stack gets working local origins for free and a
// CI/production build overrides them to the real domains via env vars — never a second hardcoded
// copy to keep in sync.

import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const distHeaders = fileURLToPath(new URL('../dist/_headers', import.meta.url));

/** `wss://` is included alongside `https://` for the PowerSync origin because this repo has not
 *  pinned which transport the installed `@powersync/web` SDK version uses for its live connection
 *  (fetch-streaming vs WebSocket) — both point at the SAME service and origin, so allowing both
 *  schemes for that one host costs nothing and avoids a CSP break if the SDK's transport changes
 *  under us on an upgrade. */
const POWERSYNC_ORIGIN = process.env['CSP_POWERSYNC_ORIGIN'] ?? 'https://sync.werf.co.za';
const POWERSYNC_WS_ORIGIN =
  process.env['CSP_POWERSYNC_WS_ORIGIN'] ?? POWERSYNC_ORIGIN.replace(/^https:/, 'wss:');
const OBJECT_STORAGE_ORIGIN =
  process.env['CSP_OBJECT_STORAGE_ORIGIN'] ??
  'https://werf-attachments.s3.af-south-1.amazonaws.com';

const connectSrc = ["'self'", POWERSYNC_ORIGIN, POWERSYNC_WS_ORIGIN, OBJECT_STORAGE_ORIGIN].join(
  ' ',
);

// Every directive `public/_headers` declared, unchanged, except `connect-src` — kept as ONE
// generated file rather than a static one plus a diff, so there is exactly one source of truth
// for what ships.
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src ${connectSrc}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  'upgrade-insecure-requests',
].join('; ');

const body = `/*
  Content-Security-Policy: ${csp}
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=(self), payment=(), usb=()
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Cross-Origin-Opener-Policy: same-origin
  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload

/theme-bootstrap.js
  Cache-Control: no-cache

/index.html
  Cache-Control: no-cache
`;

// vite already copied public/_headers into dist verbatim as a static asset; its presence is this
// script's proof `vite build` ran before it did. This script's output REPLACES that copy.
if (!existsSync(distHeaders)) {
  console.error(`✗ generate-headers: ${distHeaders} not found. Run \`vite build\` first.`);
  process.exit(1);
}

writeFileSync(distHeaders, body);
console.log(`✓ dist/_headers written — connect-src: ${connectSrc}`);
